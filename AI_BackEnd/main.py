from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from DB.agent_visualizations import get_visualization
from starlette.responses import JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict, Union
import asyncio
import os
from Utils.ModelLoader import is_rate_limit_error, extract_retry_delay, modelLoader
from Utils.agent_trace import message_content_to_str
from Utils.query_pipeline import (
    run_query,
    run_query_stream,
    run_query_stream_plan_phase,
    run_query_stream_data_phase,
    run_query_stream_assembly_phase,
)
from Utils.request_context import QueryCancelScope, current_cancel_scope
from Utils.jwt_auth import (
    auth_from_request,
    auth_request_context,
    bearer_from_request,
    extract_bearer_token,
    verify_access_token,
)
from Utils.sse import format_sse
from schemas.query_models import QueryResponse
from DB.DataSourceManager import (
    data_source_manager,
    is_production,
    GLOBAL_DATASET_NAME,
    GLOBAL_DATASET_SOURCE_ID,
)
from DB import supabase_storage
import json
import uuid
load_dotenv()
# Agent runs (especially Ollama) can exceed LangChain's 120s default stream chunk gap.
os.environ.setdefault("LANGCHAIN_OPENAI_STREAM_CHUNK_TIMEOUT_S", "0")
# AI Backend server entrypoint
app = FastAPI()

origins = [
    "https://kadash-chi.vercel.app",
    "https://kadash-api-zeta.vercel.app",
    "https://veyra-47mr-pi.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://localhost:9001",
    "http://127.0.0.1:9001",
]

def _path_requires_auth(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    if normalized in ("/query", "/query/stream", "/query/stream/plan", "/query/stream/data", "/query/stream/assemble", "/models"):
        return True
    return normalized.startswith("/data-sources") or normalized.startswith("/chats")


@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    if not _path_requires_auth(request.url.path):
        return await call_next(request)
    try:
        bearer = extract_bearer_token(request)
        auth_user = verify_access_token(bearer)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
    request.state.auth_user = auth_user
    request.state.bearer_token = bearer
    return await call_next(request)


# CORSMiddleware must be added AFTER all other middlewares so it is the outermost
# layer and attaches Access-Control-Allow-Origin to all responses (including 401/403/500 errors).
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectDbRequest(BaseModel):
    connection_string: str
    custom_name: Optional[str] = None


class RenameSourceRequest(BaseModel):
    name: str


class ChatSyncRequest(BaseModel):
    chats: List[Dict[str, Any]]


class PrepareUploadFile(BaseModel):
    filename: str
    size: Optional[int] = None


class PrepareUploadRequest(BaseModel):
    files: List[PrepareUploadFile]
    custom_name: Optional[str] = None


class CompleteUploadFileItem(BaseModel):
    filename: str
    storage_path: str


class CompleteUploadRequest(BaseModel):
    upload_id: str
    files: List[CompleteUploadFileItem]
    custom_name: Optional[str] = None


class QueryRequest(BaseModel):
    question: str
    source_id: Optional[str] = None
    model_id: Optional[str] = None


class DataPhaseRequest(BaseModel):
    plan_phase_result: Dict[str, Any]
    model_id: Optional[str] = None
    source_id: Optional[str] = None


class AssemblyRequest(BaseModel):
    data_phase_result: Dict[str, Any]
    model_id: Optional[str] = None
    source_id: Optional[str] = None


class AgentRunResult(BaseModel):
    content: Any = ""
    messages: List[Any] = Field(default_factory=list)


async def _cancel_agent_task(
    task: asyncio.Task,
    cancel_scope: QueryCancelScope,
    reason: str,
) -> None:
    if cancel_scope is not None:
        cancel_scope.cancel()
        await cancel_scope.abort_http()
    if not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    print(f"[use_agent] {reason}")


async def _await_cancellable(
    task: asyncio.Task, request: Request, cancel_scope: QueryCancelScope
):
    while not task.done():
        if cancel_scope is not None and cancel_scope.is_cancelled():
            await _cancel_agent_task(task, cancel_scope, "Cancel scope triggered.")
            raise asyncio.CancelledError()
        if request is not None and await request.is_disconnected():
            await _cancel_agent_task(task, cancel_scope, "Client disconnected.")
            raise asyncio.CancelledError()
        await asyncio.sleep(0.05)
    return await task


async def use_agent(
    messages,
    agent,
    max_retries=2,
    request: Request = None,
    cancel_scope: QueryCancelScope = None,
) -> AgentRunResult:
    for attempt in range(max_retries):
        try:
            task = asyncio.create_task(agent.ainvoke(messages))
            output = await _await_cancellable(task, request, cancel_scope)

            if isinstance(output, dict) and "messages" in output:
                trace = list(output["messages"])
                last = trace[-1]
                content = message_content_to_str(getattr(last, "content", last))
                return AgentRunResult(content=content, messages=trace)
            return AgentRunResult(content=str(output), messages=[])
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if is_rate_limit_error(e) and attempt < max_retries - 1:
                delay = extract_retry_delay(e, attempt + 1)
                print(
                    f"[use_agent] Rate limit encountered during agent invocation. "
                    f"Retrying in {delay:.2f}s (attempt {attempt + 1}/{max_retries})..."
                )
                await asyncio.sleep(delay)
            else:
                raise





@app.get("/")
@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "AI_BackEnd"}


