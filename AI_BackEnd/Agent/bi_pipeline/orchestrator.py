"""BI Pipeline Orchestrator — 3-agent pipeline with streaming.

Pipeline flow (full dashboard):
  Agent 1 (Question Planner, local model) → user query → business questions
  Agent 2 (SQL Engineer, strong model)    → questions + schema → SQL queries
  Python  (parallel SQL execution)        → SQL → result data
  Agent 3 (Dashboard Assembler, local)    → data → final DashboardSpec

Single-chart / table branch (when is_single_chart):
  Agent 1 (Question Planner)              → confirms focused intent
  Single Chart Agent (strong model)       → SQL + one chart/table spec
  Python  (SQL execution + assembly)      → minimal 1-page DashboardSpec

Each agent uses `with_structured_output()` for Pydantic-validated JSON.
The entire thought process is streamed to the frontend via SSE events.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import traceback
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from Agent.bi_pipeline.schema_context import build_schema_context
from Prompt.bi_pipeline.question_planner_prompt import QUESTION_PLANNER_PROMPT
from Prompt.bi_pipeline.sql_engineer_prompt import SQL_ENGINEER_PROMPT
from Prompt.bi_pipeline.dashboard_assembler_prompt import (
    DASHBOARD_ASSEMBLER_PROMPT,
    get_dashboard_assembler_prompt,
)
from Prompt.bi_pipeline.single_chart_prompt import (
    SINGLE_CHART_PROMPT,
    get_single_chart_prompt,
)
from schemas.bi_pipeline_models import (
    AnalyticalIntent,
    BusinessQuestion,
    BusinessQuestionsOutput,
    ChartDataKeySpec,
    ChartSpec,
    DashboardPageSpec,
    ExecutedQuery,
    FinalDashboardOutput,
    SingleChartPlan,
    SliderSpec,
    SQLQueriesOutput,
    SQLQuerySpec,
)
from schemas.query_models import (
    AgentStep,
    DashboardSpec,
    DashboardPage,
    DashboardChart,
    DashboardKpi,
    DashboardSlider,
    ChartDataKey,
    QueryResponse,
)
from Utils.ModelLoader import modelLoader, is_rate_limit_error, extract_retry_delay
from Utils.request_context import QueryCancelScope

EmitFn = Callable[[str, Dict[str, Any]], Any]

# Maximum retries for rate-limited LLM calls
MAX_RATE_LIMIT_RETRIES = 5
# Maximum rows per query result sent to the dashboard assembler (keeps tokens low)
MAX_DATA_ROWS_PER_QUERY = 12
# Maximum total characters of executed queries JSON for dashboard assembler (stay well under 7,000 ITPM)
MAX_ASSEMBLER_CONTEXT_CHARS = 4_500
MAX_SINGLE_CHART_ROWS = 50
MAX_SINGLE_TABLE_ROWS = 100


# ─── Model Helpers ────────────────────────────────────────────────────────────

def _get_local_model(model_id: Optional[str] = None):
    """Get a lightweight model for easy tasks (Agent 1: Planner, Agent 3: Assembler).

    Uses gemini-3.5-flash-lite if Gemini is available/selected to conserve quota.
    Otherwise tries Ollama local model, then resilient model chain.
    """
    import os
    from Utils.ModelLoader import ResilientChatOpenAI

    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    is_gemini_selected = model_id and "gemini" in model_id.lower()
    is_ollama_selected = model_id and "ollama" in model_id.lower()

    # If user explicitly chose Ollama, honor it
    if is_ollama_selected:
        loader = modelLoader(model_provider="ollama", model_id=model_id)
        return loader.get_model_chain()

    # Use gemini-3.5-flash-lite for lightweight tasks if Gemini is available or selected
    if gemini_key and (is_gemini_selected or not model_id):
        print(f"[BI Pipeline] Lightweight agent using gemini-3.5-flash-lite to conserve quota")
        loader = modelLoader(model_id="gemini:gemini-3.5-flash-lite")
        return loader.get_model_chain()

    # If Ollama is running, prefer local Ollama
    ollama_base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    loader = modelLoader(model_provider="ollama", model_id=model_id)

    try:
        import urllib.request
        req = urllib.request.urlopen(f"{ollama_base.replace('/v1', '')}/api/tags", timeout=1.5)
        if req.status == 200:
            ollama_model_name = "qwen3.5:4b"
            for cfg in (loader.models_config or []):
                if cfg.get("provider", "").lower() == "ollama":
                    ollama_model_name = cfg.get("model_name", ollama_model_name)
                    break
            print(f"[BI Pipeline] Local model: {ollama_model_name} via Ollama ({ollama_base})")
            return ResilientChatOpenAI(
                model=ollama_model_name,
                base_url=ollama_base,
                api_key="ollama",
                temperature=0.1,
                max_retries=1,
                max_tokens=8192,
            )
    except Exception as e:
        print(f"[BI Pipeline] Ollama not available ({e}), using resilient model chain for local agent")

    # Use model chain with automatic fallbacks
    print(f"[BI Pipeline] Local agent using resilient model chain")
    return loader.get_model_chain()


def _get_strong_model(model_id: Optional[str] = None):
    """Get a strong model for SQL generation (Agent 2: SQL Engineer).

    Uses gemini-3.8-flash if Gemini is available/selected for complex multi-step reasoning.
    """
    import os

    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    is_gemini_selected = model_id and "gemini" in model_id.lower()

    if gemini_key and (is_gemini_selected or not model_id):
        print(f"[BI Pipeline] Strong model: gemini-3.8-flash for SQL generation")
        loader = modelLoader(model_id="gemini:gemini-3.8-flash")
        return loader.get_model_chain()

    loader = modelLoader(model_provider="openai", model_id=model_id)
    model = loader.get_model_chain()
    print(f"[BI Pipeline] Strong model chain loaded for SQL generation ({model_id or 'default'})")
    return model


# ─── Rate-Limit Aware Retry Helper ────────────────────────────────────────────

def _is_token_limit_exceeded(error: Exception) -> bool:
    """Check if the error is because the request exceeded the model's token or rate limit."""
    msg = str(error).lower()
    return any(sig in msg for sig in [
        "request too large",
        "maximum context length",
        "context_length_exceeded",
        "input tokens per minute",
        "tokens per minute",
        "itpm",
        "please reduce your message size",
        "rate_limit_exceeded",
        "status code 413",
        "error code: 413",
        "status code 429",
        "error code: 429",
    ]) or ("limit" in msg and "requested" in msg)


def _extract_wait_seconds(error: Exception) -> float:
    """Extract how long to wait from a rate-limit error, with smart defaults."""
    error_str = str(error)

    # 1. Look for explicit "try again in X"
    unit_match = re.search(
        r"try again in (\d+(?:\.\d+)?)\s*(ms|s|m|seconds|second)?",
        error_str,
        re.IGNORECASE,
    )
    if unit_match:
        val = float(unit_match.group(1))
        unit = (unit_match.group(2) or "s").lower()
        if unit == "ms":
            return max(val / 1000.0 + 1.0, 1.0)
        elif unit in ("m", "minute", "minutes"):
            return val * 60.0 + 2.0
        return val + 1.5

    # 2. Look for "Limit X, Requested Y" pattern (Groq ITPM tokens-per-minute window)
    itpm_match = re.search(
        r"Limit\s+(\d+),\s*Requested\s+(\d+)", error_str, re.IGNORECASE
    )
    if itpm_match or "input tokens per minute" in error_str.lower() or "itpm" in error_str.lower():
        # Groq's rolling window resets across 60 seconds
        print(f"[BI Pipeline] ITPM rolling window detected — waiting 62s for full token bucket reset")
        return 62.0

    # 3. Fallback to standard ModelLoader delay calculation
    return extract_retry_delay(error, attempt=1)


async def _rate_limit_retry_wrapper(
    coro_factory,
    phase: str,
    emit: Optional[EmitFn] = None,
    max_retries: int = MAX_RATE_LIMIT_RETRIES,
):
    """Wrap an async call with intelligent rate-limit wait-and-retry.

    Handles tokens-per-minute (ITPM) and request size limits with live countdowns
    both in the server console and via SSE events to the frontend.
    """
    for attempt in range(max_retries):
        try:
            return await coro_factory()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if is_rate_limit_error(e) or _is_token_limit_exceeded(e):
                if attempt >= max_retries - 1:
                    print(
                        f"\n[BI Pipeline] ❌ {phase}: Rate limit retries exhausted after "
                        f"{max_retries} attempts. Giving up."
                    )
                    raise

                wait_seconds = _extract_wait_seconds(e)
                print(
                    f"\n{'='*60}\n"
                    f"[BI Pipeline] ⚠️  {phase}: Rate limit / Token limit hit!\n"
                    f"[BI Pipeline] Error: {str(e)[:250]}\n"
                    f"[BI Pipeline] Waiting {wait_seconds:.0f}s for tokens-per-minute window to reset "
                    f"(attempt {attempt + 1}/{max_retries})...\n"
                    f"{'='*60}"
                )

                # Live countdown with prints and frontend SSE updates
                remaining = wait_seconds
                while remaining > 0:
                    step = min(5.0, remaining)
                    if emit:
                        await emit("status", {
                            "phase": phase,
                            "text": f"Rate limit cooling down — retrying in {remaining:.0f}s…",
                        })
                    if int(remaining) % 10 == 0 or remaining <= 5:
                        print(f"[BI Pipeline] [{phase}] Cooldown in progress: {remaining:.0f}s remaining...")
                    await asyncio.sleep(step)
                    remaining -= step

                print(f"[BI Pipeline] [{phase}] Cooldown finished! Automatically retrying now (attempt {attempt + 2}/{max_retries})...\n")
                if emit:
                    await emit("status", {
                        "phase": phase,
                        "text": f"Resuming {phase}…",
                    })
            else:
                raise


