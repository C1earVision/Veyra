"""Shared query routing for JSON and streaming endpoints."""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional

from Agent.AgenticWorkFlow import (
    GeneralAgent,
    SearchAgent,
    RagAgent,
    CrudAgent,
    analysisAgent,
)
from Agent.bi_pipeline.orchestrator import run_bi_pipeline
from Prompt.generalSysPrompt import GENERAL_SYSTEM_PROMPT
from Prompt.SearchSysPrompt import SEARCH_SYSTEM_PROMPT
from Prompt.RagSysPropmt import RAG_SYSTEM_PROMPT
from Prompt.dashboardSysPrompt import DASHBOARD_SYSTEM_PROMPT
from Prompt.analysisAgent import ANALYSIS_AGENT_SYSTEM_PROMPT
from Utils.agent_trace import build_agent_steps, message_content_to_str
from Utils.agent_stream import stream_agent_run
from Utils.answer_parser import parse_agent_payload
from Utils.request_context import QueryCancelScope
from schemas.query_models import QueryResponse

import os

EmitFn = Callable[[str, dict], Any]

DATABASE_REQUIRED_AGENTS = ("use_rag_agent", "use_data_analysis_and_visualization_agent")
NO_DATABASE_CONNECTED_MESSAGE = (
    "Please connect to a database first to answer questions about your data. "
    "You can connect a database or upload a dataset (CSV/Excel) using the Data Source button in the sidebar."
)


def _normalize_agent_choice(raw: Any) -> str:
    text = message_content_to_str(raw)
    return text.strip().strip("'").strip('"') if isinstance(text, str) else str(text)


def _resolve_router_model(model_id: Optional[str]) -> str | None:
    """Classifying requests is a lightweight task — use gemini-3.5-flash-lite if Gemini is available or selected."""
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if gemini_key and (not model_id or "gemini" in model_id.lower()):
        return "gemini:gemini-3.5-flash-lite"
    return model_id


def _resolve_specialist_model(model_id: Optional[str]) -> str | None:
    """Complex reasoning / multi-step tasks — use gemini-3.8-flash if Gemini is available or selected."""
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if gemini_key and (not model_id or "gemini" in model_id.lower()):
        return "gemini:gemini-3.8-flash"
    return model_id


def build_specialist_graph(agent_choice: str, query, active_db):
    chosen_model = _resolve_specialist_model(query.model_id)
    provider = "gemini" if chosen_model and "gemini" in chosen_model.lower() else "groq"
    strong_provider = "gemini" if chosen_model and "gemini" in chosen_model.lower() else "openai"

    if agent_choice == "use_web_search_agent":
        return SearchAgent(
            system_prompt=SEARCH_SYSTEM_PROMPT,
            model_provider=provider,
            model_id=chosen_model,
        )()
    if agent_choice == "use_rag_agent":
        return RagAgent(
            system_prompt=RAG_SYSTEM_PROMPT,
            model_provider=strong_provider,
            db=active_db,
            model_id=chosen_model,
        )()
    if agent_choice == "use_crud_agent":
        return CrudAgent(
            system_prompt=DASHBOARD_SYSTEM_PROMPT,
            model_provider=strong_provider,
            model_id=chosen_model,
        )()
    if agent_choice == "use_data_analysis_and_visualization_agent":
        return analysisAgent(
            system_prompt=ANALYSIS_AGENT_SYSTEM_PROMPT,
            model_provider=strong_provider,
            db=active_db,
            model_id=chosen_model,
        )()
    return None


async def run_query(
    query,
    active_source,
    active_db,
    *,
    use_agent_fn,
    request=None,
    cancel_scope: Optional[QueryCancelScope] = None,
    is_admin: bool = False,
) -> QueryResponse:
    router_model = _resolve_router_model(query.model_id)
    router_provider = "gemini" if router_model and "gemini" in router_model.lower() else "groq"
    graph = GeneralAgent(
        system_prompt=GENERAL_SYSTEM_PROMPT,
        model_provider=router_provider,
        model_id=router_model,
    )
    general_agent = graph()
    messages = {"messages": [query.question]}

    router_run = await use_agent_fn(
        messages, general_agent, request=request, cancel_scope=cancel_scope
    )
    trace_steps = build_agent_steps(router_run.messages)
    agent_choice = _normalize_agent_choice(router_run.content)

    # Check: If the question requires querying a database, verify that a database is connected first
    if agent_choice in DATABASE_REQUIRED_AGENTS and not active_db:
        return QueryResponse(
            answer=NO_DATABASE_CONNECTED_MESSAGE,
            agent=agent_choice,
            steps=trace_steps,
            source_id=active_source["source_id"] if active_source else None,
            source_name=active_source["name"] if active_source else None,
        )

    specialist_run = None
    final_raw: Any = None

    if agent_choice == "use_web_search_agent":
        specialist_run = await use_agent_fn(
            messages,
            build_specialist_graph(agent_choice, query, active_db),
            request=request,
            cancel_scope=cancel_scope,
        )
    elif agent_choice == "use_rag_agent":
        try:
            specialist = build_specialist_graph(agent_choice, query, active_db)
            specialist_run = await use_agent_fn(
                messages,
                specialist,
                request=request,
                cancel_scope=cancel_scope,
            )
        except Exception as e:
            print(f"[pipeline] Error initializing {agent_choice}: {e}")
            final_raw = f"Unable to query database: {e}"
    elif agent_choice == "use_crud_agent":
        if is_admin:
            specialist_run = await use_agent_fn(
                messages,
                build_specialist_graph(agent_choice, query, active_db),
                request=request,
                cancel_scope=cancel_scope,
            )
        else:
            final_raw = "User has no access to this information"
    elif agent_choice == "use_data_analysis_and_visualization_agent":
        if is_admin:
            # Use the new multi-agent BI pipeline
            tables = active_source.get("tables", []) if active_source else []
            if active_db and not tables:
                tables = list(active_db.get_usable_table_names())
            pipeline_result = await run_bi_pipeline(
                user_query=query.question,
                db=active_db,
                tables=tables,
                model_id=query.model_id,
                request=request,
                cancel_scope=cancel_scope,
            )
            # Merge router steps with pipeline steps
            pipeline_result.steps = trace_steps + pipeline_result.steps
            pipeline_result.source_id = active_source["source_id"] if active_source else "default"
            pipeline_result.source_name = active_source["name"] if active_source else "Default Database"
            return pipeline_result
        else:
            final_raw = "User has no access to this information"
    else:
        final_raw = router_run.content

    if specialist_run is not None:
        trace_steps.extend(build_agent_steps(specialist_run.messages))
        final_raw = specialist_run.content

    parsed = parse_agent_payload(final_raw)
    return QueryResponse(
        answer=parsed.answer,
        agent=agent_choice,
        image=parsed.image,
        dashboard=parsed.dashboard,
        thinking=parsed.thinking,
        steps=trace_steps,
        source_id=active_source["source_id"] if active_source else "default",
        source_name=active_source["name"] if active_source else "Default Database",
    )