@app.get("/visualizations/{visualization_id}")
async def get_visualization_image(visualization_id: str):
    image_bytes = get_visualization(visualization_id)
    if not image_bytes:
        raise HTTPException(status_code=404, detail="Visualization not found")
    return Response(content=image_bytes, media_type="image/png")


# Data source registration and schema introspection endpoints
@app.post("/data-sources/connect")
async def connect_database(request: ConnectDbRequest, raw_req: Request):
    auth_user = getattr(raw_req.state, "auth_user", None)
    owner_id = str(auth_user.customer_id) if auth_user else None
    try:
        result = data_source_manager.register_database_connection(
            request.connection_string, request.custom_name, owner_id=owner_id
        )
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.post("/data-sources/prepare-upload")
async def prepare_upload(request: PrepareUploadRequest, raw_req: Request):
    """
    If Supabase Storage is configured, generates direct signed upload URLs
    so large files upload straight from client browser to Supabase Storage,
    bypassing Vercel's 4.5 MB request body limit.
    """
    if not supabase_storage.is_configured():
        return {"status": "ok", "mode": "direct"}

    upload_id = uuid.uuid4().hex[:12]
    files_info = []
    for f in request.files:
        safe_filename = os.path.basename(f.filename).replace(" ", "_")
        remote_path = f"uploads/{upload_id}/{safe_filename}"
        signed = supabase_storage.create_signed_upload_url(remote_path)
        if not signed:
            # Fallback to direct if sign fails
            return {"status": "ok", "mode": "direct"}
        files_info.append({
            "filename": f.filename,
            "storage_path": remote_path,
            "upload_url": signed["upload_url"],
        })

    return {
        "status": "ok",
        "mode": "supabase",
        "upload_id": upload_id,
        "files": files_info,
    }


@app.post("/data-sources/complete-upload")
async def complete_upload(request: CompleteUploadRequest, raw_req: Request):
    """
    Called after files are uploaded directly to Supabase Storage.
    Downloads the files in backend, creates the DuckDB dataset,
    persists it in Supabase, and removes the temp raw files.
    """
    auth_user = getattr(raw_req.state, "auth_user", None)
    owner_id = str(auth_user.customer_id) if auth_user else None
    try:
        files_data = []
        for file_item in request.files:
            content = supabase_storage.download(file_item.storage_path)
            if not content:
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "error": f"Failed to retrieve {file_item.filename} from storage"},
                )
            files_data.append({"filename": file_item.filename, "content": content})

        result = data_source_manager.register_uploaded_files(
            files_data, custom_name=request.custom_name, owner_id=owner_id
        )

        # Cleanup temp raw files in Supabase Storage
        try:
            supabase_storage.delete([f.storage_path for f in request.files])
        except Exception as e:
            print(f"[SupabaseStorage] Cleanup failed: {e}")

        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.post("/data-sources/upload")