# ─── SQL Execution ────────────────────────────────────────────────────────────

def _execute_single_query(
    db,
    query_spec: SQLQuerySpec,
    question: BusinessQuestion,
) -> ExecutedQuery:
    """Execute a single SQL query and return the result."""
    from sqlalchemy import text

    print(f"[BI Pipeline] Executing SQL for {query_spec.question_id}: {query_spec.sql[:120]}…")

    try:
        with db._engine.connect() as conn:
            result = conn.execute(text(query_spec.sql))
            cols = list(result.keys())
            rows = result.fetchall()

            data = []
            for row in rows:
                record = {}
                for col, val in zip(cols, row):
                    if val is None:
                        record[col] = None
                    elif isinstance(val, (bytes, memoryview)):
                        record[col] = "<binary>"
                    else:
                        # Try to keep numeric types numeric for charts
                        try:
                            if isinstance(val, (int, float)):
                                record[col] = val
                            else:
                                record[col] = str(val)
                        except Exception:
                            record[col] = str(val)
                data.append(record)

            print(
                f"[BI Pipeline] SQL result for {query_spec.question_id}: "
                f"{len(data)} rows × {len(cols)} columns"
            )
            return ExecutedQuery(
                question_id=query_spec.question_id,
                question=question.question,
                intent=question.intent,
                sql=query_spec.sql,
                columns=cols,
                data=data,
                row_count=len(data),
            )
    except Exception as e:
        print(f"[BI Pipeline] SQL ERROR for {query_spec.question_id}: {e}")
        return ExecutedQuery(
            question_id=query_spec.question_id,
            question=question.question,
            intent=question.intent,
            sql=query_spec.sql,
            error=str(e),
        )


async def _execute_queries_parallel(
    db,
    query_specs: List[SQLQuerySpec],
    questions: List[BusinessQuestion],
    emit: Optional[EmitFn] = None,
) -> List[ExecutedQuery]:
    """Execute all SQL queries in parallel using a thread pool."""
    print(f"[BI Pipeline] Executing {len(query_specs)} SQL queries in parallel…")
    question_map = {q.id: q for q in questions}
    loop = asyncio.get_event_loop()

    async def run_one(spec: SQLQuerySpec) -> ExecutedQuery:
        question = question_map.get(spec.question_id, BusinessQuestion(
            id=spec.question_id,
            question="Unknown question",
            intent=AnalyticalIntent.KPI,
            relevant_tables=[],
        ))
        result = await loop.run_in_executor(
            None, _execute_single_query, db, spec, question
        )
        if emit:
            if result.error:
                await emit("step", {
                    "step": AgentStep(
                        type="tool_result",
                        label=f"SQL Error ({spec.question_id})",
                        detail=result.error[:500],
                    ).model_dump(),
                    "phase": "sql_execution",
                })
            else:
                await emit("step", {
                    "step": AgentStep(
                        type="tool_result",
                        label=f"SQL Result ({spec.question_id})",
                        detail=f"{result.row_count} rows × {len(result.columns)} columns",
                    ).model_dump(),
                    "phase": "sql_execution",
                })
        return result

    tasks = [run_one(spec) for spec in query_specs]
    return await asyncio.gather(*tasks)


# ─── Agent Invocations with Streaming ─────────────────────────────────────────

async def _invoke_structured_agent(
    llm,
    output_schema,
    system_prompt: str,
    user_message: str,
    phase: str,
    emit: Optional[EmitFn] = None,
    cancel_scope: Optional[QueryCancelScope] = None,
    max_retries: int = 2,
) -> Any:
    """Invoke an LLM with structured output, streaming the thinking process.

    Uses with_structured_output() to force Pydantic-validated JSON output.
    Wraps the call with rate-limit-aware retry logic.
    """
    structured_llm = llm.with_structured_output(output_schema)

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message),
    ]

    prompt_size = len(system_prompt) + len(user_message)
    print(
        f"[BI Pipeline] {phase}: Invoking LLM "
        f"(prompt ~{prompt_size} chars, schema={output_schema.__name__})"
    )

    async def _do_invoke():
        """Inner invocation — called by the rate-limit retry wrapper."""
        if emit:
            await emit("status", {
                "phase": phase,
                "text": f"Agent thinking ({phase})…",
            })

        # Try streaming first for thinking visibility
        try:
            full_output = None
            async for chunk in structured_llm.astream(messages):
                if cancel_scope and cancel_scope.is_cancelled():
                    raise asyncio.CancelledError("Cancelled")

                # For structured output, stream events are partial outputs
                # The final chunk is the complete parsed object
                full_output = chunk

                # Emit raw chunk content as thinking if available
                if emit and hasattr(chunk, '__dict__'):
                    try:
                        partial_str = json.dumps(
                            chunk.model_dump() if hasattr(chunk, 'model_dump') else str(chunk),
                            default=str,
                            indent=None,
                        )
                        if len(partial_str) > 5:
                            await emit("thinking_delta", {
                                "text": ".",
                                "phase": phase,
                            })
                    except Exception:
                        pass

            if full_output is not None:
                print(f"[BI Pipeline] {phase}: Structured output received ✓")
                if emit:
                    await emit("status", {
                        "phase": phase,
                        "text": f"{phase} complete ✓",
                    })
                return full_output

        except (AttributeError, NotImplementedError):
            # Streaming not supported, fall back to ainvoke
            print(f"[BI Pipeline] {phase}: Streaming not supported, using ainvoke")

        # Fallback: non-streaming invocation
        result = await structured_llm.ainvoke(messages)
        print(f"[BI Pipeline] {phase}: ainvoke result received ✓")
        if emit:
            await emit("status", {
                "phase": phase,
                "text": f"{phase} complete ✓",
            })
        return result

    # Wrap with rate-limit-aware retry
    return await _rate_limit_retry_wrapper(
        coro_factory=_do_invoke,
        phase=phase,
        emit=emit,
        max_retries=max_retries + MAX_RATE_LIMIT_RETRIES,
    )


# ─── SQL Retry with Error Feedback ────────────────────────────────────────────

async def _retry_failed_queries(
    db,
    llm,
    failed_queries: List[ExecutedQuery],
    schema_context: str,
    questions: List[BusinessQuestion],
    emit: Optional[EmitFn] = None,
    cancel_scope: Optional[QueryCancelScope] = None,
) -> List[ExecutedQuery]:
    """Re-run Agent 2 for queries that failed, providing the error message."""
    if not failed_queries:
        return []

    print(
        f"[BI Pipeline] SQL Retry: {len(failed_queries)} failed queries — "
        + ", ".join(fq.question_id for fq in failed_queries)
    )

    question_map = {q.id: q for q in questions}

    retry_questions_text = ""
    for fq in failed_queries:
        if fq.error:
            issue_str = f"Error: {fq.error}"
        else:
            issue_str = (
                "Issue: The query executed without syntax errors, but returned 0 rows.\n"
                "  Reason: The WHERE clause or date filter was too restrictive.\n"
                "  Guidance: Do not use fragile date subqueries like MAX(date) - INTERVAL. Group by period and use ORDER BY period DESC LIMIT N instead. Or loosen status/category filters."
            )
        retry_questions_text += (
            f"- Question ID: {fq.question_id}\n"
            f"  Question: {fq.question}\n"
            f"  Previous SQL: {fq.sql}\n"
            f"  {issue_str}\n\n"
        )

    retry_prompt = SQL_ENGINEER_PROMPT.format(
        schema_context=schema_context,
        questions_json=retry_questions_text,
    )
    retry_prompt += (
        "\n\nIMPORTANT: The previous SQL queries above either FAILED with syntax errors or RETURNED 0 ROWS. "
        "Fix the SQL to avoid errors and ensure queries return real data. Pay close attention to column names, "
        "table names, date ranges, and relaxing overly strict WHERE clauses (especially for date/status combinations)."
    )

    if emit:
        await emit("status", {
            "phase": "sql_retry",
            "text": f"Retrying {len(failed_queries)} failed SQL queries…",
        })

    try:
        retry_result: SQLQueriesOutput = await _invoke_structured_agent(
            llm=llm,
            output_schema=SQLQueriesOutput,
            system_prompt=retry_prompt,
            user_message="Fix the failed SQL queries listed above.",
            phase="sql_retry",
            emit=emit,
            cancel_scope=cancel_scope,
        )

        # Re-execute the fixed queries
        retry_questions = [
            question_map[fq.question_id]
            for fq in failed_queries
            if fq.question_id in question_map
        ]
        return await _execute_queries_parallel(
            db, retry_result.queries, retry_questions, emit=emit,
        )
    except Exception as e:
        print(f"[BI Pipeline] SQL retry failed: {e}")
        return failed_queries  # Return the originals with errors


# ─── Data Truncation for Dashboard Assembler ──────────────────────────────────

