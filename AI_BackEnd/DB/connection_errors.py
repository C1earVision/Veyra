"""Helper module for user-friendly database connection error formatting.

Translates cryptic driver exceptions (psycopg2, libpq, SQLAlchemy) into
clear, actionable diagnostic messages with specific instructions.
"""

import re
import socket
from typing import Optional, Tuple
from urllib.parse import urlparse


def _resolve_host(hostname: str) -> Tuple[Optional[str], bool]:
    """Resolve a hostname to an IP address, handling IPv6-only hosts.

    Python's socket.getaddrinfo on Windows often fails for AAAA-only
    (IPv6-only) hostnames such as Supabase direct connections. This
    helper tries the standard resolver first, then falls back to
    dnspython which queries DNS directly.

    Returns (ip_address: str, is_ipv6: bool) or (None, False) on failure.
    """
    # 1. Try standard resolver — IPv4
    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_INET)
        if infos:
            return infos[0][4][0], False
    except socket.gaierror:
        pass

    # 2. Try standard resolver — IPv6
    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_INET6)
        if infos:
            return infos[0][4][0], True
    except socket.gaierror:
        pass

    # 3. Fall back to dnspython (handles AAAA-only hosts on Windows)
    try:
        import dns.resolver

        # Try A records first
        try:
            answers = dns.resolver.resolve(hostname, "A")
            if answers:
                return str(answers[0]), False
        except Exception:
            pass

        # Then AAAA records
        try:
            answers = dns.resolver.resolve(hostname, "AAAA")
            if answers:
                return str(answers[0]), True
        except Exception:
            pass
    except ImportError:
        pass

    return None, False


def clean_driver_message(raw_msg: str) -> str:
    """Strip verbose SQLAlchemy and DBAPI wrappers to get the core error."""
    msg = raw_msg
    # Remove SQLAlchemy error URL reference
    msg = re.sub(r"\(Background on this error at: https?://[^\)]+\)", "", msg)
    # Remove [SQL: ...] blocks
    msg = re.sub(r"\[SQL:.*?\]", "", msg, flags=re.DOTALL)
    # Strip nested psycopg2 / OperationalError wrapper prefixes
    msg = re.sub(r"^\(?\([a-zA-Z0-9_\.]+\)\s*", "", msg)
    # Clean whitespace
    msg = " ".join(msg.split()).strip()
    return msg


