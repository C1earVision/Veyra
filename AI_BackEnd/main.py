from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from DB.agent_visualizations import get_visualization
from starlette.responses import JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import Optional, List, Any
import asyncio
import os
from Utils.ModelLoader import is_rate_limit_error, extract_retry_delay, modelLoader
from Utils.agent_trace import message_content_to_str
from Utils.query_pipeline import run_query, run_query_stream
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
from DB.DataSourceManager import data_source_manager
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _path_requires_auth(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    if normalized in ("/query", "/query/stream", "/models"):
        return True
    return normalized.startswith("/data-sources")


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


class ConnectDbRequest(BaseModel):
    connection_string: str
    custom_name: Optional[str] = None


class RenameSourceRequest(BaseModel):
    name: str


class QueryRequest(BaseModel):
    question: str
    source_id: Optional[str] = None
    model_id: Optional[str] = None


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
async def connect_database(request: ConnectDbRequest):
    try:
        result = data_source_manager.register_database_connection(
            request.connection_string, request.custom_name
        )
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.post("/data-sources/upload")
async def upload_data_files(
    files: List[UploadFile] = File(...),
    custom_name: Optional[str] = Form(None),
):
    try:
        files_data = []
        for file in files:
            content = await file.read()
            files_data.append({"filename": file.filename, "content": content})

        result = data_source_manager.register_uploaded_files(
            files_data, custom_name=custom_name
        )
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.patch("/data-sources/{source_id}/rename")
async def rename_data_source(source_id: str, request: RenameSourceRequest):
    try:
        result = data_source_manager.rename_source(source_id, request.name)
        return {"status": "ok", "data_source": result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.delete("/data-sources/{source_id}")
async def delete_data_source(source_id: str):
    try:
        result = data_source_manager.delete_source(source_id)
        return {"status": "ok", **result}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


@app.get("/data-sources/active")
async def get_active_data_sources():
    sources_summary = []
    for s_id, s in data_source_manager.sources.items():
        sources_summary.append({
            "source_id": s_id,
            "name": s["name"],
            "type": s["type"],
            "tables": s["tables"],
        })
    default_db = data_source_manager.get_default_db()
    if default_db:
        sources_summary.insert(0, {
            "source_id": "default",
            "name": "Default Database",
            "type": "database",
            "tables": default_db.get_usable_table_names(),
        })
    return {"status": "ok", "data_sources": sources_summary}


@app.get("/data-sources/{source_id}/schema")
async def get_data_source_schema(source_id: str, limit: int = 15):
    schema_info = data_source_manager.get_schema(source_id, limit=limit)
    if schema_info.get("error"):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "error": schema_info["error"]},
        )
    return {"status": "ok", "schema": schema_info}


@app.get("/data-sources/{source_id}/tables/{table_name}")
async def get_table_records(source_id: str, table_name: str, limit: int = 25):
    records = data_source_manager.get_table_data(source_id, table_name, limit=limit)
    if records.get("error"):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "error": records["error"]},
        )
    return {"status": "ok", "table": table_name, "data": records}


def _resolve_query_source(source_id: Optional[str]):
    active_source, fell_back, requested = data_source_manager.resolve_source(source_id)
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
        active_source, active_db, fell_back, requested = _resolve_query_source(
            query.source_id
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
    active_source, active_db, fell_back, requested = _resolve_query_source(
        query.source_id
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