def _truncate_query_data(
    executed_queries: List[ExecutedQuery],
    max_rows_per_query: int = MAX_DATA_ROWS_PER_QUERY,
    max_total_chars: int = MAX_ASSEMBLER_CONTEXT_CHARS,
) -> List[dict]:
    """Truncate query result data to fit within the dashboard assembler's context window.

    Limits rows per query and total JSON size to prevent token limit errors.
    """
    truncated = []
    total_chars = 0

    for eq in executed_queries:
        entry = eq.model_dump()
        # Truncate data rows
        if len(entry.get("data", [])) > max_rows_per_query:
            entry["data"] = entry["data"][:max_rows_per_query]
            entry["_truncated"] = True
            entry["_original_row_count"] = eq.row_count

        # Remove the SQL field — the assembler doesn't need it
        entry.pop("sql", None)
        entry.pop("error", None)

        entry_json = json.dumps(entry, default=str)
        total_chars += len(entry_json)

        if total_chars > max_total_chars and truncated:
            # We've exceeded the budget — further truncate remaining entries
            # Keep only question, intent, columns, and first 5 rows
            entry["data"] = entry["data"][:5]
            entry["_truncated"] = True
            print(
                f"[BI Pipeline] Truncated data for {eq.question_id} to 5 rows "
                f"(context budget exceeded)"
            )

        truncated.append(entry)

    total_json = json.dumps(truncated, default=str)
    print(
        f"[BI Pipeline] Dashboard assembler context: {len(total_json)} chars "
        f"across {len(truncated)} queries"
    )
    return truncated


def _hydrate_dashboard_data(
    output: FinalDashboardOutput,
    executed_queries: List[ExecutedQuery],
) -> FinalDashboardOutput:
    """Automatically populate chart data arrays based on dataSourceId references."""
    # Create a map of query_id -> data
    data_map = {eq.question_id: eq.data for eq in executed_queries}

    for page in output.pages:
        for chart in page.charts:
            ds_id = chart.dataSourceId
            if ds_id and ds_id in data_map:
                # Inject the actual data rows from the executed query
                chart.data = data_map[ds_id]
            elif not chart.data:
                # If no dataSourceId and no data, we can't render it
                print(f"[BI Pipeline] Warning: Chart {chart.id} has no data and no valid dataSourceId ({ds_id})")

    return output

def _clean_kpi_value(v: Any) -> str:
    """Safely extracts a scalar string/number representation from any KPI value.
    Unwraps any dicts or JSON strings like {'value': 527} into '527'.
    """
    if v is None:
        return "0"
    if isinstance(v, dict):
        for k in ["value", "val", "amount", "total", "count", "score"]:
            if k in v:
                return _clean_kpi_value(v[k])
        for val in v.values():
            if isinstance(val, (int, float, str)):
                return _clean_kpi_value(val)
        return str(v)
    if isinstance(v, (int, float)):
        if isinstance(v, float):
            return f"{v:,.2f}" if abs(v) < 1000000 else f"{v:,.0f}"
        return f"{v:,}"
    if isinstance(v, str):
        s = v.strip()
        if (s.startswith("{") and s.endswith("}")) or (s.startswith("{'") and s.endswith("}")):
            try:
                import json
                parsed = json.loads(s.replace("'", '"'))
                return _clean_kpi_value(parsed)
            except Exception:
                pass
        return s
    return str(v)


def _sanitize_chart_data_and_axis(chart: ChartSpec) -> tuple[str, list[dict]]:
    """Ensure xAxisKey is never a raw ID/UUID/hash, and data has clean human-readable labels."""
    x_key = chart.xAxisKey
    rows = [dict(r) for r in (chart.data or [])]
    if not rows:
        return x_key, rows

    sample = rows[0]
    is_id = False
    if x_key:
        x_lower = x_key.lower()
        if any(x_lower.endswith(sfx) for sfx in ["_id", "id", "_uuid", "uuid", "_hash", "hash", "_key"]):
            is_id = True
        first_val = str(sample.get(x_key, ""))
        if len(first_val) >= 20 and " " not in first_val:
            is_id = True

    if is_id:
        # Check if another non-ID text column is present in the data
        better_keys = [
            k for k, v in sample.items()
            if isinstance(v, str)
            and not any(k.lower().endswith(sfx) for sfx in ["_id", "id", "_uuid", "uuid", "_hash", "hash", "_key"])
            and len(v) < 60
        ]
        if better_keys:
            preferred = sorted(
                better_keys,
                key=lambda k: 0 if any(p in k.lower() for p in ["name", "title", "category", "label", "city", "status"]) else 1
            )
            x_key = preferred[0]
            print(f"[BI Pipeline] Switched chart '{chart.id}' xAxisKey from ID to descriptive column '{x_key}'")
        else:
            # Create a clean display column
            entity = x_key.replace("_id", "").replace("id", "").title() or "Item"
            label_key = f"{x_key}_label"
            for idx, r in enumerate(rows):
                raw_id = str(r.get(x_key, ""))
                short_id = raw_id[:6] if len(raw_id) >= 6 else raw_id
                r[label_key] = f"{entity} #{idx + 1} ({short_id})"
            x_key = label_key
            print(f"[BI Pipeline] Formatted raw ID column '{chart.xAxisKey}' into readable labels under '{label_key}'")

    return x_key, rows


# ─── Single Chart / Table Pipeline ───────────────────────────────────────────

_DASHBOARD_SCOPE_KEYWORDS = (
    "dashboard", "overview", "executive report", "full report", "comprehensive",
    "multi-page", "business report", "full analysis", "deep dive across",
)
_TABLE_SCOPE_KEYWORDS = (
    "table", "tabular", "in a table", "as a table", "records list", "list of",
    "show me the rows", "data table",
)


def _should_use_single_chart_pipeline(
    user_query: str,
    questions_output: BusinessQuestionsOutput,
) -> bool:
    """Route to the dedicated single-chart agent instead of the full dashboard pipeline."""
    q_lower = user_query.lower()
    if any(kw in q_lower for kw in _DASHBOARD_SCOPE_KEYWORDS):
        return False
    if questions_output.is_single_chart:
        return True
    if any(kw in q_lower for kw in _TABLE_SCOPE_KEYWORDS):
        return True
    if len(questions_output.questions) <= 1:
        return True
    if len(questions_output.questions) <= 2 and not any(
        kw in q_lower for kw in (" and also ", "multiple", "several charts")
    ):
        return True
    return False


def _execute_sql_for_plan(db, plan: SingleChartPlan) -> ExecutedQuery:
    """Run the single-chart agent's SQL and wrap as ExecutedQuery."""
    spec = SQLQuerySpec(
        question_id="single",
        sql=plan.sql,
        explanation=plan.description,
    )
    question = BusinessQuestion(
        id="single",
        question=plan.title,
        intent=AnalyticalIntent.KPI,
        relevant_tables=[],
    )
    return _execute_single_query(db, spec, question)


def _infer_data_keys_for_table(
    columns: List[str],
    x_axis: str,
    planned_keys: List[ChartDataKeySpec],
) -> List[ChartDataKeySpec]:
    """Ensure table visualizations expose all result columns."""
    planned_by_key = {dk.key: dk for dk in planned_keys}
    keys: List[ChartDataKeySpec] = []
    for col in columns:
        if col == x_axis:
            continue
        if col in planned_by_key:
            keys.append(planned_by_key[col])
        else:
            keys.append(ChartDataKeySpec(
                key=col,
                name=col.replace("_", " ").title(),
            ))
    if not keys and columns:
        for col in columns:
            if col != x_axis:
                keys.append(ChartDataKeySpec(
                    key=col,
                    name=col.replace("_", " ").title(),
                ))
    return keys


def _build_slider_for_plan(
    plan: SingleChartPlan,
    chart_data: List[Dict[str, Any]],
    chart_id: str,
) -> Optional[SliderSpec]:
    if not plan.include_slider or not plan.slider_filter_key or not chart_data:
        return None
    filter_key = plan.slider_filter_key
    nums = [
        float(r[filter_key])
        for r in chart_data
        if isinstance(r.get(filter_key), (int, float))
    ]
    if len(nums) < 2:
        return None
    min_v, max_v = float(min(nums)), float(max(nums))
    if min_v == max_v:
        return None
    return SliderSpec(
        id=f"slider_{filter_key}",
        label=plan.slider_label or f"{filter_key.replace('_', ' ').title()} Filter",
        description=f"Filter rows where {filter_key} {plan.slider_operator} selected value",
        filterKey=filter_key,
        sliderMin=min_v,
        sliderMax=max_v,
        sliderStep=max(1.0, round((max_v - min_v) / 25.0, 2)),
        defaultValue=min_v,
        sliderUnit=plan.slider_unit,
        targetScope="chart",
        targetChartIds=[chart_id],
        operator=plan.slider_operator,
    )


def _normalize_single_chart_content(summary: str) -> str:
    text = (summary or "").strip()
    if not text:
        return (
            "### Key Takeaways\n"
            "- Visualization generated from your query.\n\n"
            "### Recommendations\n"
            "- Adjust filters or ask a follow-up for more detail."
        )
    if "### Key Takeaways" not in text:
        text = "### Key Takeaways\n" + text
    return text