async def upload_data_files(
    raw_req: Request,
    files: List[UploadFile] = File(...),
    custom_name: Optional[str] = Form(None),
):
    auth_user = getattr(raw_req.state, "auth_user", None)
    owner_id = str(auth_user.customer_id) if auth_user else None
    try:
        files_data = []
        for file in files:
            content = await file.read()
            files_data.append({"filename": file.filename, "content": content})

        result = data_source_manager.register_uploaded_files(
            files_data, custom_name=custom_name, owner_id=owner_id
        )
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.patch("/data-sources/{source_id}/rename")
async def rename_data_source(source_id: str, request: RenameSourceRequest, raw_req: Request):
    auth_user = getattr(raw_req.state, "auth_user", None)
    user_id = str(auth_user.customer_id) if auth_user else None
    try:
        result = data_source_manager.rename_source(source_id, request.name, user_id=user_id)
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.delete("/data-sources/{source_id}")
async def delete_data_source(source_id: str, raw_req: Request):
    auth_user = getattr(raw_req.state, "auth_user", None)
    user_id = str(auth_user.customer_id) if auth_user else None
    try:
        result = data_source_manager.delete_source(source_id, user_id=user_id)
        return {"status": "ok", **result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.get("/data-sources/active")
async def get_active_data_sources(raw_req: Request):
    auth_user = getattr(raw_req.state, "auth_user", None)
    user_id = str(auth_user.customer_id) if auth_user else None

    # Dynamically discover newly persisted files locally and in Supabase
    data_source_manager.discover_persisted_sources()

    sources_summary = []
    seen_ids = set()
    global_dataset_added = False

    default_db = data_source_manager.get_default_db()
    if default_db:
        sources_summary.append({
            "source_id": "default",
            "name": "Default Database",
            "type": "database",
            "tables": default_db.get_usable_table_names(),
            "is_global": True,
        })
        seen_ids.add("default")

    for s_id, s in list(data_source_manager.sources.items()):
        if s_id in seen_ids or s_id == "default":
            continue

        is_canonical_global = (s_id == GLOBAL_DATASET_SOURCE_ID)
        is_global = is_canonical_global
        owner_id = s.get("owner_id")

        if user_id and not is_global:
            if owner_id and str(owner_id) != user_id:
                continue

        name = GLOBAL_DATASET_NAME if is_canonical_global else s["name"]

        sources_summary.append({
            "source_id": s_id,
            "name": name,
            "type": s["type"],
            "tables": s.get("tables") or [],
            "is_global": is_global,
        })
        seen_ids.add(s_id)

    return {"status": "ok", "data_sources": sources_summary}


@app.get("/data-sources/{source_id}/schema")
async def get_data_source_schema(source_id: str, raw_req: Request, limit: int = 15):
    auth_user = getattr(raw_req.state, "auth_user", None)
    user_id = str(auth_user.customer_id) if auth_user else None
    if is_production() and user_id and not data_source_manager.can_user_access_source(source_id, user_id):
        return JSONResponse(status_code=403, content={"status": "error", "error": "Access denied to this data source"})

    schema_info = data_source_manager.get_schema(source_id, limit=limit)
    if schema_info.get("error"):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "error": schema_info["error"]},
        )
    return {"status": "ok", "schema": schema_info}


@app.get("/data-sources/{source_id}/tables/{table_name}")
async def get_table_records(source_id: str, table_name: str, raw_req: Request, limit: int = 25):
    auth_user = getattr(raw_req.state, "auth_user", None)
    user_id = str(auth_user.customer_id) if auth_user else None
    if is_production() and user_id and not data_source_manager.can_user_access_source(source_id, user_id):
        return JSONResponse(status_code=403, content={"status": "error", "error": "Access denied to this data source"})

    records = data_source_manager.get_table_data(source_id, table_name, limit=limit)
    if records.get("error"):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "error": records["error"]},
        )
    return {"status": "ok", "table": table_name, "data": records}


# User-tied chat history sync endpoints (cross-device persistence)
@app.get("/chats/recent")
async def get_user_recent_chats(raw_req: Request):
    """Fetch recent chats for the authenticated user across devices."""
    auth_user = getattr(raw_req.state, "auth_user", None)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user_id = str(auth_user.customer_id)

    if supabase_storage.is_configured():
        try:
            data = supabase_storage.download(f"chats/{user_id}.json")
            if data:
                chats = json.loads(data.decode("utf-8"))
                local_path = os.path.join(data_source_manager.storage_dir, f"chats_{user_id}.json")
                try:
                    with open(local_path, "w", encoding="utf-8") as f:
                        json.dump(chats, f, indent=2)
                except Exception:
                    pass
                return {"status": "ok", "chats": chats}
        except Exception as e:
            print(f"[ChatSync] Remote fetch failed for user {user_id}: {e}")

    local_path = os.path.join(data_source_manager.storage_dir, f"chats_{user_id}.json")
    if os.path.isfile(local_path):
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                return {"status": "ok", "chats": json.load(f)}
        except Exception:
            pass

    return {"status": "ok", "chats": []}


