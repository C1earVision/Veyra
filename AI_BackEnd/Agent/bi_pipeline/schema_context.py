"""Build a compact schema context string for LLM prompts.

Pre-fetches table DDL + 1 sample row per table so that Agent 1 and Agent 2
understand the database without needing runtime SQL tool calls.
"""

from __future__ import annotations

from typing import List, Optional

from langchain_community.utilities import SQLDatabase


# Maximum number of tables to include (prevent context blowup on wide databases)
MAX_TABLES = 30
# Maximum character length for the entire context string (~4K tokens ≈ 16K chars)
MAX_CONTEXT_CHARS = 16_000


def build_schema_context(
    db: SQLDatabase,
    tables: Optional[List[str]] = None,
    max_tables: int = MAX_TABLES,
    max_chars: int = MAX_CONTEXT_CHARS,
) -> str:
    """Build a compact schema + sample-row context string for LLM prompts.

    Returns a string like:
        CREATE TABLE orders (...);
        -- Sample row: {'id': 1, 'total': 150.00, 'status': 'completed', ...}

        CREATE TABLE products (...);
        -- Sample row: {'id': 42, 'name': 'Widget', 'price': 29.99, ...}
    """
    from sqlalchemy import text

    if tables is None:
        tables = list(db.get_usable_table_names())

    # Cap the number of tables
    tables = tables[:max_tables]

    lines: list[str] = []

    for tbl in tables:
        # Get DDL / column info
        try:
            ddl = db.get_table_info([tbl])
        except Exception:
            ddl = f"-- Could not retrieve schema for {tbl}"
        lines.append(ddl.strip())

        # Get 1 sample row and inspect column metadata
        try:
            with db._engine.connect() as conn:
                try:
                    res = conn.execute(
                        text(f'SELECT * FROM "{tbl}" LIMIT 1')
                    )
                except Exception:
                    res = conn.execute(
                        text(f"SELECT * FROM {tbl} LIMIT 1")
                    )
                cols = list(res.keys())
                row = res.fetchone()
                if row:
                    sample = {c: _serialize_value(v) for c, v in zip(cols, row)}
                    lines.append(f"-- Sample row: {sample}")
                else:
                    lines.append(f"-- Table '{tbl}' is empty (no sample row)")

                # Fetch temporal boundaries and low-cardinality values for key columns
                date_cols = [
                    c for c in cols
                    if any(kw in c.lower() for kw in ("date", "timestamp", "time"))
                ][:2]
                for dc in date_cols:
                    try:
                        q_date = text(f'SELECT MIN("{dc}"), MAX("{dc}") FROM "{tbl}" WHERE "{dc}" IS NOT NULL')
                        d_res = conn.execute(q_date).fetchone()
                        if d_res and d_res[0] is not None:
                            lines.append(f"-- Date range for '{dc}': {str(d_res[0])[:19]} to {str(d_res[1])[:19]}")
                    except Exception:
                        pass

                status_cols = [
                    c for c in cols
                    if any(kw in c.lower() for kw in ("status", "type", "category"))
                    and c not in date_cols
                ][:2]
                for sc in status_cols:
                    try:
                        q_status = text(f'SELECT DISTINCT "{sc}" FROM "{tbl}" WHERE "{sc}" IS NOT NULL LIMIT 8')
                        s_rows = conn.execute(q_status).fetchall()
                        if s_rows:
                            vals = [str(r[0]) for r in s_rows if r[0] is not None]
                            if vals:
                                lines.append(f"-- Distinct values for '{sc}': {vals}")
                    except Exception:
                        pass
        except Exception:
            lines.append(f"-- Could not fetch sample data for {tbl}")

        lines.append("")  # blank line separator

        # Early exit if we're already over the character budget
        joined = "\n".join(lines)
        if len(joined) > max_chars:
            lines.append(
                f"-- (schema truncated: {len(tables) - tables.index(tbl) - 1} "
                f"additional tables omitted to fit context window)"
            )
            break

    return "\n".join(lines).strip()


def _serialize_value(val) -> str:
    """Convert a DB cell value to a compact string for the context."""
    if val is None:
        return "NULL"
    if isinstance(val, (bytes, memoryview)):
        return "<binary data>"
    if isinstance(val, str) and len(val) > 100:
        return val[:100] + "…"
    return str(val)