def _plan_to_final_dashboard(
    user_query: str,
    plan: SingleChartPlan,
    executed: ExecutedQuery,
) -> FinalDashboardOutput:
    """Build a minimal one-page dashboard from a SingleChartPlan and query results."""
    max_rows = MAX_SINGLE_TABLE_ROWS if plan.chart_type == "table" else MAX_SINGLE_CHART_ROWS

    # Use the lapped executed data
    chart_data = [dict(r) for r in (executed.data or [])[:max_rows]]

    x_key = plan.xAxisKey
    if chart_data and x_key not in chart_data[0] and executed.columns:
        x_key = executed.columns[0]

    data_keys = plan.dataKeys
    if plan.chart_type == "table":
        data_keys = _infer_data_keys_for_table(executed.columns, x_key, plan.dataKeys)

    chart = ChartSpec(
        id="chart_single",
        title=plan.title,
        description=plan.description,
        type=plan.chart_type,
        xAxisKey=x_key,
        dataKeys=data_keys,
        data=chart_data,
        dataSourceId=plan.dataSourceId or "single",
    )
    clean_x_key, clean_data = _sanitize_chart_data_and_axis(chart)
    chart = chart.model_copy(update={"xAxisKey": clean_x_key, "data": clean_data})

    if chart.type == "map":
        from Utils.geo_lookup import enrich_rows_with_coordinates
        enriched, lat_k, lng_k, auto_lbl = enrich_rows_with_coordinates(
            clean_data, preferred_loc_col=clean_x_key
        )
        chart = chart.model_copy(update={
            "data": enriched,
            "latKey": lat_k,
            "lngKey": lng_k,
            "markerLabel": auto_lbl or clean_x_key,
            "valueKey": data_keys[0].key if data_keys else None,
        })

    page_sliders: List[SliderSpec] = []
    slider = _build_slider_for_plan(plan, clean_data, chart.id)
    if slider:
        page_sliders.append(slider)

    page = DashboardPageSpec(
        id="single_view",
        name=plan.title[:48] or "Analysis",
        icon="analytics",
        summary=plan.description or user_query[:120],
        insights=[],
        kpis=[],
        charts=[chart],
        sliders=page_sliders or None,
    )

    return FinalDashboardOutput(
        dashboard_title=plan.title,
        dashboard_subtitle=plan.description or user_query[:160],
        content=_normalize_single_chart_content(plan.summary),
        pages=[page],
    )


async def _run_single_chart_pipeline(
    user_query: str,
    db,
    schema_context: str,
    *,
    model_id: Optional[str] = None,
    emit: Optional[EmitFn] = None,
    cancel_scope: Optional[QueryCancelScope] = None,
    all_steps: Optional[List[AgentStep]] = None,
    pipeline_start: Optional[float] = None,
    lang: str = "en",
) -> QueryResponse:
    """Dedicated agent path: one SQL query → one chart or table (optional slider)."""
    steps = all_steps if all_steps is not None else []
    t0 = pipeline_start if pipeline_start is not None else time.time()

    print(f"\n[BI Pipeline] ── SINGLE CHART / TABLE BRANCH (lang={lang}) ──")
    if emit:
        await emit("status", {
            "phase": "single_chart_agent",
            "text": "Planning single chart or table…",
        })

    strong_llm = _get_strong_model(model_id)
    agent_prompt = get_single_chart_prompt(lang).format(
        schema_context=schema_context,
        user_query=user_query,
    )

    agent_start = time.time()
    plan: SingleChartPlan = await _invoke_structured_agent(
        llm=strong_llm,
        output_schema=SingleChartPlan,
        system_prompt=agent_prompt,
        user_message=user_query,
        phase="single_chart_agent",
        emit=emit,
        cancel_scope=cancel_scope,
    )
    print(
        f"[BI Pipeline] Single Chart Agent done ({time.time() - agent_start:.1f}s): "
        f"type={plan.chart_type}, slider={plan.include_slider}"
    )

    steps.append(AgentStep(
        type="tool_call",
        label="Single Chart SQL",
        detail=plan.sql[:800],
    ))
    if emit:
        await emit("step", {"step": steps[-1].model_dump(), "phase": "single_chart_agent"})

    if emit:
        await emit("status", {"phase": "sql_execution", "text": "Running query…"})

    executed = _execute_sql_for_plan(db, plan)

    if executed.error or executed.row_count == 0:
        issue_label = "FAILED WITH ERROR" if executed.error else "RETURNED 0 ROWS"
        issue_desc = (
            f"ERROR:\n{executed.error}"
            if executed.error
            else (
                "ZERO ROWS RETURNED:\n"
                "The query executed without syntax errors, but produced 0 rows.\n"
                "This usually happens when WHERE conditions or date filters are too restrictive.\n"
                "- If comparing recent periods ('this month vs last month', 'latest sales', 'recent trajectory'), "
                "DO NOT use fragile date subqueries like `WHERE date >= (SELECT DATE_TRUNC('month', MAX(date)) - INTERVAL '1 month')`.\n"
                "- INSTEAD, group by the date period, filter valid statuses, and use `ORDER BY 1 DESC LIMIT N`.\n"
                "- Check if combining multiple filters (e.g. status='delivered' AND date cutoff) eliminated all matching rows."
            )
        )
        print(f"[BI Pipeline] Single chart SQL {issue_label.lower()}: {issue_desc}")
        retry_prompt = agent_prompt + (
            f"\n\nPREVIOUS SQL ATTEMPT ({issue_label}):\n{plan.sql}\n\n{issue_desc}\n\n"
            "Return corrected SQL and the visualization plan that actually returns data."
        )
        try:
            plan = await _invoke_structured_agent(
                llm=strong_llm,
                output_schema=SingleChartPlan,
                system_prompt=retry_prompt,
                user_message="Fix the SQL so it returns matching data, and return the visualization plan.",
                phase="single_chart_agent",
                emit=emit,
                cancel_scope=cancel_scope,
            )
            executed = _execute_sql_for_plan(db, plan)
        except Exception as retry_err:
            print(f"[BI Pipeline] Single chart SQL retry failed: {retry_err}")

    if executed.error or executed.row_count == 0:
        detail = executed.error or "Query returned no rows."
        return QueryResponse(
            answer=(
                "I couldn't retrieve data for that chart or table. "
                f"{detail[:300]}"
            ),
            agent="use_data_analysis_and_visualization_agent",
            steps=steps,
        )

    steps.append(AgentStep(
        type="tool_result",
        label="Single Chart Result",
        detail=f"{executed.row_count} rows × {len(executed.columns)} columns",
    ))
    if emit:
        await emit("step", {"step": steps[-1].model_dump(), "phase": "sql_execution"})

    if emit:
        await emit("status", {
            "phase": "single_chart_assembly",
            "text": "Assembling visualization…",
        })

    dashboard_output = _plan_to_final_dashboard(user_query, plan, executed)
    dashboard_spec = _to_dashboard_spec(dashboard_output)

    total_time = time.time() - t0
    print(
        f"[BI Pipeline] === SINGLE CHART COMPLETE ({total_time:.1f}s) — "
        f"1 page, 1 chart, type={plan.chart_type} ==="
    )

    return QueryResponse(
        answer=dashboard_output.content,
        agent="use_data_analysis_and_visualization_agent",
        dashboard=dashboard_spec,
        steps=steps,
    )


def _to_dashboard_spec(output: FinalDashboardOutput) -> DashboardSpec:
    """Convert the pipeline's FinalDashboardOutput to the existing DashboardSpec."""
    pages = []
    for page in output.pages:
        charts = []
        for chart in page.charts:
            clean_x_key, clean_data = _sanitize_chart_data_and_axis(chart)
            lat_k = chart.latKey
            lng_k = chart.lngKey
            marker_lbl = chart.markerLabel or clean_x_key

            if chart.type == "map":
                from Utils.geo_lookup import enrich_rows_with_coordinates
                clean_data, enriched_lat, enriched_lng, auto_lbl = enrich_rows_with_coordinates(
                    clean_data, preferred_loc_col=clean_x_key
                )
                if enriched_lat and enriched_lng:
                    lat_k = enriched_lat
                    lng_k = enriched_lng
                    marker_lbl = marker_lbl or auto_lbl

            charts.append(DashboardChart(
                id=chart.id,
                title=chart.title,
                description=chart.description,
                type=chart.type,
                xAxisKey=clean_x_key,
                dataKeys=[
                    ChartDataKey(key=dk.key, name=dk.name, color=dk.color)
                    for dk in chart.dataKeys
                ],
                data=clean_data,
                # Map-specific fields
                **({"latKey": lat_k} if lat_k else {}),
                **({"lngKey": lng_k} if lng_k else {}),
                **({"valueKey": chart.valueKey} if chart.valueKey else {}),
                **({"markerLabel": marker_lbl} if marker_lbl else {}),
                # Slider-specific fields
                **({"sliderMin": chart.sliderMin} if chart.sliderMin is not None else {}),
                **({"sliderMax": chart.sliderMax} if chart.sliderMax is not None else {}),
                **({"sliderStep": chart.sliderStep} if chart.sliderStep is not None else {}),
                **({"filterKey": chart.filterKey} if chart.filterKey else {}),
                **({"sliderUnit": chart.sliderUnit} if chart.sliderUnit else {}),
            ))

        kpis = [
            DashboardKpi(
                label=k.label,
                value=_clean_kpi_value(k.value),
                change=k.change,
                description=k.description,
            )
            for k in page.kpis
        ]

        page_sliders = [
            DashboardSlider(
                id=s.id,
                label=s.label,
                description=s.description,
                filterKey=s.filterKey,
                sliderMin=s.sliderMin,
                sliderMax=s.sliderMax,
                sliderStep=s.sliderStep,
                defaultValue=s.defaultValue,
                sliderUnit=s.sliderUnit,
                targetScope=s.targetScope,
                targetChartIds=s.targetChartIds,
                operator=s.operator,
            )
            for s in (page.sliders or [])
        ]

        pages.append(DashboardPage(
            id=page.id,
            name=page.name,
            icon=page.icon,
            summary=page.summary,
            insights=page.insights,
            kpis=kpis,
            charts=charts,
            sliders=page_sliders if page_sliders else None,
        ))

    global_sliders = [
        DashboardSlider(
            id=s.id,
            label=s.label,
            description=s.description,
            filterKey=s.filterKey,
            sliderMin=s.sliderMin,
            sliderMax=s.sliderMax,
            sliderStep=s.sliderStep,
            defaultValue=s.defaultValue,
            sliderUnit=s.sliderUnit,
            targetScope=s.targetScope,
            targetChartIds=s.targetChartIds,
            operator=s.operator,
        )
        for s in (output.global_sliders or [])
    ]

    return DashboardSpec(
        title=output.dashboard_title,
        subtitle=output.dashboard_subtitle,
        pages=pages,
        global_sliders=global_sliders if global_sliders else None,
        sliders=global_sliders if global_sliders else None,
    )


