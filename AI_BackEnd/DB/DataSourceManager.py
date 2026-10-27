# Dynamic Data Source Manager
# Manages external database connections and uploaded file databases (CSV/Excel via DuckDB).

import glob
import json
import os
import re
import uuid
import base64
import duckdb
import pandas as pd
from typing import Dict, Any, Optional, List
from langchain_community.utilities import SQLDatabase
from DB.connect import dataBaseConnection


class DataSourceManager:
    """Manages active relational and file-backed SQL data sources for the analytics agents."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataSourceManager, cls).__new__(cls)
            cls._instance._init_manager()
        return cls._instance

    def _init_manager(self):
        self.sources: Dict[str, Dict[str, Any]] = {}
        self.storage_dir = os.path.join(os.path.dirname(__file__), "../storage/sessions")
        os.makedirs(self.storage_dir, exist_ok=True)
        self.default_db_conn = dataBaseConnection()
        self._default_db_instance = None
        self._load_persisted_file_sources()

    def get_default_db(self) -> Optional[SQLDatabase]:
        if self._default_db_instance is not None:
            return self._default_db_instance

        try:
            # Attempt to connect to the default database
            # Only if environment variables are present
            self._default_db_instance = self.default_db_conn.connection()
            return self._default_db_instance
        except Exception as e:
            print(f"[DataSourceManager] Default database connection failed: {e}")
            return None

    def register_database_connection(self, connection_url: str, custom_name: Optional[str] = None) -> Dict[str, Any]:
        raw_url = connection_url.strip()

        # Normalize postgres URLs for SQLAlchemy psycopg2 driver
        if raw_url.startswith("postgres://"):
            raw_url = raw_url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+"):
            raw_url = raw_url.replace("postgresql://", "postgresql+psycopg2://", 1)

        db = SQLDatabase.from_uri(raw_url)
        table_names = db.get_usable_table_names()

        source_id = f"db_{uuid.uuid4().hex[:8]}"
        display_name = custom_name or self._extract_db_name(raw_url)

        schema_meta = self._inspect_database_schema(db, table_names)

        source_record = {
            "source_id": source_id,
            "name": display_name,
            "type": "database",
            "db": db,
            "tables": table_names,
            "schema": schema_meta,
        }
        self.sources[source_id] = source_record
        return {
            "source_id": source_id,
            "name": display_name,
            "type": "database",
            "tables": table_names,
            "schema": schema_meta,
        }

    def register_uploaded_files(self, files: List[Dict[str, Any]], custom_name: Optional[str] = None) -> Dict[str, Any]:
        source_id = f"file_{uuid.uuid4().hex[:8]}"
        db_path = os.path.join(self.storage_dir, f"{source_id}.duckdb")
        con = duckdb.connect(db_path)

        table_names = []
        for file_info in files:
            filename = file_info["filename"]
            content = file_info["content"]
            base_name, ext = os.path.splitext(filename)
            clean_name = self._sanitize_table_name(base_name)

            if ext.lower() in [".csv", ".txt"]:
                temp_file = os.path.join(self.storage_dir, f"{source_id}_{filename}")
                with open(temp_file, "wb") as f:
                    f.write(content)
                con.execute(f"CREATE TABLE \"{clean_name}\" AS SELECT * FROM read_csv_auto('{temp_file.replace(chr(92), '/')}')")
                table_names.append(clean_name)
                try:
                    os.remove(temp_file)
                except Exception:
                    pass

            elif ext.lower() in [".xlsx", ".xls"]:
                temp_file = os.path.join(self.storage_dir, f"{source_id}_{filename}")
                with open(temp_file, "wb") as f:
                    f.write(content)
                excel_dict = pd.read_excel(temp_file, sheet_name=None)
                for sheet_name, df in excel_dict.items():
                    sheet_table = self._sanitize_table_name(f"{clean_name}_{sheet_name}" if len(excel_dict) > 1 else clean_name)
                    con.register("temp_df", df)
                    con.execute(f"CREATE TABLE \"{sheet_table}\" AS SELECT * FROM temp_df")
                    con.unregister("temp_df")
                    table_names.append(sheet_table)
                try:
                    os.remove(temp_file)
                except Exception:
                    pass

        con.close()

        # Connect through LangChain SQLDatabase
        db = SQLDatabase.from_uri(f"duckdb:///{db_path.replace(chr(92), '/')}")
        display_name = (custom_name.strip() if custom_name and custom_name.strip() else None) or (files[0]["filename"] if files else "Uploaded Dataset")
        schema_meta = self._inspect_database_schema(db, table_names)

        source_record = {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "db": db,
            "tables": table_names,
            "schema": schema_meta,
        }
        self.sources[source_id] = source_record
        self._persist_source_meta(source_id, display_name, "file", table_names)
        return {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "tables": table_names,
            "schema": schema_meta,
        }

    def rename_source(self, source_id: str, new_name: str) -> Dict[str, Any]:
        if source_id == "default":
            raise ValueError("The default database cannot be renamed.")
        if source_id not in self.sources:
            self._restore_file_source(source_id)
        if source_id not in self.sources:
            raise ValueError(f"Data source '{source_id}' not found.")
        clean_name = new_name.strip()
        if not clean_name:
            raise ValueError("Dataset name cannot be empty.")
        self.sources[source_id]["name"] = clean_name
        rec = self.sources[source_id]
        if rec.get("type") == "file":
            self._persist_source_meta(
                source_id, clean_name, "file", rec.get("tables") or []
            )
        return {
            "source_id": source_id,
            "name": clean_name,
            "type": self.sources[source_id]["type"],
            "tables": self.sources[source_id]["tables"],
            "schema": self.sources[source_id].get("schema", {}),
        }

    def _delete_file_artifacts(self, source_id: str) -> None:
        """Remove DuckDB file, metadata, and temp upload files for a file-backed source."""
        for path in (
            self._duckdb_path(source_id),
            self._meta_path(source_id),
        ):
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except Exception as e:
                print(f"[DataSourceManager] Failed to remove {path}: {e}")

        pattern = os.path.join(self.storage_dir, f"{source_id}_*")
        for path in glob.glob(pattern):
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except Exception as e:
                print(f"[DataSourceManager] Failed to remove {path}: {e}")

    def delete_source(self, source_id: str) -> Dict[str, Any]:
        if source_id == "default":
            raise ValueError("The default database cannot be deleted.")

        if source_id not in self.sources:
            self._restore_file_source(source_id)

        if source_id not in self.sources:
            if source_id.startswith("file_") and (
                os.path.isfile(self._duckdb_path(source_id))
                or os.path.isfile(self._meta_path(source_id))
            ):
                self._delete_file_artifacts(source_id)
                return {"source_id": source_id, "deleted": True}
            raise ValueError(f"Data source '{source_id}' not found.")

        record = self.sources.pop(source_id)
        if record.get("type") == "file":
            self._delete_file_artifacts(source_id)

        print(f"[DataSourceManager] Deleted source {source_id}")
        return {"source_id": source_id, "deleted": True}

    def _meta_path(self, source_id: str) -> str:
        return os.path.join(self.storage_dir, f"{source_id}.meta.json")

    def _duckdb_path(self, source_id: str) -> str:
        return os.path.join(self.storage_dir, f"{source_id}.duckdb")

    def _persist_source_meta(
        self,
        source_id: str,
        name: str,
        source_type: str,
        tables: List[str],
    ) -> None:
        try:
            with open(self._meta_path(source_id), "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "source_id": source_id,
                        "name": name,
                        "type": source_type,
                        "tables": tables,
                    },
                    f,
                    indent=2,
                )
        except Exception as e:
            print(f"[DataSourceManager] Failed to persist meta for {source_id}: {e}")

    def _attach_file_source(
        self,
        source_id: str,
        db_path: str,
        display_name: str,
        table_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        uri_path = db_path.replace("\\", "/")
        db = SQLDatabase.from_uri(f"duckdb:///{uri_path}")
        tables = table_names or list(db.get_usable_table_names())
        schema_meta = self._inspect_database_schema(db, tables)
        source_record = {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "db": db,
            "tables": tables,
            "schema": schema_meta,
        }
        self.sources[source_id] = source_record
        return source_record

    def _restore_file_source(self, source_id: str) -> Optional[Dict[str, Any]]:
        if not source_id.startswith("file_"):
            return None
        if source_id in self.sources:
            return self.sources[source_id]

        db_path = self._duckdb_path(source_id)
        if not os.path.isfile(db_path):
            return None

        name = "Uploaded Dataset"
        tables: Optional[List[str]] = None
        meta_path = self._meta_path(source_id)
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
                name = meta.get("name") or name
                tables = meta.get("tables") or None
            except Exception as e:
                print(f"[DataSourceManager] Bad meta for {source_id}: {e}")

        try:
            print(f"[DataSourceManager] Restored file source {source_id} from disk")
            return self._attach_file_source(source_id, db_path, name, tables)
        except Exception as e:
            print(f"[DataSourceManager] Failed to restore {source_id}: {e}")
            return None

    def _load_persisted_file_sources(self) -> None:
        """Re-register uploaded DuckDB datasets after server restart."""
        for db_path in glob.glob(os.path.join(self.storage_dir, "file_*.duckdb")):
            source_id = os.path.splitext(os.path.basename(db_path))[0]
            if source_id in self.sources:
                continue
            self._restore_file_source(source_id)

    def _default_source_record(self) -> Optional[Dict[str, Any]]:
        try:
            default_db = self.get_default_db()
        except Exception as e:
            print(f"[DataSourceManager] Error retrieving default DB record: {e}")
            default_db = None

        if not default_db:
            return None
        tables = default_db.get_usable_table_names()
        return {
            "source_id": "default",
            "name": "Default Database",
            "type": "database",
            "db": default_db,
            "tables": tables,
            "schema": {},
        }

    def source_exists(self, source_id: Optional[str]) -> bool:
        if not source_id or source_id == "default":
            return self.get_default_db() is not None
        if source_id in self.sources:
            return True
        if source_id.startswith("file_"):
            return (
                os.path.isfile(self._duckdb_path(source_id))
                or self._restore_file_source(source_id) is not None
            )
        return False

    def get_source_strict(self, source_id: Optional[str]) -> Optional[Dict[str, Any]]:
        """Resolve a source by id without silently substituting the default database."""
        if not source_id or source_id == "default":
            return self._default_source_record()
        if source_id in self.sources:
            return self.sources[source_id]
        restored = self._restore_file_source(source_id)
        if restored:
            return restored
        return None

    def resolve_source(
        self, source_id: Optional[str]
    ) -> tuple[Optional[Dict[str, Any]], bool, Optional[str]]:
        """Return (active_source, fell_back_to_default, requested_source_id)."""
        requested = (source_id or "default").strip() or "default"
        if requested == "default":
            return self._default_source_record(), False, requested

        strict = self.get_source_strict(requested)
        if strict:
            return strict, False, requested

        print(
            f"[DataSourceManager] Source '{requested}' unavailable — using default database"
        )
        return self._default_source_record(), True, requested

    def get_source(
        self,
        source_id: Optional[str] = None,
        *,
        fallback_to_default: bool = True,
    ) -> Optional[Dict[str, Any]]:
        strict = self.get_source_strict(source_id)
        if strict:
            return strict
        if fallback_to_default:
            return self._default_source_record()
        return None

    # Convert database cell values to JSON serializable formats, encoding binary images to base64 data URLs
    def _serialize_cell_value(self, val: Any) -> Any:
        if val is None:
            return ""
        if isinstance(val, (bytes, memoryview)):
            raw_b = bytes(val)
            if raw_b.startswith(b"\x89PNG"):
                mime = "image/png"
            elif raw_b.startswith(b"\xff\xd8\xff"):
                mime = "image/jpeg"
            elif raw_b.startswith(b"GIF"):
                mime = "image/gif"
            elif raw_b.startswith(b"RIFF") and b"WEBP" in raw_b[:12]:
                mime = "image/webp"
            else:
                mime = "image/png"
            return f"data:{mime};base64,{base64.b64encode(raw_b).decode('utf-8')}"
        return str(val)

    def get_schema(self, source_id: Optional[str] = None, limit: int = 15) -> Dict[str, Any]:
        source = self.get_source(source_id, fallback_to_default=False)
        if not source:
            return {
                "tables": [],
                "columns": {},
                "previews": {},
                "error": f"Data source '{source_id}' is not available",
            }

        db = source["db"]
        tables = source.get("tables") or db.get_usable_table_names()
        return self._inspect_database_schema(db, tables, limit=limit)

    # Fetch table records with configurable row limit
    def get_table_data(self, source_id: Optional[str], table_name: str, limit: int = 25) -> Dict[str, Any]:
        source = self.get_source(source_id, fallback_to_default=False)
        if not source:
            return {
                "columns": [],
                "rows": [],
                "total": 0,
                "error": f"Data source '{source_id}' is not available",
            }
        db = source["db"]
        from sqlalchemy import text
        structured = {"columns": [], "rows": [], "total": 0}
        try:
            with db._engine.connect() as conn:
                try:
                    res = conn.execute(text(f'SELECT * FROM "{table_name}" LIMIT {int(limit)}'))
                except Exception:
                    res = conn.execute(text(f'SELECT * FROM {table_name} LIMIT {int(limit)}'))
                cols = list(res.keys())
                raw_rows = res.fetchall()
                rows = [
                    {c: self._serialize_cell_value(v) for c, v in zip(cols, row)}
                    for row in raw_rows
                ]
                structured = {"columns": cols, "rows": rows, "total": len(rows)}
        except Exception as e:
            structured = {"columns": [], "rows": [], "total": 0, "error": str(e)}
        return structured

    # Introspect table schemas, DDL definitions, and sample records
    def _inspect_database_schema(self, db: SQLDatabase, table_names: List[str], limit: int = 15) -> Dict[str, Any]:
        from sqlalchemy import text
        result = {"tables": table_names, "columns": {}, "previews": {}}
        for tbl in table_names:
            structured_preview = {"columns": [], "rows": []}
            try:
                with db._engine.connect() as conn:
                    try:
                        res = conn.execute(text(f'SELECT * FROM "{tbl}" LIMIT {int(limit)}'))
                    except Exception:
                        res = conn.execute(text(f'SELECT * FROM {tbl} LIMIT {int(limit)}'))
                    cols = list(res.keys())
                    raw_rows = res.fetchall()
                    rows = [
                        {c: self._serialize_cell_value(v) for c, v in zip(cols, row)}
                        for row in raw_rows
                    ]
                    structured_preview = {"columns": cols, "rows": rows}
            except Exception:
                try:
                    raw_str = db.run(f'SELECT * FROM "{tbl}" LIMIT {int(limit)}')
                    structured_preview = {"columns": [], "rows": [], "raw": str(raw_str)}
                except Exception:
                    structured_preview = {"columns": [], "rows": []}

            result["previews"][tbl] = structured_preview

            try:
                table_info = db.get_table_info([tbl])
                result["columns"][tbl] = table_info
            except Exception:
                result["columns"][tbl] = ""

        return result

    def _sanitize_table_name(self, name: str) -> str:
        clean = re.sub(r"[^\w]+", "_", name.strip())
        return clean.strip("_") or "data_table"

    def _extract_db_name(self, url: str) -> str:
        try:
            return url.rsplit("/", 1)[-1].split("?")[0]
        except Exception:
            return "Remote Database"


data_source_manager = DataSourceManager()
