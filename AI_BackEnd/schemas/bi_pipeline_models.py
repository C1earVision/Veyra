"""Pydantic contracts for each stage of the BI analysis pipeline.

Agent 1 (Question Planner)  -> BusinessQuestionsOutput
Agent 2 (SQL Engineer)      -> SQLQueriesOutput
Python  (SQL Executor)      -> List[ExecutedQuery]
Agent 3 (Dashboard Assembler) -> FinalDashboardOutput  (maps to existing DashboardSpec)
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ─── Agent 1: Question Planner Output ────────────────────────────────────────

class AnalyticalIntent(str, Enum):
    """The analytical purpose of a business question."""
    TREND = "trend"                # time-series / temporal analysis
    COMPARISON = "comparison"      # categorical ranking / side-by-side
    DISTRIBUTION = "distribution"  # share of whole / proportional
    KPI = "kpi"                    # single aggregate metric
    CORRELATION = "correlation"    # relationship between variables
    GEOGRAPHIC = "geographic"      # spatial / location / map analysis


class BusinessQuestion(BaseModel):
    """A single business question derived from the user's query."""
    id: str = Field(description="Short unique identifier, e.g. 'q1', 'q2'")
    question: str = Field(description="The business question in plain English")
    intent: AnalyticalIntent = Field(description="The analytical intent of this question")
    relevant_tables: List[str] = Field(
        description="Which DB tables are needed to answer this"
    )
    priority: Literal["high", "medium", "low"] = Field(default="medium")


class BusinessQuestionsOutput(BaseModel):
    """Output of Agent 1 — the Question Planner."""
    user_intent_summary: str = Field(
        description="One-sentence summary of what the user is asking for"
    )
    is_single_chart: bool = Field(
        description=(
            "True when the user wants ONE visualization only: a single chart, a data table, "
            "or a focused question answerable with one chart/table — NOT a multi-page dashboard"
        )
    )
    questions: List[BusinessQuestion] = Field(
        description="The decomposed business questions (1-8 questions)"
    )


# ─── Agent 2: SQL Engineer Output ────────────────────────────────────────────

class SQLQuerySpec(BaseModel):
    """A SQL query mapped to a business question."""
    question_id: str = Field(description="Maps back to BusinessQuestion.id")
    sql: str = Field(description="The SQL SELECT query to execute")
    explanation: str = Field(
        description="Brief explanation of what this query retrieves"
    )


class SQLQueriesOutput(BaseModel):
    """Output of Agent 2 — the SQL Engineer."""
    queries: List[SQLQuerySpec] = Field(
        description="One SQL query per business question"
    )


# ─── Intermediate: Executed Query (Python fills this) ────────────────────────