@app.post("/chats/recent")
async def save_user_recent_chats(body: ChatSyncRequest, raw_req: Request):
    """Save/sync recent chats for the authenticated user across devices."""
    auth_user = getattr(raw_req.state, "auth_user", None)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user_id = str(auth_user.customer_id)
    chats = body.chats[:10]

    try:
        local_path = os.path.join(data_source_manager.storage_dir, f"chats_{user_id}.json")
        with open(local_path, "w", encoding="utf-8") as f:
            json.dump(chats, f, indent=2)
    except Exception as e:
        print(f"[ChatSync] Local write failed for user {user_id}: {e}")

    if supabase_storage.is_configured():
        try:
            supabase_storage.upload(
                f"chats/{user_id}.json",
                json.dumps(chats, indent=2).encode("utf-8"),
                "application/json",
            )
        except Exception as e:
            print(f"[ChatSync] Remote write failed for user {user_id}: {e}")

    return {"status": "ok"}


def _resolve_query_source(source_id: Optional[str], user_id: Optional[str] = None):
    active_source, fell_back, requested = data_source_manager.resolve_source(source_id, user_id=user_id)
    active_db = active_source["db"] if active_source else None
    return active_source, active_db, fell_back, requested


def _apply_source_to_response(
    result: QueryResponse,
    active_source: Optional[dict],
    fell_back: bool,
    requested: Optional[str],
) -> QueryResponse:
    if active_source:
        result.source_id = active_source.get("source_id")
        result.source_name = active_source.get("name")
    result.source_fallback = fell_back or None
    if fell_back and requested:
        result.source_requested_id = requested
    return result


@app.options("/query")
async def options_query():
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.get("/models")
async def list_available_models():
    """Return configured LLM models so the frontend can offer a selector."""
    return {"status": "ok", "models": modelLoader.get_available_models()}


@app.post("/query", response_model=QueryResponse)
async def query_travel_agent(query: QueryRequest, request: Request):
    try:
        auth = auth_from_request(request)
        bearer = bearer_from_request(request)
        user_id = str(auth.customer_id) if auth else None
        active_source, active_db, fell_back, requested = _resolve_query_source(
            query.source_id, user_id=user_id
        )
        print(
            f"Query: {query.question} | Source: {active_source.get('name') if active_source else 'default'} | Model: {query.model_id or 'default'}"
            + (f" (fallback from {requested})" if fell_back else "")
        )
        with auth_request_context(auth, bearer):
            result = await run_query(
                query,
                active_source,
                active_db,
                use_agent_fn=use_agent,
                request=request,
                is_admin=auth.is_admin,
            )
        return _apply_source_to_response(result, active_source, fell_back, requested)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.options("/query/stream")
async def options_query_stream():
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.post("/query/stream")
async def query_travel_agent_stream(query: QueryRequest, request: Request):
    auth = auth_from_request(request)
    bearer = bearer_from_request(request)
    user_id = str(auth.customer_id) if auth else None
    active_source, active_db, fell_back, requested = _resolve_query_source(
        query.source_id, user_id=user_id
    )

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        cancel_scope = QueryCancelScope()

        async def emit(event_type: str, payload: dict) -> None:
            if cancel_scope.is_cancelled():
                return
            await queue.put(format_sse(event_type, payload))

        async def runner() -> None:
            scope_token = current_cancel_scope.set(cancel_scope)
            try:
                print(
                    f"[stream] Query: {query.question} | Model: {query.model_id or 'default'}"
                )
                with auth_request_context(auth, bearer):
                    result = await run_query_stream(
                        query,
                        active_source,
                        active_db,
                        emit=emit,
                        request=request,
                        cancel_scope=cancel_scope,
                        is_admin=auth.is_admin,
                    )
                result = _apply_source_to_response(
                    result, active_source, fell_back, requested
                )
                if not cancel_scope.is_cancelled():
                    await queue.put(
                        format_sse(
                            "done",
                            result.model_dump(mode="json"),
                        )
                    )
            except asyncio.CancelledError:
                print("[stream] Query cancelled — aborting LLM HTTP streams")
                await queue.put(format_sse("error", {"error": "cancelled"}))
            except Exception as e:
                import traceback
                print(f"\n{'!'*60}")
                print(f"[stream ERROR] Unhandled exception in query runner: {type(e).__name__}: {e}")
                traceback.print_exc()
                print(f"{'!'*60}\n")
                error_msg = str(e) or repr(e) or "Unknown stream error"
                await queue.put(format_sse("error", {"error": error_msg, "type": type(e).__name__, "detail": traceback.format_exc()}))
            finally:
                current_cancel_scope.reset(scope_token)
                await cancel_scope.abort_http()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                if await request.is_disconnected():
                    cancel_scope.cancel()
                    await cancel_scope.abort_http()
                    task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.15)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel_scope.cancel()
            if not task.done():
                task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            await cancel_scope.abort_http()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



