"""Parse agent final output into structured answer / dashboard / image fields."""

from __future__ import annotations

import json
import re
from typing import Any, Optional, Tuple

from schemas.query_models import DashboardSpec, ParsedAgentPayload, coerce_dashboard
from Utils.agent_trace import merge_thinking, split_thinking_from_text


def _normalize_image_url(image_url: str, base_env_key: str = "AI_BACKEND_URL") -> str:
    import os

    image_url = image_url.strip()
    if image_url.startswith("/"):
        base = os.environ.get(base_env_key, "http://127.0.0.1:9000").rstrip("/")
        return f"{base}{image_url}"
    return image_url


def _extract_json_object(text: str) -> Optional[dict]:
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape_next = False

    for i in range(start, len(text)):
        ch = text[i]
        if escape_next:
            escape_next = False
            continue
        if ch == "\\":
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : i + 1]
                try:
                    return json.loads(candidate, strict=False)
                except json.JSONDecodeError:
                    start = text.find("{", i + 1)
                    if start == -1:
                        return None
                    depth = 0
    return None


def _clean_dashboard_content(content: str) -> str:
    if not content or not isinstance(content, str):
        return ""

    text = content.strip()

    unwanted_section_patterns = [
        r"(?i)#{1,4}\s*(?:Dashboard Overview|Dashboard Structure|Report Structure|Visualizations?|Dashboard Pages?|Pages? Breakdown|Report Pages?|Report Overview|Overview of the Dashboard).*?(?=(?:\n#{1,4}|\Z))",
        r"(?i)(?:^|\n)[*-]?\s*\**Page \d+[:\s\*\-].*?(?=(?:\n[*-]|\n#{1,4}|\Z))",
        r"(?i)(?:^|\n)[*-]?\s*\**(?:Chart|Visual)\s*\d+[:\s\*\-].*?(?=(?:\n[*-]|\n#{1,4}|\Z))",
    ]
    for pat in unwanted_section_patterns:
        text = re.sub(pat, "\n", text, flags=re.DOTALL)

    unwanted_sentence_patterns = [
        r"(?i)(?:^|\n)\s*(?:Here is the (?:interactive )?dashboard|Below is the (?:interactive )?dashboard|The (?:interactive )?dashboard below|This dashboard (?:features|consists of|contains|provides|includes|is structured)|We have generated a (?:multi-page )?dashboard|In this report, we present|The report is organized into).*?(?:\.|\n)",
        r"(?i)(?:^|\n)\s*(?:We queried the (?:database|tables?)|Using SQL aggregations?|The data was retrieved from|Through dynamic database discovery).*?(?:\.|\n)",
    ]
    for pat in unwanted_sentence_patterns:
        text = re.sub(pat, "\n", text)

    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_agent_payload(
    raw_answer: Any,
    extra_thinking: Optional[str] = None,
) -> ParsedAgentPayload:
    thinking_parts: list[Optional[str]] = [extra_thinking]

    if raw_answer is None:
        return ParsedAgentPayload(answer="", thinking=merge_thinking(*thinking_parts))

    if isinstance(raw_answer, dict):
        content = raw_answer.get("content") or raw_answer.get("answer") or ""
        image = raw_answer.get("image")
        dashboard_raw = raw_answer.get("dashboard")
        if dashboard_raw is None and ("pages" in raw_answer or "charts" in raw_answer):
            dashboard_raw = raw_answer
            if not content:
                content = raw_answer.get("title", "Dashboard")

        content_str = str(content) if content is not None else ""
        content_str, inline = split_thinking_from_text(content_str)
        thinking_parts.append(inline)

        dashboard = coerce_dashboard(dashboard_raw)
        if dashboard:
            content_str = _clean_dashboard_content(content_str)

        norm_image = _normalize_image_url(str(image)) if image else None
        return ParsedAgentPayload(
            answer=content_str,
            image=norm_image,
            dashboard=dashboard,
            thinking=merge_thinking(*thinking_parts),
        )

    text = str(raw_answer).strip()
    text, inline = split_thinking_from_text(text)
    thinking_parts.append(inline)

    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```\s*$", "", text)
    text = text.strip()

    parsed = None
    try:
        parsed = json.loads(text, strict=False)
    except json.JSONDecodeError:
        parsed = _extract_json_object(text)

    if parsed is None:
        cleaned = text.replace("\\n", "\n").replace("\\'", "'")
        try:
            parsed = json.loads(cleaned, strict=False)
        except json.JSONDecodeError:
            parsed = _extract_json_object(cleaned)

    if isinstance(parsed, dict):
        content = (
            parsed.get("content")
            or parsed.get("answer")
            or parsed.get("summary")
            or ""
        )
        image = parsed.get("image")
        dashboard_raw = parsed.get("dashboard")
        if dashboard_raw is None and ("pages" in parsed or "charts" in parsed):
            dashboard_raw = parsed
            if not content:
                content = parsed.get("title", "Dashboard")

        content_str = str(content) if content is not None else ""
        dashboard = coerce_dashboard(dashboard_raw)
        if dashboard:
            content_str = _clean_dashboard_content(content_str)

        norm_image = _normalize_image_url(str(image)) if image else None
        return ParsedAgentPayload(
            answer=content_str,
            image=norm_image,
            dashboard=dashboard,
            thinking=merge_thinking(*thinking_parts),
        )

    return ParsedAgentPayload(
        answer=text,
        thinking=merge_thinking(*thinking_parts),
    )