class ExecutedQuery(BaseModel):
    """A business question with its executed SQL result data."""
    question_id: str
    question: str
    intent: AnalyticalIntent
    sql: str
    columns: List[str] = Field(default_factory=list)
    data: List[Dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    error: Optional[str] = None


# ─── Agent 3: Dashboard Assembler Output (Final) ─────────────────────────────

class ChartDataKeySpec(BaseModel):
    key: str
    name: str
    color: Optional[str] = None


class SingleChartPlan(BaseModel):
    """Output of the Single Chart / Table Agent — one SQL query + one visualization."""

    title: str = Field(description="Chart or table title shown in the UI")
    description: str = Field(description="Short subtitle explaining what is shown")
    chart_type: Literal["table", "area", "line", "bar", "donut", "pie", "map"] = Field(
        description="Visualization type; use 'table' when the user asked for tabular output"
    )
    sql: str = Field(description="Single SELECT query to populate the visualization")
    dataSourceId: str = Field(
        description="The identifier for the SQL result to be used (typically 'single')",
        default="single"
    )
    xAxisKey: str = Field(
        description="Primary category/label column (first column for tables when applicable)"
    )
    dataKeys: List[ChartDataKeySpec] = Field(
        description=(
            "Metric columns for charts. For type=table, include every column to display "
            "(key=column name, name=human label)."
        )
    )
    include_slider: bool = Field(
        default=False,
        description="True to add an interactive threshold slider for this visualization",
    )
    slider_filter_key: Optional[str] = Field(
        default=None,
        description="Numeric column in the query result filtered by the slider",
    )
    slider_label: Optional[str] = None
    slider_unit: Optional[str] = None
    slider_operator: Literal[">=", "<=", ">", "<", "=="] = ">="
    summary: str = Field(
        description=(
            "Markdown leading with a direct answer with exact numbers and "
            "optional '### Recommendations' (1-2 bullets). No 'Key Takeaways', no dashboard layout prose."
        )
    )


class ChartSpec(BaseModel):
    """A fully populated chart for the frontend."""
    id: str
    title: str
    description: str
    type: Literal["area", "line", "bar", "donut", "pie", "map", "slider", "table", "scatter", "treemap", "waterfall", "radar", "funnel"]
    xAxisKey: str
    dataKeys: List[ChartDataKeySpec]
    data: List[Dict[str, Any]] = Field(default_factory=list)
    dataSourceId: Optional[str] = Field(
        default=None,
        description="Reference key (e.g. 'q1') to the executed query result used to populate this chart"
    )

    # ── Map-specific fields ──
    latKey: Optional[str] = Field(default=None, description="Column name for latitude values (map charts only)")
    lngKey: Optional[str] = Field(default=None, description="Column name for longitude values (map charts only)")
    valueKey: Optional[str] = Field(default=None, description="Column name for the numeric value shown on map markers")
    markerLabel: Optional[str] = Field(default=None, description="Column name used for marker popup labels")

    # ── Slider-specific fields ──
    sliderMin: Optional[float] = Field(default=None, description="Minimum slider value")
    sliderMax: Optional[float] = Field(default=None, description="Maximum slider value")
    sliderStep: Optional[float] = Field(default=None, description="Step increment for the slider")
    filterKey: Optional[str] = Field(default=None, description="Column in data to filter against the slider value")
    sliderUnit: Optional[str] = Field(default=None, description="Unit label for the slider, e.g. '$', 'days', '%'")

    @model_validator(mode="before")
    @classmethod
    def sanitize_chart_spec(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        x_key = data.get("xAxisKey")
        rows = data.get("data")
        if not rows or not isinstance(rows, list) or not isinstance(rows[0], dict):
            return data

        sample_row = rows[0]
        # Check if x_key is an ID column or looks like an ID / hash
        is_id_key = False
        if x_key:
            x_lower = x_key.lower()
            if any(x_lower.endswith(sfx) for sfx in ["_id", "id", "_uuid", "uuid", "_hash", "hash", "_key"]):
                is_id_key = True
            first_val = str(sample_row.get(x_key, ""))
            if len(first_val) >= 20 and " " not in first_val:
                is_id_key = True

        if is_id_key:
            # Check if there is another non-ID text column in the data to use instead
            better_keys = [
                k for k, v in sample_row.items()
                if isinstance(v, str)
                and not any(k.lower().endswith(sfx) for sfx in ["_id", "id", "_uuid", "uuid", "_hash", "hash", "_key"])
                and len(v) < 60
            ]
            if better_keys:
                # Prefer name, title, category, label
                preferred = sorted(
                    better_keys,
                    key=lambda k: 0 if any(p in k.lower() for p in ["name", "title", "category", "label", "city", "status"]) else 1
                )
                data["xAxisKey"] = preferred[0]
            else:
                # No better text column exists — create a clean human-readable label
                entity_name = x_key.replace("_id", "").replace("id", "").title() or "Item"
                new_key = f"{x_key}_label"
                new_rows = []
                for idx, r in enumerate(rows):
                    new_r = dict(r)
                    old_val = str(r.get(x_key, ""))
                    short_hash = old_val[:6] if len(old_val) >= 6 else old_val
                    new_r[new_key] = f"{entity_name} #{idx + 1} ({short_hash})"
                    new_rows.append(new_r)
                data["xAxisKey"] = new_key
                data["data"] = new_rows

        return data


class KPISpec(BaseModel):
    label: str = Field(description="Short title of the KPI scorecard, e.g. 'Total Orders'")
    value: Any = Field(description="Scalar metric value string or number, e.g. '$12,450', '527', '94.2%'. NEVER a JSON object or dictionary.")
    change: Optional[str] = Field(default=None, description="Optional trend change, e.g. '+12.5%'")
    description: Optional[str] = Field(default=None, description="Optional brief context subtitle")

    @field_validator("value", mode="before")
    @classmethod
    def clean_kpi_value(cls, v: Any) -> str:
        """Unwrap any dictionary, nested dictionary, or stringified JSON into a clean scalar string."""
        if v is None:
            return ""
        if isinstance(v, dict):
            for k in ["value", "val", "amount", "total", "count", "score"]:
                if k in v:
                    return cls.clean_kpi_value(v[k])
            for val in v.values():
                if isinstance(val, (int, float, str)):
                    return cls.clean_kpi_value(val)
            return str(v)
        if isinstance(v, (int, float)):
            if isinstance(v, float):
                return f"{v:,.2f}" if abs(v) < 1000000 else f"{v:,.0f}"
            return f"{v:,}"
        if isinstance(v, str):
            s = v.strip()
            # If stringified JSON dictionary like '{"value": 527}'
            if (s.startswith("{") and s.endswith("}")) or (s.startswith("{'") and s.endswith("}")):
                try:
                    import json
                    parsed = json.loads(s.replace("'", '"'))
                    return cls.clean_kpi_value(parsed)
                except Exception:
                    pass
            return s
        return str(v)


class PageInsights(BaseModel):
    """Insights for a single dashboard page."""
    insights: List[str] = Field(
        description="2-4 analytical bullet points for this page"
    )


class SliderSpec(BaseModel):
    """An interactive filter slider control in the dashboard.
    
    Sliders are standalone interactive elements that dynamically filter data
    across charts based on their targetScope and filterKey.
    """
    id: str = Field(description="Unique identifier for the slider, e.g. 'slider_price_threshold', 'slider_min_orders'")
    label: str = Field(description="User-facing title for the slider, e.g. 'Price Threshold', 'Minimum Orders', 'Rating Filter'")
    description: Optional[str] = Field(default=None, description="Brief explanation of what dragging the slider changes")
    filterKey: str = Field(description="Column name in chart data to filter against, e.g. 'price', 'order_value', 'revenue', 'review_score'")
    sliderMin: float = Field(description="Minimum value for the slider range (derived from observed data)")
    sliderMax: float = Field(description="Maximum value for the slider range (derived from observed data)")
    sliderStep: Optional[float] = Field(default=None, description="Step increment (e.g. 1, 10, 50, 0.5)")
    defaultValue: Optional[float] = Field(default=None, description="Initial slider position, defaults to sliderMin")
    sliderUnit: Optional[str] = Field(default=None, description="Unit label displayed next to the slider, e.g. '$', 'units', 'days', '%'")
    targetScope: Literal["all", "page", "chart"] = Field(
        default="page",
        description=(
            "Scope of impact decided by the model: "
            "'all' = filters matching charts across the ENTIRE dashboard; "
            "'page' = filters matching charts on this specific page; "
            "'chart' = filters ONLY the specific chart(s) specified in targetChartIds."
        )
    )
    targetChartIds: Optional[List[str]] = Field(
        default=None,
        description="List of specific chart IDs that this slider filters. Required when targetScope is 'chart'. If targetScope is 'all' or 'page', leave empty to automatically affect all charts containing filterKey."
    )
    operator: Literal[">=", "<=", ">", "<", "=="] = Field(
        default=">=",
        description="Comparison operator for filtering: '>=' (threshold floor), '<=' (ceiling maximum), etc."
    )


class DashboardPageSpec(BaseModel):
    """A single page in the final dashboard."""
    id: str
    name: str
    icon: Literal[
        "overview", "products", "finance",
        "operations", "customers", "analytics", "alerts"
    ]
    summary: str
    insights: List[str] = Field(
        description="2-4 analytical bullet points"
    )
    kpis: List[KPISpec] = Field(
        description="2-4 KPI scorecards"
    )
    charts: List[ChartSpec] = Field(
        description="1-4 charts for this page"
    )
    sliders: Optional[List[SliderSpec]] = Field(
        default=None,
        description="Optional interactive sliders for this page or targeted charts"
    )


class FinalDashboardOutput(BaseModel):
    """Output of Agent 3 — the complete dashboard specification.
    
    Maps directly to the existing frontend DashboardSpec shape.
    """
    content: str = Field(
        description=(
            "Markdown text starting with a direct, comprehensive answer to the user's question with headline numbers and metrics, "
            "followed by '### Key Takeaways' (3-5 data-backed bullets) and '### Recommendations' (2-4 bullets). "
            "NO generic dashboard layout descriptions, NO SQL details, NO pleasantries."
        )
    )
    dashboard_title: str = Field(description="High-level report title")
    dashboard_subtitle: str = Field(description="Descriptive subtitle")
    pages: List[DashboardPageSpec] = Field(
        description="1-4 dashboard pages"
    )
    global_sliders: Optional[List[SliderSpec]] = Field(
        default=None,
        description="Optional dashboard-wide interactive sliders affecting charts across all pages"
    )