# ─── Checkpoint Strategy Endpoints ────────────────────────────────────────────

@app.options("/query/stream/plan")
async def options_query_stream_plan():
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.post("/query/stream/plan")
async def query_stream_plan_phase(query: QueryRequest, request: Request):
    """Checkpoint Phase 1: Router + Schema + Question Planner.

    Streams SSE events for thinking/steps, then emits either:
    - 'done' with a final_response (non-BI agent, no DB connected, or permission denied)
    - 'plan_phase_done' with plan_phase_result (needs SQL data phase next)
    """
    auth = auth_from_request(request)
    bearer = bearer_from_request(request)
    user_id = str(auth.customer_id) if auth else None
    active_source, active_db, fell_back, requested = _resolve_query_source(
        query.source_id, user_id=user_id
    )

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        cancel_scope = QueryCancelScope()

        async def emit(event_type: str, payload: dict) -> None:
            if cancel_scope.is_cancelled():
                return
            await queue.put(format_sse(event_type, payload))

        async def runner() -> None:
            scope_token = current_cancel_scope.set(cancel_scope)
            try:
                print(
                    f"[stream/plan] Query: {query.question} | Model: {query.model_id or 'default'}"
                )
                with auth_request_context(auth, bearer):
                    result = await run_query_stream_plan_phase(
                        query,
                        active_source,
                        active_db,
                        emit=emit,
                        request=request,
                        cancel_scope=cancel_scope,
                        is_admin=auth.is_admin,
                    )

                if not cancel_scope.is_cancelled():
                    if "final_response" in result:
                        resp = result["final_response"]
                        if active_source:
                            resp["source_id"] = resp.get("source_id") or active_source.get("source_id")
                            resp["source_name"] = resp.get("source_name") or active_source.get("name")
                        if fell_back:
                            resp["source_fallback"] = True
                            if requested:
                                resp["source_requested_id"] = requested
                        await queue.put(format_sse("done", result))
                    else:
                        data = result["plan_phase_result"]
                        if active_source:
                            data["source_id"] = data.get("source_id") or active_source.get("source_id")
                            data["source_name"] = data.get("source_name") or active_source.get("name")
                        if fell_back:
                            data["source_fallback"] = True
                        await queue.put(format_sse("plan_phase_done", result))
            except asyncio.CancelledError:
                print("[stream/plan] Query cancelled")
                await queue.put(format_sse("error", {"error": "cancelled"}))
            except Exception as e:
                import traceback
                print(f"\n{'!'*60}")
                print(f"[stream/plan ERROR] {type(e).__name__}: {e}")
                traceback.print_exc()
                print(f"{'!'*60}\n")
                error_msg = str(e) or repr(e) or "Unknown stream error"
                await queue.put(format_sse("error", {"error": error_msg, "type": type(e).__name__}))
            finally:
                current_cancel_scope.reset(scope_token)
                await cancel_scope.abort_http()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                if await request.is_disconnected():
                    cancel_scope.cancel()
                    await cancel_scope.abort_http()
                    task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.15)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel_scope.cancel()
            if not task.done():
                task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            await cancel_scope.abort_http()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.options("/query/stream/data")
