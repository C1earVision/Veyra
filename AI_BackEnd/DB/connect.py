import os
from dotenv import load_dotenv
from langchain_community.utilities import SQLDatabase
from urllib.parse import quote_plus
from DB.connection_errors import _resolve_host, format_db_connection_error


class dataBaseConnection:
    def __init__(self):
        load_dotenv()
        self.server = os.environ.get("DATABASE_SERVER")     
        self.database = os.environ.get("DATABASE_NAME")
        self.username = os.environ.get("DATABASE_USER_NAME")
        self.password = os.environ.get("DATABASE_PASS")
        self.port = os.environ.get("DATABASE_PORT", "5432")

    def connection(self):
        use_ssl = (
            os.environ.get("DATABASE_SSL", "").lower() == "true"
            or (self.server and "supabase" in self.server)
        )
        ssl_param = "?sslmode=require" if use_ssl else ""

        # Resolve the hostname upfront so psycopg2/libpq doesn't have to.
        # This is critical for IPv6-only hosts (e.g. Supabase direct
        # connections) where Windows' Python resolver often fails.
        resolved_host = self.server
        engine_args = {}
        is_ipv6_host = False
        if self.server and not self.server.replace(".", "").replace("-", "").isdigit():
            ip, is_ipv6 = _resolve_host(self.server)
            is_ipv6_host = is_ipv6
            if ip is not None:
                if is_ipv6:
                    # For IPv6: keep original hostname in the URL (for SSL SNI)
                    # and pass the resolved IP via libpq's hostaddr param so
                    # psycopg2 skips its own DNS resolution entirely.
                    engine_args["connect_args"] = {"hostaddr": ip}

        connection_string = (
            f"postgresql+psycopg2://{self.username}:{quote_plus(self.password)}@{resolved_host}:{self.port}/{self.database}{ssl_param}"
        )

        try:
            db = SQLDatabase.from_uri(connection_string, engine_args=engine_args)
            print("Successfully connected to PostgreSQL database.")
        except Exception as e:
            friendly_err = format_db_connection_error(
                e,
                hostname=self.server,
                port=int(self.port) if self.port and self.port.isdigit() else 5432,
                username=self.username,
                database=self.database,
                is_ipv6=is_ipv6_host,
            )
            print(f"Failed to connect to the database:\n{friendly_err}")
            db = None
        return db