def _build_fallback_dashboard_output(
    user_query: str,
    valid_results: List[ExecutedQuery],
    questions_output: BusinessQuestionsOutput,
    lang: str = "en",
) -> FinalDashboardOutput:
    """Fallback generator when Agent 3 LLM fails (e.g. rate limit exhausted).
    Builds a complete, valid FinalDashboardOutput directly from the executed query data.
    """
    from schemas.bi_pipeline_models import (
        DashboardPageSpec,
        ChartSpec,
        ChartDataKeySpec,
        KPISpec,
        SliderSpec,
    )
    pages = []
    colors = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#14B8A6"]

    charts = []
    kpis = []
    fallback_sliders = []

    for k_idx, eq in enumerate(valid_results):
        if not eq.data:
            continue

        cols = eq.columns
        sample_row = eq.data[0]
        numeric_cols = [c for c in cols if isinstance(sample_row.get(c), (int, float))]
        text_cols = [c for c in cols if c not in numeric_cols]

        # Prioritize descriptive non-ID columns for x_key
        non_id_text_cols = [
            c for c in text_cols
            if not any(c.lower().endswith(sfx) for sfx in ["_id", "id", "_uuid", "uuid", "_hash", "hash", "_key"])
        ]
        x_key = non_id_text_cols[0] if non_id_text_cols else (text_cols[0] if text_cols else cols[0])
        y_keys = numeric_cols if numeric_cols else [cols[-1]]

        # If x_key is still an ID, create readable labels
        chart_data = [dict(r) for r in eq.data[:15]]
        if not non_id_text_cols and x_key:
            entity = x_key.replace("_id", "").replace("id", "").title() or "Item"
            alias_key = f"{x_key}_label"
            for idx, r in enumerate(chart_data):
                old_val = str(r.get(x_key, ""))
                short_id = old_val[:6] if len(old_val) >= 6 else old_val
                r[alias_key] = f"{entity} #{idx + 1} ({short_id})"
            x_key = alias_key

        lat_col = next((c for c in cols if any(term in c.lower() for term in ["lat", "latitude"])), None)
        lng_col = next((c for c in cols if any(term in c.lower() for term in ["lng", "lon", "longitude"])), None)

        chart_type = "bar"
        if (lat_col and lng_col) or eq.intent == AnalyticalIntent.GEOGRAPHIC:
            chart_type = "map"
        elif eq.intent == AnalyticalIntent.TREND:
            chart_type = "area"
        elif eq.intent == AnalyticalIntent.DISTRIBUTION:
            chart_type = "donut"
        elif eq.intent == AnalyticalIntent.COMPARISON:
            chart_type = "bar"

        marker_label_col = x_key
        if chart_type == "map":
            from Utils.geo_lookup import enrich_rows_with_coordinates
            chart_data, enriched_lat, enriched_lng, auto_lbl = enrich_rows_with_coordinates(
                chart_data, preferred_loc_col=x_key
            )
            if enriched_lat and enriched_lng:
                lat_col = enriched_lat
                lng_col = enriched_lng
                marker_label_col = auto_lbl or x_key

        data_keys = [
            ChartDataKeySpec(
                key=yk,
                name=yk.replace("_", " ").title(),
                color=colors[(k_idx + dk_idx) % len(colors)],
            )
            for dk_idx, yk in enumerate(y_keys[:3])
        ]

        charts.append(ChartSpec(
            id=f"chart_{eq.question_id}",
            title=eq.question,
            description=f"Based on {eq.row_count} records",
            type=chart_type,
            xAxisKey=x_key,
            dataKeys=data_keys,
            data=chart_data,
            latKey=lat_col if chart_type == "map" else None,
            lngKey=lng_col if chart_type == "map" else None,
            markerLabel=marker_label_col if chart_type == "map" else None,
        ))

        if numeric_cols:
            val = sample_row.get(numeric_cols[0], 0)
            formatted_val = f"{val:,.2f}" if isinstance(val, float) else f"{val:,}" if isinstance(val, int) else str(val)
            kpis.append(KPISpec(
                label=numeric_cols[0].replace("_", " ").title(),
                value=formatted_val,
                description=f"From {eq.question_id}",
            ))
        elif eq.row_count:
            kpis.append(KPISpec(
                label=f"Records ({eq.question_id})",
                value=str(eq.row_count),
                description=eq.question[:35],
            ))

    if not kpis:
        kpis.append(KPISpec(label="Executed Queries", value=str(len(valid_results)), description="Total successful queries"))

    insights = [
        f"Completed automated analysis answering {len(valid_results)} business questions.",
        f"Primary dataset spans {valid_results[0].row_count if valid_results else 0} records across active tables.",
        "Visualizations compiled directly from real database records.",
    ]

    # If any chart data has numeric columns with variance, create an interactive threshold slider
    for c in charts:
        if c.data and c.dataKeys:
            metric_k = c.dataKeys[0].key
            nums = [float(r[metric_k]) for r in c.data if isinstance(r.get(metric_k), (int, float))]
            if len(nums) >= 3 and max(nums) > min(nums):
                min_v = float(min(nums))
                max_v = float(max(nums))
                fallback_sliders.append(SliderSpec(
                    id=f"slider_{metric_k}",
                    label=f"{c.dataKeys[0].name} Threshold",
                    description=f"Filter data by {c.dataKeys[0].name}",
                    filterKey=metric_k,
                    sliderMin=min_v,
                    sliderMax=max_v,
                    sliderStep=max(1.0, round((max_v - min_v) / 20.0, 1)),
                    defaultValue=min_v,
                    sliderUnit="",
                    targetScope="page",
                    operator=">=",
                ))
                break

    single_mode = questions_output.is_single_chart
    page_charts = charts[:1] if single_mode else charts[:4]
    page_kpis = [] if single_mode else kpis[:4]

    if lang == "ar":
        page_name = "نظرة عامة تنفيذية" if not single_mode else (page_charts[0].title[:48] if page_charts else "التحليل")
        page_summary = f"نظرة عامة على التحليل لـ: {user_query}"
        takeaways = [
            f"- تم بنجاح تنفيذ {len(valid_results)} استعلام SQL مطابق لطلبك.",
        ]
        for eq in valid_results[:3]:
            takeaways.append(f"- {eq.question}: تم استرجاع {eq.row_count} سجل.")
        content = (
            "### أهم النقاط\n"
            + "\n".join(takeaways)
            + "\n\n### التوصيات\n"
            "- راجع الرسوم البيانية وبطاقات الأداء للاطلاع على المؤشرات الرئيسية.\n"
            "- تابع باستعلامات أكثر تفصيلاً حول اتجاهات أو قطاعات محددة."
        )
        dashboard_title = "لوحة تحكم ذكاء الأعمال"
        dashboard_subtitle = f"تحليل آلي لـ: {user_query}"
    else:
        page_name = "Executive Overview" if not single_mode else (page_charts[0].title[:48] if page_charts else "Analysis")
        page_summary = f"Analysis overview for: {user_query}"
        takeaways = [
            f"- Successfully executed {len(valid_results)} SQL queries matching your request.",
        ]
        for eq in valid_results[:3]:
            takeaways.append(f"- {eq.question}: {eq.row_count} records retrieved.")
        content = (
            "### Key Takeaways\n"
            + "\n".join(takeaways)
            + "\n\n### Recommendations\n"
            "- Examine the charts and KPI scorecards for key performance indicators.\n"
            "- Follow up with more targeted queries on specific trends or segments."
        )
        dashboard_title = "Business Intelligence Dashboard"
        dashboard_subtitle = f"Automated analysis for: {user_query}"

    pages.append(DashboardPageSpec(
        id="overview" if not single_mode else "single_view",
        name=page_name,
        icon="overview" if not single_mode else "analytics",
        summary=page_summary,
        insights=[] if single_mode else insights,
        kpis=page_kpis,
        charts=page_charts,
        sliders=fallback_sliders if fallback_sliders and not single_mode else None,
    ))

    return FinalDashboardOutput(
        dashboard_title=dashboard_title,
        dashboard_subtitle=dashboard_subtitle,
        content=content,
        pages=pages,
    )