def format_db_connection_error(
    exc: Exception,
    raw_url: Optional[str] = None,
    hostname: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    database: Optional[str] = None,
    is_ipv6: bool = False,
) -> str:
    """Analyze the connection exception and return a friendly, actionable message."""
    raw_str = str(exc)
    low_str = raw_str.lower()

    # Extract connection details from URL if not already provided
    if raw_url and not hostname:
        try:
            cleaned_url = re.sub(r"^[a-zA-Z0-9\+]+://", "http://", raw_url)
            parsed = urlparse(cleaned_url)
            hostname = parsed.hostname or hostname
            port = parsed.port or port
            username = parsed.username or username
            if parsed.path and parsed.path != "/":
                database = parsed.path.lstrip("/")
        except Exception:
            pass

    host_display = hostname or "the database server"
    port_display = f":{port}" if port else ""
    is_supabase = "supabase" in (hostname or "").lower()

    # -------------------------------------------------------------
    # 1. IPv6 / Network Unreachable (e.g. WinError 10051, unreachable network)
    # -------------------------------------------------------------
    if (
        "10051" in raw_str
        or "unreachable network" in low_str
        or "network is unreachable" in low_str
        or "wsaenetunreach" in low_str
        or (is_ipv6 and ("failed to connect" in low_str or "could not connect" in low_str or "cannot connect" in low_str))
    ):
        if is_supabase:
            return (
                f"Connection Failed: Cannot reach host via IPv6\n\n"
                f"Problem:\n"
                f"The Supabase host \"{host_display}\" only supports IPv6, but your local network/ISP does not route IPv6 internet traffic.\n\n"
                f"How to fix this (Choose one):\n\n"
                f"[Option 1] Recommended & 100% Free (No software required):\n"
                f"Use the Supabase Connection Pooler URI (has native IPv4 support):\n"
                f"  1. Go to your Supabase Dashboard -> Project Settings -> Database.\n"
                f"  2. Scroll down to the 'Connection pooling' section.\n"
                f"  3. Select Mode: 'Session' and Port: 5432.\n"
                f"  4. Copy the URI and use it here.\n"
                f"     * Note: The Connection Pooler is completely free and does NOT require a paid plan.\n\n"
                f"[Option 2] To use the direct IPv6 connection:\n"
                f"Install Cloudflare WARP (1.1.1.1 with WARP, free) to enable IPv6 routing on your computer."
            )
        else:
            return (
                f"Connection Failed: Network Unreachable\n\n"
                f"Problem:\n"
                f"Could not reach \"{host_display}{port_display}\" because your network cannot route to this IP address.\n\n"
                f"How to fix this:\n"
                f"1. Check if the database host requires an active VPN or tunnel.\n"
                f"2. Ensure your local internet connection is active."
            )

    # -------------------------------------------------------------
    # 2. DNS resolution failure (could not translate host name, getaddrinfo)
    # -------------------------------------------------------------
    if (
        "could not translate host name" in low_str
        or "getaddrinfo failed" in low_str
        or "name or service not known" in low_str
        or "nodename nor servname provided" in low_str
    ):
        if is_supabase:
            return (
                f"Connection Failed: DNS Resolution Error\n\n"
                f"Problem:\n"
                f"Could not resolve the Supabase host \"{host_display}\".\n\n"
                f"How to fix this:\n"
                f"1. Check the hostname in your connection string for typos.\n"
                f"2. Use the Supabase Connection Pooler URI instead:\n"
                f"   Go to Supabase Dashboard -> Project Settings -> Database -> Connection pooling -> Session mode (Port 5432).\n"
                f"   (The pooler provides a stable IPv4-compatible hostname that resolves on all networks)."
            )
        else:
            return (
                f"Connection Failed: Hostname Not Found\n\n"
                f"Problem:\n"
                f"Could not resolve hostname \"{host_display}\" to an IP address.\n\n"
                f"How to fix this:\n"
                f"1. Check the database host in your connection string for typos.\n"
                f"2. Verify that your DNS server is working properly."
            )

    # -------------------------------------------------------------
    # 3. Authentication failure (password authentication failed)
    # -------------------------------------------------------------
    if (
        "password authentication failed" in low_str
        or "access denied for user" in low_str
        or "authentication failed" in low_str
    ):
        user_display = username or "your database user"
        if is_supabase:
            return (
                f"Connection Failed: Authentication Error\n\n"
                f"Problem:\n"
                f"Password authentication failed for user \"{user_display}\".\n\n"
                f"Checklist to fix this:\n"
                f"1. Database Password vs Login Password: Make sure you are using your project's Database Password (set when you created the project), NOT your Supabase dashboard account password.\n"
                f"2. Special Characters in Password: If your password contains characters like @, #, $, %, :, /, they must be URL-encoded (e.g. '@' -> '%40', '#' -> '%23'). Alternatively, change your password in Supabase to one using only letters and numbers.\n"
                f"3. Remove Brackets: Supabase shows '[YOUR-PASSWORD]'. Make sure not to include the square brackets '[' and ']' around your password.\n"
                f"4. Pooler Cache Delay: If you just reset your database password in the Supabase Dashboard, the connection pooler caches credentials for 2 to 5 minutes. Please wait 2-3 minutes and try again.\n"
                f"5. Reset Password: You can reset your password anytime in the Supabase Dashboard under Project Settings > Database."
            )
        else:
            return (
                f"Connection Failed: Authentication Error\n\n"
                f"Problem:\n"
                f"Password authentication failed for user \"{user_display}\".\n\n"
                f"How to fix this:\n"
                f"1. Verify that your database username and password are correct.\n"
                f"2. If your password contains special characters (like @, :, /, #, $, %), make sure they are URL-encoded.\n"
                f"3. Verify that the user has permission to connect to this database."
            )

    # -------------------------------------------------------------
    # 4. Connection refused (port not listening, wrong port)
    # -------------------------------------------------------------
    if (
        "connection refused" in low_str
        or "10061" in raw_str
        or "is the server running on that host" in low_str
    ):
        return (
            f"Connection Failed: Connection Refused\n\n"
            f"Problem:\n"
            f"The server at \"{host_display}\" actively refused the connection on port {port or 5432}.\n\n"
            f"How to fix this:\n"
            f"1. Verify that the port is correct (default PostgreSQL: 5432; Supabase transaction pooler: 6543, session pooler: 5432).\n"
            f"2. Ensure the database server is running and configured to accept remote TCP/IP connections."
        )

    # -------------------------------------------------------------
    # 5. Connection timeout (server unreachable, paused database)
    # -------------------------------------------------------------
    if (
        "timeout expired" in low_str
        or "timed out" in low_str
        or "connection timed out" in low_str
        or "operation timed out" in low_str
    ):
        return (
            f"Connection Failed: Connection Timed Out\n\n"
            f"Problem:\n"
            f"The connection to \"{host_display}{port_display}\" timed out after waiting.\n\n"
            f"How to fix this:\n"
            + (
                f"1. For free-tier Supabase projects: Check if your database was paused due to inactivity. Go to your Supabase dashboard and click 'Restore project' if needed.\n"
                if is_supabase
                else "1. Verify that the database server is powered on and accessible.\n"
            )
            + f"2. Check if a local firewall, router, or corporate VPN is blocking outbound traffic on port {port or 5432}."
        )

    # -------------------------------------------------------------
    # 6. Database does not exist
    # -------------------------------------------------------------
    if "does not exist" in low_str and "database" in low_str:
        db_display = database or "specified database"
        return (
            f"Connection Failed: Database Not Found\n\n"
            f"Problem:\n"
            f"Database \"{db_display}\" does not exist on the server.\n\n"
            f"How to fix this:\n"
            f"1. Verify the database name in your connection URI."
            + (" (For Supabase, the default database name is usually 'postgres')." if is_supabase else "")
        )

    # -------------------------------------------------------------
    # 7. SSL / Encryption required
    # -------------------------------------------------------------
    if "ssl" in low_str and ("require" in low_str or "no pg_hba.conf" in low_str or "encryption" in low_str):
        return (
            f"Connection Failed: SSL Encryption Required\n\n"
            f"Problem:\n"
            f"The database server requires an encrypted SSL connection.\n\n"
            f"How to fix this:\n"
            f"Append '?sslmode=require' to your connection URI."
        )

    # -------------------------------------------------------------
    # 8. Fallback: Cleaned-up driver error
    # -------------------------------------------------------------
    cleaned = clean_driver_message(raw_str)
    return (
        f"Connection Failed\n\n"
        f"Problem:\n"
        f"{cleaned}\n\n"
        f"How to fix this:\n"
        f"1. Check that the connection string format is correct: postgresql://user:password@host:port/dbname\n"
        f"2. Ensure your credentials, host, and port are accurate.\n"
        f"3. Verify that the database is online and reachable from your network."
    )
