"""
Supabase Storage helper for persisting uploaded DuckDB datasets.

When SUPABASE_URL and SUPABASE_SERVICE_KEY are set, uploaded DuckDB databases
and their metadata are stored in Supabase Storage so they survive serverless
cold starts (e.g. on Vercel or Railway).

If the env vars are missing the helper silently no-ops, letting the local
filesystem path work as before (good for local development).
"""

import os
from typing import Optional, List

import httpx

BUCKET = "datasources"
_bucket_ensured = False


def _url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _key() -> str:
    return os.environ.get("SUPABASE_SERVICE_KEY", "")


def is_configured() -> bool:
    return bool(_url() and _key())


def _headers(content_type: Optional[str] = None) -> dict:
    key = _key()
    h = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def _ensure_bucket() -> None:
    """Create the storage bucket if it doesn't exist yet."""
    global _bucket_ensured
    if _bucket_ensured or not is_configured():
        return
    try:
        url = f"{_url()}/storage/v1/bucket/{BUCKET}"
        resp = httpx.get(url, headers=_headers(), timeout=10)
        if resp.status_code == 404:
            httpx.post(
                f"{_url()}/storage/v1/bucket",
                headers=_headers("application/json"),
                json={"id": BUCKET, "name": BUCKET, "public": False},
                timeout=10,
            )
            print(f"[SupabaseStorage] Created bucket '{BUCKET}'")
        _bucket_ensured = True
    except Exception as e:
        print(f"[SupabaseStorage] Warning: could not ensure bucket: {e}")


def upload(remote_path: str, data: bytes, content_type: str = "application/octet-stream") -> bool:
    """Upload a file to Supabase Storage (upsert mode)."""
    if not is_configured():
        return False
    _ensure_bucket()
    try:
        url = f"{_url()}/storage/v1/object/{BUCKET}/{remote_path}"
        resp = httpx.post(
            url,
            content=data,
            headers={**_headers(content_type), "x-upsert": "true"},
            timeout=120,
        )
        ok = resp.status_code in (200, 201)
        if ok:
            print(f"[SupabaseStorage] Uploaded {remote_path} ({len(data)} bytes)")
        else:
            print(f"[SupabaseStorage] Upload returned {resp.status_code} for {remote_path}")
        return ok
    except Exception as e:
        print(f"[SupabaseStorage] Upload failed for {remote_path}: {e}")
        return False


def download(remote_path: str) -> Optional[bytes]:
    """Download a file from Supabase Storage."""
    if not is_configured():
        return None
    _ensure_bucket()
    try:
        url = f"{_url()}/storage/v1/object/{BUCKET}/{remote_path}"
        resp = httpx.get(url, headers=_headers(), timeout=120)
        if resp.status_code == 200:
            print(f"[SupabaseStorage] Downloaded {remote_path} ({len(resp.content)} bytes)")
            return resp.content
        if resp.status_code != 404:
            print(f"[SupabaseStorage] Download returned {resp.status_code} for {remote_path}")
    except Exception as e:
        print(f"[SupabaseStorage] Download failed for {remote_path}: {e}")
    return None


def delete(remote_paths: List[str]) -> bool:
    """Delete one or more files from Supabase Storage."""
    if not is_configured() or not remote_paths:
        return False
    _ensure_bucket()
    try:
        url = f"{_url()}/storage/v1/object/{BUCKET}"
        resp = httpx.delete(
            url,
            headers=_headers("application/json"),
            json={"prefixes": remote_paths},
            timeout=30,
        )
        return resp.status_code in (200, 201)
    except Exception as e:
        print(f"[SupabaseStorage] Delete failed: {e}")
        return False


def list_objects(prefix: str = "") -> List[str]:
    """List file names in the storage bucket with an optional prefix filter."""
    if not is_configured():
        return []
    _ensure_bucket()
    try:
        url = f"{_url()}/storage/v1/object/list/{BUCKET}"
        resp = httpx.post(
            url,
            headers=_headers("application/json"),
            json={"prefix": prefix, "limit": 200},
            timeout=30,
        )
        if resp.status_code == 200:
            return [item["name"] for item in resp.json() if "name" in item]
    except Exception as e:
        print(f"[SupabaseStorage] List failed: {e}")
    return []