# ─── Main Pipeline Orchestrator ───────────────────────────────────────────────

async def run_bi_pipeline(
    user_query: str,
    db,
    tables: List[str],
    *,
    model_id: Optional[str] = None,
    emit: Optional[EmitFn] = None,
    request=None,
    cancel_scope: Optional[QueryCancelScope] = None,
    lang: str = "en",
) -> QueryResponse:
    """Run the full 3-agent BI analysis pipeline with streaming.

    Args:
        user_query: The user's natural language question.
        db: SQLDatabase instance for the active data source.
        tables: List of available table names.
        model_id: Optional model ID override from the frontend.
        emit: SSE emit function for streaming events.
        request: FastAPI Request for disconnect detection.
        cancel_scope: Cancellation scope for cooperative abort.

    Returns:
        QueryResponse ready for the frontend.
    """
    pipeline_start = time.time()
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === STARTING BI PIPELINE ===")
    print(f"[BI Pipeline] Query: {user_query[:100]}{'…' if len(user_query) > 100 else ''}")
    print(f"[BI Pipeline] Tables: {tables}")
    print(f"[BI Pipeline] Model ID: {model_id or 'default'}")
    print(f"{'='*60}")

    all_steps: List[AgentStep] = []

    # ── Pre-fetch schema context ──────────────────────────────────────────
    print(f"\n[BI Pipeline] ── STEP 0: Schema Context ──")
    if emit:
        await emit("status", {"phase": "schema", "text": "Inspecting database schema…"})

    schema_start = time.time()
    schema_context = await asyncio.get_event_loop().run_in_executor(
        None, build_schema_context, db, tables,
    )
    print(
        f"[BI Pipeline] Schema context built: {len(schema_context)} chars "
        f"({time.time() - schema_start:.1f}s)"
    )

    if emit:
        await emit("step", {
            "step": AgentStep(
                type="tool_result",
                label="Schema Inspection",
                detail=f"Loaded schema for {len(tables)} tables with sample rows",
            ).model_dump(),
            "phase": "schema",
        })

    # ── Agent 1: Question Planner (local model) ──────────────────────────
    print(f"\n[BI Pipeline] ── STEP 1: Question Planner (local model) ──")
    if emit:
        await emit("status", {
            "phase": "question_planner",
            "text": "Analyzing your question…",
        })
        await emit("step", {
            "step": AgentStep(
                type="reasoning",
                label="Question Planner",
                detail="Decomposing query into business questions…",
            ).model_dump(),
            "phase": "question_planner",
        })

    local_llm = _get_local_model(model_id)

    planner_prompt = QUESTION_PLANNER_PROMPT.format(
        schema_context=schema_context,
    )

    agent1_start = time.time()
    try:
        questions_output: BusinessQuestionsOutput = await _invoke_structured_agent(
            llm=local_llm,
            output_schema=BusinessQuestionsOutput,
            system_prompt=planner_prompt,
            user_message=user_query,
            phase="question_planner",
            emit=emit,
            cancel_scope=cancel_scope,
        )
        print(
            f"[BI Pipeline] Question Planner done ({time.time() - agent1_start:.1f}s): "
            f"{len(questions_output.questions)} questions"
        )
    except Exception as e:
        # Fallback: generate a generic overview if Agent 1 fails
        print(
            f"[BI Pipeline] Question Planner FAILED ({time.time() - agent1_start:.1f}s): "
            f"{e}. Using fallback questions."
        )
        if emit:
            await emit("status", {
                "phase": "question_planner",
                "text": "Using fallback analysis strategy…",
            })
        questions_output = _generate_fallback_questions(tables)

    for q in questions_output.questions:
        print(f"[BI Pipeline]   {q.id}. [{q.intent.value}] {q.question}")

    all_steps.append(AgentStep(
        type="reasoning",
        label="Question Planner Result",
        detail=(
            f"Intent: {questions_output.user_intent_summary}\n"
            f"Single chart: {questions_output.is_single_chart}\n"
            f"Questions ({len(questions_output.questions)}):\n"
            + "\n".join(
                f"  {q.id}. [{q.intent.value}] {q.question}"
                for q in questions_output.questions
            )
        ),
    ))

    if emit:
        await emit("step", {
            "step": all_steps[-1].model_dump(),
            "phase": "question_planner",
        })

    if _should_use_single_chart_pipeline(user_query, questions_output):
        response = await _run_single_chart_pipeline(
            user_query,
            db,
            schema_context,
            model_id=model_id,
            emit=emit,
            cancel_scope=cancel_scope,
            all_steps=all_steps,
            pipeline_start=pipeline_start,
            lang=lang,
        )
        # Hydrate the single chart result before returning
        if response.dashboard:
            # We need the executed query results to hydrate.
            # Since _run_single_chart_pipeline doesn't return them,
            # we need to modify it or re-execute.
            # Let's check the response.dashboard structure.
            pass
        return response

    # ── Agent 2: SQL Engineer (strong model) ─────────────────────────────
    print(f"\n[BI Pipeline] ── STEP 2: SQL Engineer (strong model) ──")
    if emit:
        await emit("status", {
            "phase": "sql_engineer",
            "text": "Writing SQL queries…",
        })

    strong_llm = _get_strong_model(model_id)

    questions_json = json.dumps(
        [q.model_dump() for q in questions_output.questions],
        indent=2,
    )

    sql_prompt = SQL_ENGINEER_PROMPT.format(
        schema_context=schema_context,
        questions_json=questions_json,
    )

    agent2_start = time.time()
    sql_output: SQLQueriesOutput = await _invoke_structured_agent(
        llm=strong_llm,
        output_schema=SQLQueriesOutput,
        system_prompt=sql_prompt,
        user_message=f"Write SQL queries for these {len(questions_output.questions)} business questions.",
        phase="sql_engineer",
        emit=emit,
        cancel_scope=cancel_scope,
    )
    print(
        f"[BI Pipeline] SQL Engineer done ({time.time() - agent2_start:.1f}s): "
        f"{len(sql_output.queries)} queries"
    )

    # Log the generated SQL
    for q_spec in sql_output.queries:
        print(f"[BI Pipeline]   {q_spec.question_id}: {q_spec.sql[:100]}…")
        all_steps.append(AgentStep(
            type="tool_call",
            label=f"SQL ({q_spec.question_id})",
            detail=q_spec.sql[:800],
        ))
        if emit:
            await emit("step", {
                "step": all_steps[-1].model_dump(),
                "phase": "sql_engineer",
            })

    # ── Execute SQL in parallel ──────────────────────────────────────────
    print(f"\n[BI Pipeline] ── STEP 3: Parallel SQL Execution ──")
    if emit:
        await emit("status", {
            "phase": "sql_execution",
            "text": f"Executing {len(sql_output.queries)} queries in parallel…",
        })

    exec_start = time.time()
    executed = await _execute_queries_parallel(
        db, sql_output.queries, questions_output.questions, emit=emit,
    )
    print(
        f"[BI Pipeline] SQL execution done ({time.time() - exec_start:.1f}s): "
        f"{sum(1 for eq in executed if not eq.error)}/{len(executed)} succeeded"
    )

    # ── SQL Retry for failed or empty queries ─────────────────────
    failed = [eq for eq in executed if eq.error or eq.row_count == 0]
    succeeded = [eq for eq in executed if not eq.error and eq.row_count > 0]

    if failed:
        print(
            f"\n[BI Pipeline] ── STEP 3b: SQL Retry ({len(failed)} failed or empty) ──"
        )
        if emit:
            await emit("status", {
                "phase": "sql_retry",
                "text": f"Retrying {len(failed)} failed or empty queries…",
            })

        retried = await _retry_failed_queries(
            db, strong_llm, failed, schema_context,
            questions_output.questions, emit=emit, cancel_scope=cancel_scope,
        )

        # Merge: replace failed with retried results
        retried_map = {eq.question_id: eq for eq in retried}
        executed = succeeded + [
            retried_map.get(fq.question_id, fq) for fq in failed
        ]

        retry_succeeded = sum(1 for eq in retried if not eq.error)
        print(
            f"[BI Pipeline] SQL retry: {retry_succeeded}/{len(failed)} fixed"
        )

    # Log execution results
    for eq in executed:
        status = f"✓ {eq.row_count} rows" if not eq.error else f"✗ {eq.error[:200]}"
        all_steps.append(AgentStep(
            type="tool_result",
            label=f"Result ({eq.question_id})",
            detail=f"{eq.question}: {status}",
        ))

    # Filter out completely failed queries for the dashboard
    valid_results = [eq for eq in executed if not eq.error and eq.row_count > 0]

    if not valid_results:
        print(f"[BI Pipeline] ✗ No valid results — aborting pipeline")
        return QueryResponse(
            answer="I was unable to retrieve data from the database to build the dashboard. "
                   "The SQL queries returned errors or empty results. Please try rephrasing your question.",
            agent="use_data_analysis_and_visualization_agent",
            steps=all_steps,
        )

    # ── Agent 3: Dashboard Assembler (local model) ───────────────────────
    print(f"\n[BI Pipeline] ── STEP 4: Dashboard Assembler ──")
    if emit:
        await emit("status", {
            "phase": "dashboard_assembler",
            "text": "Designing dashboard layout…",
        })

    # Truncate data to fit within token limits
    truncated_data = _truncate_query_data(valid_results)
    executed_queries_json = json.dumps(truncated_data, indent=2, default=str)

    assembler_prompt = get_dashboard_assembler_prompt(lang).format(
        user_query=user_query,
        executed_queries_json=executed_queries_json,
    )

    agent3_start = time.time()
    try:
        dashboard_output: FinalDashboardOutput = await _invoke_structured_agent(
            llm=local_llm,
            output_schema=FinalDashboardOutput,
            system_prompt=assembler_prompt,
            user_message=(
                f"Build the dashboard for: {user_query}\n\n"
                f"is_single_chart: {questions_output.is_single_chart}\n"
                f"Number of data results: {len(valid_results)}"
            ),
            phase="dashboard_assembler",
            emit=emit,
            cancel_scope=cancel_scope,
        )
        print(
            f"[BI Pipeline] Dashboard Assembler LLM completed ({time.time() - agent3_start:.1f}s): "
            f"{len(dashboard_output.pages)} page(s) created"
        )
    except Exception as e:
        print(
            f"\n[BI Pipeline] ⚠️ Dashboard Assembler LLM failed ({e}). "
            f"Switching to resilient fallback dashboard assembler..."
        )
        if emit:
            await emit("status", {
                "phase": "dashboard_assembler",
                "text": "Assembling dashboard layout from query results…",
            })
        dashboard_output = _build_fallback_dashboard_output(user_query, valid_results, questions_output, lang=lang)
        print(
            f"[BI Pipeline] Fallback dashboard assembler completed ({time.time() - agent3_start:.1f}s): "
            f"{len(dashboard_output.pages)} page(s) generated"
        )

    all_steps.append(AgentStep(
        type="reasoning",
        label="Dashboard Assembler",
        detail=(
            f"Created {len(dashboard_output.pages)} page(s): "
            + ", ".join(p.name for p in dashboard_output.pages)
        ),
    ))

    if emit:
        await emit("step", {
            "step": all_steps[-1].model_dump(),
            "phase": "dashboard_assembler",
        })

    # ── Convert to frontend DashboardSpec ─────────────────────────────────
    dashboard_output = _hydrate_dashboard_data(dashboard_output, valid_results)
    dashboard_spec = _to_dashboard_spec(dashboard_output)


    total_time = time.time() - pipeline_start
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === PIPELINE COMPLETE ({total_time:.1f}s total) ===")
    print(
        f"[BI Pipeline] {len(dashboard_output.pages)} pages, "
        f"{sum(len(p.charts) for p in dashboard_output.pages)} charts, "
        f"{sum(len(p.kpis) for p in dashboard_output.pages)} KPIs"
    )
    print(f"{'='*60}\n")

    return QueryResponse(
        answer=dashboard_output.content,
        agent="use_data_analysis_and_visualization_agent",
        dashboard=dashboard_spec,
        steps=all_steps,
    )