async def options_query_stream_data():
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.post("/query/stream/data")
async def query_stream_data_phase(body: Union[DataPhaseRequest, QueryRequest], request: Request):
    """Checkpoint Phase 2: SQL Generation + Execution (+ Synthesis for single chart).

    Streams SSE events for SQL generation/execution, then emits either:
    - 'done' with a final_response (if single-chart path completed)
    - 'data_phase_done' with data_phase_result (if multi-query dashboard, needs assembly next)
    """
    auth = auth_from_request(request)
    bearer = bearer_from_request(request)
    user_id = str(auth.customer_id) if auth else None

    # Resolve source ID from either DataPhaseRequest or QueryRequest
    if isinstance(body, DataPhaseRequest) or hasattr(body, "plan_phase_result"):
        target_source_id = body.source_id or body.plan_phase_result.get("source_id")
        model_id = body.model_id
        input_payload = body.plan_phase_result
    else:
        target_source_id = body.source_id
        model_id = body.model_id
        input_payload = body

    active_source, active_db, fell_back, requested = _resolve_query_source(
        target_source_id, user_id=user_id
    )

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        cancel_scope = QueryCancelScope()

        async def emit(event_type: str, payload: dict) -> None:
            if cancel_scope.is_cancelled():
                return
            await queue.put(format_sse(event_type, payload))

        async def runner() -> None:
            scope_token = current_cancel_scope.set(cancel_scope)
            try:
                print(
                    f"[stream/data] Starting data/SQL phase | Model: {model_id or 'default'}"
                )
                with auth_request_context(auth, bearer):
                    result = await run_query_stream_data_phase(
                        input_payload,
                        active_source,
                        active_db,
                        emit=emit,
                        request=request,
                        cancel_scope=cancel_scope,
                        is_admin=auth.is_admin,
                        model_id=model_id,
                    )

                if not cancel_scope.is_cancelled():
                    if "final_response" in result:
                        resp = result["final_response"]
                        if active_source:
                            resp["source_id"] = resp.get("source_id") or active_source.get("source_id")
                            resp["source_name"] = resp.get("source_name") or active_source.get("name")
                        if fell_back:
                            resp["source_fallback"] = True
                            if requested:
                                resp["source_requested_id"] = requested
                        await queue.put(format_sse("done", result))
                    else:
                        data = result["data_phase_result"]
                        if active_source:
                            data["source_id"] = data.get("source_id") or active_source.get("source_id")
                            data["source_name"] = data.get("source_name") or active_source.get("name")
                        if fell_back:
                            data["source_fallback"] = True
                        await queue.put(format_sse("data_phase_done", result))
            except asyncio.CancelledError:
                print("[stream/data] Query cancelled")
                await queue.put(format_sse("error", {"error": "cancelled"}))
            except Exception as e:
                import traceback
                print(f"\n{'!'*60}")
                print(f"[stream/data ERROR] {type(e).__name__}: {e}")
                traceback.print_exc()
                print(f"{'!'*60}\n")
                error_msg = str(e) or repr(e) or "Unknown stream error"
                await queue.put(format_sse("error", {"error": error_msg, "type": type(e).__name__}))
            finally:
                current_cancel_scope.reset(scope_token)
                await cancel_scope.abort_http()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                if await request.is_disconnected():
                    cancel_scope.cancel()
                    await cancel_scope.abort_http()
                    task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.15)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel_scope.cancel()
            if not task.done():
                task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            await cancel_scope.abort_http()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.options("/query/stream/assemble")
async def options_query_stream_assemble():
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.post("/query/stream/assemble")
async def query_stream_assembly_phase(body: AssemblyRequest, request: Request):
    """Checkpoint Phase 2: Dashboard Assembly from data-phase results.

    Streams SSE events for design/assembly steps, then emits 'done'
    with the final DashboardSpec QueryResponse.
    """
    auth = auth_from_request(request)
    bearer = bearer_from_request(request)

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        cancel_scope = QueryCancelScope()

        async def emit(event_type: str, payload: dict) -> None:
            if cancel_scope.is_cancelled():
                return
            await queue.put(format_sse(event_type, payload))

        async def runner() -> None:
            scope_token = current_cancel_scope.set(cancel_scope)
            try:
                print(f"[stream/assemble] Starting assembly phase")
                with auth_request_context(auth, bearer):
                    result = await run_query_stream_assembly_phase(
                        body.data_phase_result,
                        model_id=body.model_id,
                        emit=emit,
                        cancel_scope=cancel_scope,
                    )

                if not cancel_scope.is_cancelled():
                    await queue.put(
                        format_sse(
                            "done",
                            result.model_dump(mode="json"),
                        )
                    )
            except asyncio.CancelledError:
                print("[stream/assemble] Assembly cancelled")
                await queue.put(format_sse("error", {"error": "cancelled"}))
            except Exception as e:
                import traceback
                print(f"\n{'!'*60}")
                print(f"[stream/assemble ERROR] {type(e).__name__}: {e}")
                traceback.print_exc()
                print(f"{'!'*60}\n")
                error_msg = str(e) or repr(e) or "Unknown stream error"
                await queue.put(format_sse("error", {"error": error_msg, "type": type(e).__name__}))
            finally:
                current_cancel_scope.reset(scope_token)
                await cancel_scope.abort_http()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                if await request.is_disconnected():
                    cancel_scope.cancel()
                    await cancel_scope.abort_http()
                    task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.15)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel_scope.cancel()
            if not task.done():
                task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            await cancel_scope.abort_http()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
