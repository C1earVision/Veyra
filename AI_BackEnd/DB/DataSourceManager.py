# Dynamic Data Source Manager
# Manages external database connections and uploaded file databases (CSV/Excel via DuckDB).

import glob
import json
import os
import re
import socket
import uuid
import base64
import duckdb
import pandas as pd
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from langchain_community.utilities import SQLDatabase
from sqlalchemy import create_engine, event
from DB.connect import dataBaseConnection
from DB.connection_errors import _resolve_host, format_db_connection_error
from DB import supabase_storage


def is_production() -> bool:
    env = os.environ.get("ENVIRONMENT", "").strip().lower()
    node_env = os.environ.get("NODE_ENV", "").strip().lower()
    return bool(os.environ.get("VERCEL") or env == "production" or node_env == "production")


GLOBAL_DATASET_NAME = "E commerce dataset"
GLOBAL_DATASET_SOURCE_ID = "file_f678cde1"


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

        # Vercel and other serverless platforms have read-only filesystems.
        # We must use /tmp for any local storage.
        if os.environ.get("VERCEL") or os.environ.get("ENVIRONMENT") == "production":
            self.storage_dir = "/tmp/sessions"
        else:
            self.storage_dir = os.path.join(os.path.dirname(__file__), "../storage/sessions")

        try:
            os.makedirs(self.storage_dir, exist_ok=True)
        except Exception as e:
            print(f"[DataSourceManager] Warning: Could not create storage dir {self.storage_dir}: {e}")
            # Fallback to /tmp if the primary attempt fails
            self.storage_dir = "/tmp/sessions"
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

    def _prepare_connection_url(self, raw_url: str) -> tuple:
        """Normalise a user-supplied connection URL for SQLAlchemy + psycopg2.

        Returns (url, engine_args, is_ipv6) where engine_args may contain connect_args
        with a hostaddr for IPv6-only hosts.

        * Rewrites postgres:// and plain postgresql:// schemes.
        * Resolves hostnames via _resolve_host (supports IPv6-only via dnspython).
        * Ensures sslmode=require for known cloud providers.
        """
        # Scheme normalisation
        if raw_url.startswith("postgres://"):
            raw_url = raw_url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+"):
            raw_url = raw_url.replace("postgresql://", "postgresql+psycopg2://", 1)

        parsed = urlparse(raw_url)
        engine_args = {}
        is_ipv6_host = False

        # Check if user left the Supabase placeholder password unchanged
        if "[YOUR-PASSWORD]" in raw_url or "YOUR-PASSWORD" in (parsed.password or ""):
            raise ValueError(
                "The connection string still contains the placeholder '[YOUR-PASSWORD]'. "
                "Please replace it with your actual Supabase database password."
            )

        # Check if user accidentally kept the square brackets around their password: [my_password]
        if parsed.password and parsed.password.startswith("[") and parsed.password.endswith("]"):
            clean_pw = parsed.password[1:-1]
            raw_url = raw_url.replace(f":{parsed.password}@", f":{clean_pw}@", 1)
            parsed = urlparse(raw_url)

        # --- Hostname resolution (IPv4 + IPv6 via dnspython) ---
        hostname = parsed.hostname or ""
        new_netloc = None
        if hostname and not hostname.replace(".", "").replace("-", "").isdigit():
            ip, is_ipv6 = _resolve_host(hostname)
            if ip is None:
                raise ValueError(
                    f'Could not resolve database host "{hostname}".'
                )
            is_ipv6_host = is_ipv6
            if is_ipv6:
                # Keep original hostname in URL for SSL SNI verification,
                # pass resolved IPv6 address via libpq hostaddr to bypass
                # psycopg2's broken DNS resolution on Windows.
                engine_args["connect_args"] = {"hostaddr": ip}
            # For IPv4: do NOT overwrite the hostname or netloc with the raw IP!
            # The original hostname is already IPv4-compatible and preserves
            # SSL certificates, SNI, and cloud load-balancer routing.

        # --- SSL for cloud providers ---
        cloud_providers = ("supabase", "neon", "railway", "render", "cockroachlabs")
        needs_ssl = any(p in hostname for p in cloud_providers)
        qs = parse_qs(parsed.query)
        if needs_ssl and "sslmode" not in qs:
            qs["sslmode"] = ["require"]

        new_query = urlencode(qs, doseq=True)

        rebuilt = urlunparse((
            parsed.scheme,
            new_netloc or parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment,
        ))
        return rebuilt, engine_args, is_ipv6_host

    def register_database_connection(
        self,
        connection_url: str,
        custom_name: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        raw_url = connection_url.strip()

        # Extract basic connection context for detailed error diagnostic reporting
        parsed_url = urlparse(raw_url)
        diag_context = {
            "hostname": parsed_url.hostname,
            "port": parsed_url.port,
            "username": parsed_url.username,
            "database": parsed_url.path.lstrip("/") if parsed_url.path else None,
            "is_ipv6": False,
        }

        try:
            prepared_url, engine_args, is_ipv6 = self._prepare_connection_url(raw_url)
            diag_context["is_ipv6"] = is_ipv6
        except Exception as e:
            friendly_err = format_db_connection_error(e, raw_url=raw_url, **diag_context)
            raise ValueError(friendly_err) from e

        try:
            db = SQLDatabase.from_uri(prepared_url, engine_args=engine_args)
            table_names = db.get_usable_table_names()
        except Exception as e:
            friendly_err = format_db_connection_error(e, raw_url=raw_url, **diag_context)
            raise ValueError(friendly_err) from e

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
            "owner_id": owner_id,
            "is_global": False,
        }
        self.sources[source_id] = source_record
        return {
            "source_id": source_id,
            "name": display_name,
            "type": "database",
            "tables": table_names,
            "schema": schema_meta,
            "owner_id": owner_id,
            "is_global": False,
        }

    def register_uploaded_files(
        self,
        files: List[Dict[str, Any]],
        custom_name: Optional[str] = None,
        owner_id: Optional[str] = None,
        is_global: bool = False,
    ) -> Dict[str, Any]:
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

        # Upload DuckDB to Supabase Storage for persistence across deploys
        if supabase_storage.is_configured():
            try:
                with open(db_path, "rb") as f:
                    supabase_storage.upload(f"{source_id}.duckdb", f.read())
            except Exception as e:
                print(f"[DataSourceManager] Supabase upload failed for {source_id}: {e}")

        # Connect through LangChain SQLDatabase
        db = SQLDatabase.from_uri(f"duckdb:///{db_path.replace(chr(92), '/')}")
        display_name = (custom_name.strip() if custom_name and custom_name.strip() else None) or (files[0]["filename"] if files else "Uploaded Dataset")
        if is_global or source_id == GLOBAL_DATASET_SOURCE_ID or display_name == GLOBAL_DATASET_NAME:
            display_name = GLOBAL_DATASET_NAME
            is_global = True

        schema_meta = self._inspect_database_schema(db, table_names)

        source_record = {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "db": db,
            "tables": table_names,
            "schema": schema_meta,
            "owner_id": owner_id,
            "is_global": is_global,
        }
        self.sources[source_id] = source_record
        self._persist_source_meta(
            source_id,
            display_name,
            "file",
            table_names,
            owner_id=owner_id,
            is_global=is_global,
        )
        return {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "tables": table_names,
            "schema": schema_meta,
            "owner_id": owner_id,
            "is_global": is_global,
        }

    def rename_source(self, source_id: str, new_name: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        if source_id == "default":
            raise ValueError("The default database cannot be renamed.")
        if source_id not in self.sources:
            self._restore_file_source(source_id)
        if source_id not in self.sources:
            raise ValueError(f"Data source '{source_id}' not found.")

        rec = self.sources[source_id]
        if rec.get("is_global") or rec.get("name") == GLOBAL_DATASET_NAME or source_id == GLOBAL_DATASET_SOURCE_ID:
            raise ValueError("The global E commerce dataset cannot be renamed.")

        if is_production() and user_id and rec.get("owner_id"):
            if str(rec["owner_id"]) != str(user_id):
                raise ValueError("You do not have permission to rename this data source.")

        clean_name = new_name.strip()
        if not clean_name:
            raise ValueError("Dataset name cannot be empty.")
        self.sources[source_id]["name"] = clean_name
        if rec.get("type") == "file":
            self._persist_source_meta(
                source_id,
                clean_name,
                "file",
                rec.get("tables") or [],
                owner_id=rec.get("owner_id"),
                is_global=rec.get("is_global", False),
            )
        return {
            "source_id": source_id,
            "name": clean_name,
            "type": self.sources[source_id]["type"],
            "tables": self.sources[source_id]["tables"],
            "schema": self.sources[source_id].get("schema", {}),
            "owner_id": self.sources[source_id].get("owner_id"),
            "is_global": self.sources[source_id].get("is_global", False),
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

        # Also delete from Supabase Storage
        if supabase_storage.is_configured():
            supabase_storage.delete([f"{source_id}.duckdb", f"{source_id}.meta.json"])

    def delete_source(self, source_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        if source_id == "default":
            raise ValueError("The default database cannot be deleted.")

        if source_id not in self.sources:
            self._restore_file_source(source_id)

        if source_id not in self.sources:
            if source_id.startswith("file_") and (
                os.path.isfile(self._duckdb_path(source_id))
                or os.path.isfile(self._meta_path(source_id))
            ):
                meta_path = self._meta_path(source_id)
                if os.path.isfile(meta_path):
                    try:
                        with open(meta_path, encoding="utf-8") as f:
                            meta = json.load(f)
                        if meta.get("is_global") or meta.get("name") == GLOBAL_DATASET_NAME or source_id == GLOBAL_DATASET_SOURCE_ID:
                            raise ValueError("The global E commerce dataset cannot be deleted.")
                        if is_production() and user_id and meta.get("owner_id"):
                            if str(meta["owner_id"]) != str(user_id):
                                raise ValueError("You do not have permission to delete this data source.")
                    except ValueError:
                        raise
                    except Exception:
                        pass
                self._delete_file_artifacts(source_id)
                return {"source_id": source_id, "deleted": True}
            raise ValueError(f"Data source '{source_id}' not found.")

        record = self.sources.get(source_id, {})
        if record.get("is_global") or record.get("name") == GLOBAL_DATASET_NAME or source_id == GLOBAL_DATASET_SOURCE_ID:
            raise ValueError("The global E commerce dataset cannot be deleted.")

        if is_production() and user_id and record.get("owner_id"):
            if str(record["owner_id"]) != str(user_id):
                raise ValueError("You do not have permission to delete this data source.")

        self.sources.pop(source_id)
        if record.get("type") == "file":
            db = record.get("db")
            if db and hasattr(db, "_engine"):
                try:
                    db._engine.dispose()
                except Exception:
                    pass
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
        owner_id: Optional[str] = None,
        is_global: bool = False,
    ) -> None:
        payload = {
            "source_id": source_id,
            "name": name,
            "type": source_type,
            "tables": tables,
            "owner_id": owner_id,
            "is_global": is_global,
        }
        try:
            with open(self._meta_path(source_id), "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
        except Exception as e:
            print(f"[DataSourceManager] Failed to persist meta for {source_id}: {e}")
        # Also persist to Supabase Storage for production resilience
        if supabase_storage.is_configured():
            try:
                supabase_storage.upload(
                    f"{source_id}.meta.json",
                    json.dumps(payload, indent=2).encode("utf-8"),
                    "application/json",
                )
            except Exception as e_sb:
                print(f"[DataSourceManager] Supabase meta upload failed for {source_id}: {e_sb}")

    def _attach_file_source(
        self,
        source_id: str,
        db_path: str,
        display_name: str,
        table_names: Optional[List[str]] = None,
        owner_id: Optional[str] = None,
        is_global: bool = False,
    ) -> Dict[str, Any]:
        uri_path = db_path.replace("\\", "/")
        db = SQLDatabase.from_uri(f"duckdb:///{uri_path}")
        tables = table_names or list(db.get_usable_table_names())
        schema_meta = self._inspect_database_schema(db, tables)

        if is_global or source_id == GLOBAL_DATASET_SOURCE_ID or display_name == GLOBAL_DATASET_NAME:
            display_name = GLOBAL_DATASET_NAME
            is_global = True

        source_record = {
            "source_id": source_id,
            "name": display_name,
            "type": "file",
            "db": db,
            "tables": tables,
            "schema": schema_meta,
            "owner_id": owner_id,
            "is_global": is_global,
        }
        self.sources[source_id] = source_record
        return source_record

    def _restore_file_source(self, source_id: str) -> Optional[Dict[str, Any]]:
        if not source_id.startswith("file_"):
            return None
        if source_id in self.sources:
            return self.sources[source_id]

        db_path = self._duckdb_path(source_id)

        # If local DuckDB file doesn't exist, try downloading from Supabase Storage
        if not os.path.isfile(db_path) and supabase_storage.is_configured():
            db_data = supabase_storage.download(f"{source_id}.duckdb")
            if db_data:
                try:
                    os.makedirs(os.path.dirname(db_path), exist_ok=True)
                    with open(db_path, "wb") as f:
                        f.write(db_data)
                    print(f"[DataSourceManager] Downloaded {source_id}.duckdb from Supabase Storage")
                except Exception as e:
                    print(f"[DataSourceManager] Failed to save downloaded DuckDB for {source_id}: {e}")

        if not os.path.isfile(db_path):
            return None

        name = "Uploaded Dataset"
        tables: Optional[List[str]] = None
        owner_id: Optional[str] = None
        is_global: bool = False
        meta_path = self._meta_path(source_id)

        # Try loading metadata from local file first, then Supabase Storage
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
                name = meta.get("name") or name
                tables = meta.get("tables") or None
                owner_id = meta.get("owner_id")
                is_global = bool(meta.get("is_global", False))
            except Exception as e:
                print(f"[DataSourceManager] Bad meta for {source_id}: {e}")
        elif supabase_storage.is_configured():
            meta_data = supabase_storage.download(f"{source_id}.meta.json")
            if meta_data:
                try:
                    meta = json.loads(meta_data.decode("utf-8"))
                    name = meta.get("name") or name
                    tables = meta.get("tables") or None
                    owner_id = meta.get("owner_id")
                    is_global = bool(meta.get("is_global", False))
                    with open(meta_path, "wb") as f:
                        f.write(meta_data)
                except Exception as e:
                    print(f"[DataSourceManager] Bad remote meta for {source_id}: {e}")

        if source_id == GLOBAL_DATASET_SOURCE_ID or name.lower() in ("e commerce dataset", "e-commerce dataset", "data"):
            ecom_tables = {"customers_dataset_cleaned", "orders_dataset_cleaned"}
            if tables and ecom_tables.intersection(set(tables)):
                name = GLOBAL_DATASET_NAME
                is_global = True

        try:
            print(f"[DataSourceManager] Restored file source {source_id} (global={is_global}, owner={owner_id})")
            return self._attach_file_source(
                source_id,
                db_path,
                name,
                tables,
                owner_id=owner_id,
                is_global=is_global,
            )
        except Exception as e:
            print(f"[DataSourceManager] Failed to restore {source_id}: {e}")
            return None

    def _load_persisted_file_sources(self) -> None:
        """Re-register uploaded DuckDB datasets after server restart."""
        # Discover from local filesystem
        local_ids = set()
        for db_path in glob.glob(os.path.join(self.storage_dir, "file_*.duckdb")):
            source_id = os.path.splitext(os.path.basename(db_path))[0]
            local_ids.add(source_id)
            if source_id in self.sources:
                continue
            self._restore_file_source(source_id)

        # Also discover from Supabase Storage (handles serverless cold starts)
        if supabase_storage.is_configured():
            try:
                remote_files = supabase_storage.list_objects("")
                for name in remote_files:
                    if name.startswith("file_") and name.endswith(".duckdb"):
                        sid = name.replace(".duckdb", "")
                        if sid in self.sources or sid in local_ids:
                            continue
                        self._restore_file_source(sid)
            except Exception as e:
                print(f"[DataSourceManager] Failed to list Supabase Storage sources: {e}")

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
            "is_global": True,
        }

    def can_user_access_source(self, source_id: Optional[str], user_id: Optional[str] = None) -> bool:
        if not is_production():
            return True
        if not source_id or source_id == "default" or source_id == GLOBAL_DATASET_SOURCE_ID:
            return True
        source = self.get_source_strict(source_id)
        if not source:
            return False
        if source.get("is_global") or source.get("name") == GLOBAL_DATASET_NAME:
            return True
        owner_id = source.get("owner_id")
        if owner_id is None:
            return True
        return str(owner_id) == str(user_id) if user_id else False

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
        self, source_id: Optional[str], user_id: Optional[str] = None
    ) -> tuple[Optional[Dict[str, Any]], bool, Optional[str]]:
        """Return (active_source, fell_back_to_default, requested_source_id)."""
        requested = (source_id or "default").strip() or "default"
        if requested == "default":
            return self._default_source_record(), False, requested

        if is_production() and user_id and not self.can_user_access_source(requested, user_id):
            print(
                f"[DataSourceManager] Access denied for source '{requested}' by user {user_id} — falling back to default database"
            )
            return self._default_source_record(), True, requested

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