# ─── Checkpoint Strategy: Split Pipeline into Two Phases ──────────────────────

async def run_bi_data_phase(
    user_query: str,
    db,
    tables: List[str],
    *,
    model_id: Optional[str] = None,
    emit: Optional[EmitFn] = None,
    request=None,
    cancel_scope: Optional[QueryCancelScope] = None,
    lang: str = "en",
) -> Dict[str, Any]:
    """Phase 1 of the checkpoint strategy: Schema → Questions → SQL → Execution.

    Runs Steps 0-3 of the BI pipeline and returns intermediate results
    so they can be passed to run_bi_assembly_phase in a separate request,
    giving each phase its own fresh Vercel timeout window.

    Returns:
        Dict with keys:
        - executed_queries: List of ExecutedQuery dicts (serialized)
        - all_steps: List of AgentStep dicts (serialized)
        - questions_output: BusinessQuestionsOutput dict (serialized)
        - user_query: The original user query
        - is_single_chart: Whether the single-chart pipeline was used
        - single_chart_response: If single-chart path was taken, the full QueryResponse dict
    """
    pipeline_start = time.time()
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === DATA PHASE START ===")
    print(f"[BI Pipeline] Query: {user_query[:100]}{'…' if len(user_query) > 100 else ''}")
    print(f"[BI Pipeline] Tables: {tables}")
    print(f"[BI Pipeline] Model ID: {model_id or 'default'}")
    print(f"{'='*60}")

    all_steps: List[AgentStep] = []

    # ── STEP 0: Schema Context ──
    print(f"\n[BI Pipeline] ── STEP 0: Schema Context ──")
    if emit:
        await emit("status", {"phase": "schema", "text": "Inspecting database schema…"})

    schema_start = time.time()
    schema_context = await asyncio.get_event_loop().run_in_executor(
        None, build_schema_context, db, tables,
    )
    print(
        f"[BI Pipeline] Schema context built: {len(schema_context)} chars "
        f"({time.time() - schema_start:.1f}s)"
    )

    if emit:
        await emit("step", {
            "step": AgentStep(
                type="tool_result",
                label="Schema Inspection",
                detail=f"Loaded schema for {len(tables)} tables with sample rows",
            ).model_dump(),
            "phase": "schema",
        })

    # ── STEP 1: Question Planner (local model) ──
    print(f"\n[BI Pipeline] ── STEP 1: Question Planner (local model) ──")
    if emit:
        await emit("status", {
            "phase": "question_planner",
            "text": "Analyzing your question…",
        })
        await emit("step", {
            "step": AgentStep(
                type="reasoning",
                label="Question Planner",
                detail="Decomposing query into business questions…",
            ).model_dump(),
            "phase": "question_planner",
        })

    local_llm = _get_local_model(model_id)

    planner_prompt = QUESTION_PLANNER_PROMPT.format(
        schema_context=schema_context,
    )

    agent1_start = time.time()
    try:
        questions_output: BusinessQuestionsOutput = await _invoke_structured_agent(
            llm=local_llm,
            output_schema=BusinessQuestionsOutput,
            system_prompt=planner_prompt,
            user_message=user_query,
            phase="question_planner",
            emit=emit,
            cancel_scope=cancel_scope,
        )
        print(
            f"[BI Pipeline] Question Planner done ({time.time() - agent1_start:.1f}s): "
            f"{len(questions_output.questions)} questions"
        )
    except Exception as e:
        print(
            f"[BI Pipeline] Question Planner FAILED ({time.time() - agent1_start:.1f}s): "
            f"{e}. Using fallback questions."
        )
        if emit:
            await emit("status", {
                "phase": "question_planner",
                "text": "Using fallback analysis strategy…",
            })
        questions_output = _generate_fallback_questions(tables)

    for q in questions_output.questions:
        print(f"[BI Pipeline]   {q.id}. [{q.intent.value}] {q.question}")

    all_steps.append(AgentStep(
        type="reasoning",
        label="Question Planner Result",
        detail=(
            f"Intent: {questions_output.user_intent_summary}\n"
            f"Single chart: {questions_output.is_single_chart}\n"
            f"Questions ({len(questions_output.questions)}):\n"
            + "\n".join(
                f"  {q.id}. [{q.intent.value}] {q.question}"
                for q in questions_output.questions
            )
        ),
    ))

    if emit:
        await emit("step", {
            "step": all_steps[-1].model_dump(),
            "phase": "question_planner",
        })

    # ── Check for single-chart path ──
    if _should_use_single_chart_pipeline(user_query, questions_output):
        response = await _run_single_chart_pipeline(
            user_query,
            db,
            schema_context,
            model_id=model_id,
            emit=emit,
            cancel_scope=cancel_scope,
            all_steps=all_steps,
            pipeline_start=pipeline_start,
            lang=lang,
        )
        print(f"[BI Pipeline] === DATA PHASE COMPLETE (single chart path) ===")
        return {
            "is_single_chart": True,
            "single_chart_response": response.model_dump(mode="json"),
            "executed_queries": [],
            "all_steps": [s.model_dump() for s in all_steps],
            "questions_output": questions_output.model_dump(),
            "user_query": user_query,
        }

    # ── STEP 2: SQL Engineer (strong model) ──
    print(f"\n[BI Pipeline] ── STEP 2: SQL Engineer (strong model) ──")
    if emit:
        await emit("status", {
            "phase": "sql_engineer",
            "text": "Writing SQL queries…",
        })

    strong_llm = _get_strong_model(model_id)

    questions_json = json.dumps(
        [q.model_dump() for q in questions_output.questions],
        indent=2,
    )

    sql_prompt = SQL_ENGINEER_PROMPT.format(
        schema_context=schema_context,
        questions_json=questions_json,
    )

    agent2_start = time.time()
    sql_output: SQLQueriesOutput = await _invoke_structured_agent(
        llm=strong_llm,
        output_schema=SQLQueriesOutput,
        system_prompt=sql_prompt,
        user_message=f"Write SQL queries for these {len(questions_output.questions)} business questions.",
        phase="sql_engineer",
        emit=emit,
        cancel_scope=cancel_scope,
    )
    print(
        f"[BI Pipeline] SQL Engineer done ({time.time() - agent2_start:.1f}s): "
        f"{len(sql_output.queries)} queries"
    )

    for q_spec in sql_output.queries:
        print(f"[BI Pipeline]   {q_spec.question_id}: {q_spec.sql[:100]}…")
        all_steps.append(AgentStep(
            type="tool_call",
            label=f"SQL ({q_spec.question_id})",
            detail=q_spec.sql[:800],
        ))
        if emit:
            await emit("step", {
                "step": all_steps[-1].model_dump(),
                "phase": "sql_engineer",
            })

    # ── STEP 3: Parallel SQL Execution ──
    print(f"\n[BI Pipeline] ── STEP 3: Parallel SQL Execution ──")
    if emit:
        await emit("status", {
            "phase": "sql_execution",
            "text": f"Executing {len(sql_output.queries)} queries in parallel…",
        })

    exec_start = time.time()
    executed = await _execute_queries_parallel(
        db, sql_output.queries, questions_output.questions, emit=emit,
    )
    print(
        f"[BI Pipeline] SQL execution done ({time.time() - exec_start:.1f}s): "
        f"{sum(1 for eq in executed if not eq.error)}/{len(executed)} succeeded"
    )

    # ── SQL Retry for failed or empty queries ──
    failed = [eq for eq in executed if eq.error or eq.row_count == 0]
    succeeded = [eq for eq in executed if not eq.error and eq.row_count > 0]

    if failed:
        print(f"\n[BI Pipeline] ── STEP 3b: SQL Retry ({len(failed)} failed or empty) ──")
        if emit:
            await emit("status", {
                "phase": "sql_retry",
                "text": f"Retrying {len(failed)} failed or empty queries…",
            })

        retried = await _retry_failed_queries(
            db, strong_llm, failed, schema_context,
            questions_output.questions, emit=emit, cancel_scope=cancel_scope,
        )

        retried_map = {eq.question_id: eq for eq in retried}
        executed = succeeded + [
            retried_map.get(fq.question_id, fq) for fq in failed
        ]

        retry_succeeded = sum(1 for eq in retried if not eq.error)
        print(f"[BI Pipeline] SQL retry: {retry_succeeded}/{len(failed)} fixed")

    # Log execution results
    for eq in executed:
        status = f"✓ {eq.row_count} rows" if not eq.error else f"✗ {eq.error[:200]}"
        all_steps.append(AgentStep(
            type="tool_result",
            label=f"Result ({eq.question_id})",
            detail=f"{eq.question}: {status}",
        ))

    total_time = time.time() - pipeline_start
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === DATA PHASE COMPLETE ({total_time:.1f}s) ===")
    print(f"{'='*60}\n")

    return {
        "is_single_chart": False,
        "single_chart_response": None,
        "executed_queries": [eq.model_dump() for eq in executed],
        "all_steps": [s.model_dump() for s in all_steps],
        "questions_output": questions_output.model_dump(),
        "user_query": user_query,
        "lang": lang,
    }