async def run_query_stream(
    query,
    active_source,
    active_db,
    emit: EmitFn,
    request=None,
    cancel_scope: Optional[QueryCancelScope] = None,
    is_admin: bool = False,
) -> QueryResponse:
    router_model = _resolve_router_model(query.model_id)
    router_provider = "gemini" if router_model and "gemini" in router_model.lower() else "groq"
    graph = GeneralAgent(
        system_prompt=GENERAL_SYSTEM_PROMPT,
        model_provider=router_provider,
        model_id=router_model,
    )
    general_agent = graph()
    messages = {"messages": [query.question]}

    await emit("status", {"phase": "router", "text": "Choosing specialist agent…"})
    try:
        router_messages = await stream_agent_run(
            general_agent,
            messages,
            phase="router",
            emit=emit,
            request=request,
            cancel_scope=cancel_scope,
        )
    except asyncio.CancelledError:
        raise
    trace_steps = build_agent_steps(router_messages)
    agent_choice = _normalize_agent_choice(
        message_content_to_str(getattr(router_messages[-1], "content", ""))
        if router_messages
        else ""
    )
    await emit("agent", {"agent": agent_choice})

    # Check: If the question requires querying a database, verify that a database is connected first
    if agent_choice in DATABASE_REQUIRED_AGENTS and not active_db:
        await emit("status", {"phase": "specialist", "text": "Database not connected"})
        return QueryResponse(
            answer=NO_DATABASE_CONNECTED_MESSAGE,
            agent=agent_choice,
            steps=trace_steps,
            source_id=active_source["source_id"] if active_source else None,
            source_name=active_source["name"] if active_source else None,
        )

    final_raw: Any = None
    specialist_messages = None

    needs_admin = agent_choice in ("use_crud_agent", "use_data_analysis_and_visualization_agent")
    if needs_admin and not is_admin:
        final_raw = "User has no access to this information"
    elif agent_choice == "use_data_analysis_and_visualization_agent":
        # Use the new multi-agent BI pipeline (has its own streaming via emit)
        tables = active_source.get("tables", []) if active_source else []
        if active_db and not tables:
            tables = list(active_db.get_usable_table_names())
        pipeline_result = await run_bi_pipeline(
            user_query=query.question,
            db=active_db,
            tables=tables,
            model_id=query.model_id,
            emit=emit,
            request=request,
            cancel_scope=cancel_scope,
        )
        # Merge router steps with pipeline steps
        pipeline_result.steps = trace_steps + pipeline_result.steps
        pipeline_result.source_id = active_source["source_id"] if active_source else "default"
        pipeline_result.source_name = active_source["name"] if active_source else "Default Database"
        return pipeline_result
    elif agent_choice in (
        "use_web_search_agent",
        "use_rag_agent",
        "use_crud_agent",
    ):
        try:
            specialist = build_specialist_graph(agent_choice, query, active_db)
        except Exception as e:
            print(f"[pipeline stream] Failed to initialize {agent_choice}: {e}")
            final_raw = f"Unable to run {agent_choice}: {e}"
            specialist = None

        if specialist is not None:
            await emit(
                "status",
                {"phase": "specialist", "text": f"Running {agent_choice}…"},
            )
            try:
                specialist_messages = await stream_agent_run(
                    specialist,
                    messages,
                    phase="specialist",
                    emit=emit,
                    request=request,
                    cancel_scope=cancel_scope,
                )
            except asyncio.CancelledError:
                raise
            trace_steps.extend(build_agent_steps(specialist_messages))
            final_raw = getattr(specialist_messages[-1], "content", "") if specialist_messages else ""
    else:
        final_raw = getattr(router_messages[-1], "content", "") if router_messages else ""

    parsed = parse_agent_payload(final_raw)
    return QueryResponse(
        answer=parsed.answer,
        agent=agent_choice,
        image=parsed.image,
        dashboard=parsed.dashboard,
        thinking=parsed.thinking,
        steps=trace_steps,
        source_id=active_source["source_id"] if active_source else "default",
        source_name=active_source["name"] if active_source else "Default Database",
    )