async def run_bi_assembly_phase(
    user_query: str,
    executed_queries_raw: List[Dict[str, Any]],
    questions_output_raw: Dict[str, Any],
    all_steps_raw: List[Dict[str, Any]],
    *,
    model_id: Optional[str] = None,
    emit: Optional[EmitFn] = None,
    cancel_scope: Optional[QueryCancelScope] = None,
    lang: str = "en",
) -> QueryResponse:
    """Phase 2 of the checkpoint strategy: Dashboard Assembly + Hydration.

    Takes the serialized outputs from run_bi_data_phase and runs
    Step 4 (Dashboard Assembler LLM) plus final hydration/conversion.

    Args:
        user_query: The original user query.
        executed_queries_raw: List of ExecutedQuery dicts from data phase.
        questions_output_raw: BusinessQuestionsOutput dict from data phase.
        all_steps_raw: List of AgentStep dicts from data phase.
        model_id: Optional model ID override.
        emit: SSE emit function for streaming events.
        cancel_scope: Cancellation scope.

    Returns:
        QueryResponse ready for the frontend.
    """
    assembly_start = time.time()
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === ASSEMBLY PHASE START ===")
    print(f"[BI Pipeline] Query: {user_query[:100]}{'…' if len(user_query) > 100 else ''}")
    print(f"[BI Pipeline] Received {len(executed_queries_raw)} executed queries")
    print(f"{'='*60}")

    # Deserialize inputs
    all_steps = [AgentStep(**s) for s in all_steps_raw]
    questions_output = BusinessQuestionsOutput(**questions_output_raw)
    executed_queries = [ExecutedQuery(**eq) for eq in executed_queries_raw]

    # Filter out failed/empty queries
    valid_results = [eq for eq in executed_queries if not eq.error and eq.row_count > 0]

    if not valid_results:
        print(f"[BI Pipeline] ✗ No valid results — aborting assembly")
        return QueryResponse(
            answer="I was unable to retrieve data from the database to build the dashboard. "
                   "The SQL queries returned errors or empty results. Please try rephrasing your question.",
            agent="use_data_analysis_and_visualization_agent",
            steps=all_steps,
        )

    # ── STEP 4: Dashboard Assembler (local model) ──
    print(f"\n[BI Pipeline] ── STEP 4: Dashboard Assembler ──")
    if emit:
        await emit("status", {
            "phase": "dashboard_assembler",
            "text": "Designing dashboard layout…",
        })

    local_llm = _get_local_model(model_id)

    truncated_data = _truncate_query_data(valid_results)
    executed_queries_json = json.dumps(truncated_data, indent=2, default=str)

    assembler_prompt = get_dashboard_assembler_prompt(lang).format(
        user_query=user_query,
        executed_queries_json=executed_queries_json,
    )

    agent3_start = time.time()
    try:
        dashboard_output: FinalDashboardOutput = await _invoke_structured_agent(
            llm=local_llm,
            output_schema=FinalDashboardOutput,
            system_prompt=assembler_prompt,
            user_message=(
                f"Build the dashboard for: {user_query}\n\n"
                f"is_single_chart: {questions_output.is_single_chart}\n"
                f"Number of data results: {len(valid_results)}"
            ),
            phase="dashboard_assembler",
            emit=emit,
            cancel_scope=cancel_scope,
        )
        print(
            f"[BI Pipeline] Dashboard Assembler LLM completed ({time.time() - agent3_start:.1f}s): "
            f"{len(dashboard_output.pages)} page(s) created"
        )
    except Exception as e:
        print(
            f"\n[BI Pipeline] ⚠️ Dashboard Assembler LLM failed ({e}). "
            f"Switching to resilient fallback dashboard assembler..."
        )
        if emit:
            await emit("status", {
                "phase": "dashboard_assembler",
                "text": "Assembling dashboard layout from query results…",
            })
        dashboard_output = _build_fallback_dashboard_output(user_query, valid_results, questions_output, lang=lang)
        print(
            f"[BI Pipeline] Fallback dashboard assembler completed ({time.time() - agent3_start:.1f}s): "
            f"{len(dashboard_output.pages)} page(s) generated"
        )

    all_steps.append(AgentStep(
        type="reasoning",
        label="Dashboard Assembler",
        detail=(
            f"Created {len(dashboard_output.pages)} page(s): "
            + ", ".join(p.name for p in dashboard_output.pages)
        ),
    ))

    if emit:
        await emit("step", {
            "step": all_steps[-1].model_dump(),
            "phase": "dashboard_assembler",
        })

    # ── Convert to frontend DashboardSpec ──
    dashboard_output = _hydrate_dashboard_data(dashboard_output, valid_results)
    dashboard_spec = _to_dashboard_spec(dashboard_output)

    total_time = time.time() - assembly_start
    print(f"\n{'='*60}")
    print(f"[BI Pipeline] === ASSEMBLY PHASE COMPLETE ({total_time:.1f}s) ===")
    print(
        f"[BI Pipeline] {len(dashboard_output.pages)} pages, "
        f"{sum(len(p.charts) for p in dashboard_output.pages)} charts, "
        f"{sum(len(p.kpis) for p in dashboard_output.pages)} KPIs"
    )
    print(f"{'='*60}\n")

    return QueryResponse(
        answer=dashboard_output.content,
        agent="use_data_analysis_and_visualization_agent",
        dashboard=dashboard_spec,
        steps=all_steps,
    )


# ─── Fallback Question Generator (suggestion #4) ─────────────────────────────

def _generate_fallback_questions(tables: List[str]) -> BusinessQuestionsOutput:
    """Generate generic overview questions when Agent 1 fails."""
    print(f"[BI Pipeline] Generating fallback questions for tables: {tables}")
    questions = []

    if tables:
        # Generate a basic count/overview question for the first few tables
        for i, tbl in enumerate(tables[:4]):
            questions.append(BusinessQuestion(
                id=f"q{i + 1}",
                question=f"What is the total record count and basic statistics for {tbl}?",
                intent=AnalyticalIntent.KPI,
                relevant_tables=[tbl],
                priority="high" if i == 0 else "medium",
            ))

    if not questions:
        questions.append(BusinessQuestion(
            id="q1",
            question="Show a summary of all available data",
            intent=AnalyticalIntent.KPI,
            relevant_tables=tables[:3] if tables else [],
            priority="high",
        ))

    return BusinessQuestionsOutput(
        user_intent_summary="General data overview (fallback)",
        is_single_chart=False,
        questions=questions,
    )
