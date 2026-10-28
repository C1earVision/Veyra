<div align="center">

# Veyra

**An intelligent multi-agent BI assistant & management platform that turns natural language into SQL queries, interactive dashboards, and actionable insights — powered by LangGraph & Agentic RAG**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![LangChain](https://img.shields.io/badge/LangChain-🦜-1C3C3C)](https://langchain.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent_Framework-purple)](https://langchain-ai.github.io/langgraph/)
[![DuckDB](https://img.shields.io/badge/DuckDB-File_Analytics-FEF000?logo=duckdb&logoColor=black)](https://duckdb.org)

</div>

## Live Demo

🔗 **https://Veyra-chi.vercel.app/**

Login Credentials for Live Demo:
Email: `akali@gmaill.com` | Password: `akali`

---

## Overview

Veyra is a full-stack **Agentic RAG** (Retrieval-Augmented Generation) assistant and business intelligence platform. It uses a **multi-agent architecture** where a General Router Agent analyzes each query and delegates it to the best-fit specialized agent — whether that's searching the web, querying any connected database via natural language SQL, performing CRUD operations, or generating interactive multi-page dashboards with KPIs and charts.

**What makes Veyra different from conventional chatbot or BI tools:**

- **Domain-agnostic** — works across any business domain (e-commerce, banking, restaurant, healthcare, SaaS, etc.) by dynamically discovering database schemas at runtime rather than relying on hardcoded table structures.
- **Bring Your Own Data** — users can connect any external PostgreSQL/MySQL/SQLite database via connection string, or upload CSV/Excel files that are automatically ingested into a DuckDB analytics engine and become queryable instantly.
- **Interactive Dashboards, not static charts** — the Analysis Agent generates structured JSON dashboard specifications with multi-page layouts, KPI scorecards, and Recharts-powered visualizations, rendered as a fully interactive PowerBI-style experience in the browser.
- **Resilient LLM infrastructure** — a configurable multi-model fallback chain (Groq → OpenAI) with custom `ResilientChatGroq`/`ResilientChatOpenAI` wrappers that extract retry delays from error messages and intelligently back off on rate limits instead of failing.

### Key Features

- 🤖 **Multi-Agent Routing** — Intelligent intent classification routes each message to specialized agents
- 🔍 **Web Search** — Real-time internet search via Tavily for up-to-date market info and benchmarks
- 🗃️ **RAG over SQL** — Natural language queries translated to SQL against any connected database (PostgreSQL, MySQL, SQLite, DuckDB)
- ✏️ **Catalog CRUD Operations** — Dedicated agent tools for adding products with auto-fetched images via Tavily image search
- 📊 **Interactive Dashboards** — Multi-page PowerBI-style reports with KPI scorecards, area/bar/line/donut charts, page tabs, fullscreen mode, chart expand modals, and CSV data export
- 📈 **Static Visualizations** — matplotlib/pandas chart generation with images persisted to PostgreSQL and served via API
- 🔗 **Dynamic Data Sources** — Connect external databases via connection string or upload CSV/Excel files at runtime; hot-swap between data sources per query
- 🔎 **Data Explorer** — Visual database browser with schema introspection, DDL viewer, live record previews, image lightbox for binary columns, horizontal scroll slider, and configurable row limits
- 🛡️ **Resilient Model Chain** — YAML-configurable multi-model fallback chain with automatic rate-limit backoff (parses `try again in Xs` from Groq/OpenAI errors)
- 🔐 **Secure Authentication** — JWT-based auth restricted to business owners / administrators with Helmet, XSS-Clean, and rate limiting
- 🌐 **Production Deployed** — Frontend on Vercel, AI Backend on Render/Railway, Node.js Backend on Vercel, PostgreSQL on Supabase

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                         │
│       :9001 — Agent Chat │ Interactive Dashboards │ Data Explorer       │
│              │ Data Source Modal │ Login Page                          │
└───────────────────────────┬────────────────────────────────────────────┘
                            │  HTTP
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
┌───────────────────────┐    ┌──────────────────────────────────────────┐
│   BackEnd (Node.js)   │    │        AI BackEnd (FastAPI)              │
│        :3000          │    │              :9000                       │
│                       │    │                                          │
│  • Admin Auth (JWT)   │    │  ┌────────────────────────────────┐      │
│  • Product CRUD       │    │  │     General Router Agent       │      │
│  • Order Management   │    │  │  (LangGraph + Groq/OpenAI)    │      │
│  • Security           │    │  └──────┬──┬──┬──┬───────────────┘      │
│    (Helmet, XSS,      │    │         │  │  │  │                      │
│     Rate Limit)       │    │  ┌──────▼──▼──▼──▼───────────────┐      │
└───────────────────────┘    │  │ Search │ RAG  │ CRUD │Analysis│      │
                             │  │ Agent  │Agent │Agent │ Agent  │      │
                             │  └────────┴──┬───┴──────┴───┬────┘      │
                             │              │              │            │
                             │  ┌───────────▼──────────────▼─────┐     │
                             │  │    DataSourceManager            │     │
                             │  │  (Dynamic DB + File Sources)    │     │
                             │  └──┬────────────────────┬────────┘     │
                             └─────┼────────────────────┼──────────────┘
                                   │                    │
                    ┌──────────────┼────┐         ┌─────▼──────┐
                    │              │    │         │   Tavily   │
                    ▼              ▼    ▼         │  Web API   │
              ┌──────────┐  ┌──────────┐         └────────────┘
              │PostgreSQL│  │ DuckDB   │
              │(Supabase)│  │(Uploaded  │
              │          │  │ CSV/Excel)│
              └──────────┘  └──────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **AI / Agents** | LangChain · LangGraph · OpenAI · Groq · Tavily |
| **AI Backend** | Python 3.11+ · FastAPI · Uvicorn · Pydantic · psycopg2 · DuckDB · pandas |
| **Backend** | Node.js · Express · pg (node-postgres) · multer |
| **Frontend** | React 18 · Vite · Tailwind CSS · shadcn/ui · Recharts · Lucide Icons · React Markdown |
| **Database** | PostgreSQL (Supabase) · DuckDB (uploaded file analytics) |
| **Security** | JWT · Helmet · XSS-Clean · Rate Limiting · bcrypt |
| **Deployment** | Vercel (Frontend + Node.js) · Render/Railway (AI Backend) · Docker |

---

## Specialized Agents

The system uses a **LangGraph** state-machine workflow. Every incoming query first passes through the **General Router Agent**, which classifies intent and delegates to one of four specialized agents:

| Agent | Trigger | Capabilities | Tools |
|---|---|---|---|
| **🔍 Search Agent** | Real-time / market intelligence queries | Web search via Tavily API for live hardware info, benchmarks, and news | `search` |
| **🗃️ RAG Agent** | Factual lookups, pricing, availability, record searches | SQL toolkit (list tables, schema, query, query checker) + web search fallback | `sql_db_*` tools + `search` |
| **✏️ CRUD Agent** | "Add a product…", catalog insertions | Database writes via backend API + product image search via Tavily | `CRUD` + `search_image` |
| **📊 Analysis Agent** | Dashboards, charts, sales trends, business reports | SQL queries + structured JSON dashboard specification output (KPIs, multi-page charts) | `sql_db_*` tools + `run_python` |

### Model Fallback Chain

Models are configured via [`Model/config.yaml`](AI_BackEnd/Model/config.yaml) with automatic fallback:

```
Primary:  GPT-OSS 120B (Groq)
    ↓ on failure/rate-limit
Fallback 1:  Qwen 3.8 27B (Groq)
    ↓
Fallback 2:  GPT-OSS 20B (Groq)
    ↓
Fallback 3:  GPT-4o Mini (OpenAI)
```

Each model instance is wrapped in `ResilientChatGroq` / `ResilientChatOpenAI` which parse rate-limit error messages (e.g. `"Please try again in 3.23s"`) and sleep for the exact required duration + buffer before retrying, rather than failing fast.

---

## Dynamic Data Sources

A major feature of Veyra is the ability to **connect any data source at runtime** — not just the default PostgreSQL database.

### Connect an External Database
Paste a connection string (PostgreSQL, MySQL, SQLite, SQL Server) in the Data Source Modal. The system auto-discovers all tables and schemas, making them immediately queryable by any agent.

### Upload CSV / Excel Files
Upload `.csv`, `.xlsx`, or `.xls` files. They are automatically ingested into a **DuckDB** session-scoped database, with each sheet becoming a queryable SQL table. Multi-sheet Excel files create one table per sheet.

### Hot-Swap Data Sources
Switch between connected data sources per query. The active source is passed to the RAG and Analysis agents, so all SQL tool calls target the correct database.

All data source logic is managed by the singleton [`DataSourceManager`](AI_BackEnd/DB/DataSourceManager.py), which handles:
- Connection string normalization (postgres:// → postgresql+psycopg2://)
- Schema introspection and DDL extraction
- Binary image column detection and base64 data-URL serialization
- Table record fetching with configurable row limits

---

## Interactive Dashboards

When the Analysis Agent generates a dashboard, it returns a structured JSON specification that is rendered as a **fully interactive, multi-page report** in the frontend:

- **Multi-page tab navigation** — 2–4 analytical pages (e.g. Executive Overview, Product Breakdown, Operational Health)
- **KPI scorecard cards** — Key metrics with change indicators (↑/↓) and descriptions
- **Rich charts** — Area, Line, Bar, Pie, and Donut charts powered by Recharts
- **Page-level insights** — Contextual bullet points per page
- **Chart expand modal** — Click any chart to view it in a fullscreen modal
- **Chart/Table toggle** — Switch any chart to a raw data table view
- **Dashboard fullscreen mode** — Expand the entire dashboard to full viewport
- **CSV export** — Export any page's chart data as a CSV file
- **Content briefing** — Key Takeaways and Recommendations are displayed alongside the dashboard

---

## Project Structure

```
📁 Veyra/
├── 📁 AI_BackEnd/                  # Python — FastAPI + LangGraph Agents
│   ├── main.py                     # FastAPI server, /query endpoint, data source endpoints, visualization parser
│   ├── Agent/
│   │   ├── AgenticWorkFlow.py      # Agent class hierarchy (General → Search/RAG/CRUD/Analysis)
│   │   └── bi_pipeline/            # Advanced BI pipeline orchestration
│   │       └── orchestrator.py    # Coordinates multi-step BI analysis
│   ├── Prompt/                     # System prompts for each agent (domain-agnostic)
│   │   ├── generalSysPrompt.py     # Intent router prompt
│   │   ├── SearchSysPrompt.py      # Web search agent prompt
│   │   ├── RagSysPropmt.py         # Natural language SQL agent prompt
│   │   ├── dashboardSysPrompt.py   # CRUD agent prompt
│   │   ├── analysisAgent.py        # BI dashboard agent prompt (4-step analysis procedure)
│   │   └── bi_pipeline/            # Pipeline-specific prompts
│   │       ├── question_planner_prompt.py
│   │       ├── sql_engineer_prompt.py
│   │       ├── single_chart_prompt.py
│   │       └── dashboard_assembler_prompt.py
│   ├── Tools/                      # Tool implementations
│   │   ├── webSearch.py            # Tavily web search wrapper
│   │   ├── CRUD.py                 # Product CRUD + image search tools
│   │   └── runPython.py            # In-process Python execution for matplotlib visualizations
│   ├── DB/
│   │   ├── connect.py              # Default PostgreSQL connection (Supabase)
│   │   ├── DataSourceManager.py    # Dynamic data source manager (DB connections + file uploads → DuckDB)
│   │   └── agent_visualizations.py # Visualization image persistence (PostgreSQL BYTEA)
│   ├── Model/
│   │   └── config.yaml             # Multi-model fallback chain configuration
│   ├── Utils/
│   │   ├── ModelLoader.py          # Resilient model loader with rate-limit backoff (ResilientChatGroq/OpenAI)
│   │   ├── TavilySearch.py         # Tavily search utility wrapper
│   │   └── query_pipeline.py      # Logic for processing queries through the agent chain
│   ├── schemas/                    # Pydantic models for API requests/responses
│   │   ├── query_models.py
│   │   └── bi_pipeline_models.py
│   ├── Dockerfile                  # Production Docker image (Render/Railway)
│   └── requirements.txt           # Python dependencies
│
├── 📁 BackEnd/                     # Node.js — Express REST API
│   ├── app.js                      # Express server with security middleware
│   ├── controllers/
│   │   ├── auth.js                 # JWT login (bcrypt password verification)
│   │   ├── no-auth.js              # Public product catalog queries
│   │   └── req-auth.js             # Protected: product CRUD, order management, admin access
│   ├── routes/
│   │   ├── auth.js                 # POST /api/v1/auth/login
│   │   ├── no-auth-routes.js       # GET /api/v1/products, GET /api/v1/products/:id
│   │   └── req-auth-routes.js      # Protected admin routes (CRUD, orders, admin access)
│   ├── middleware/                  # JWT auth middleware, error handler
│   └── db/                         # PostgreSQL connection & schema init (pg)
│
├── 📁 FrontEnd/chatbot/            # React — Vite SPA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Agent.jsx           # Agent chat interface + management dashboard (33KB)
│   │   │   └── Login.jsx           # Business owner login page
│   │   ├── components/
│   │   │   ├── InteractiveDashboard.jsx  # Multi-page dashboard renderer (Recharts, KPIs, modals, CSV export)
│   │   │   ├── DataExplorer.jsx          # Database browser (schema, DDL, records, image lightbox, scroll slider)
│   │   │   ├── DataSourceModal.jsx       # Connect DB / upload CSV-Excel / manage active sources
│   │   │   └── MarkdownContent.jsx       # Rich markdown renderer (GFM tables, code blocks, image lightbox)
│   │   ├── config/api.js           # API URL configuration (Vite env vars with localhost fallback)
│   │   ├── App.jsx                 # React Router setup
│   │   └── context.jsx             # Global context (auth state)
│   └── index.html
│
├── 📁 supabase/
│   └── schema.sql                  # Database schema (9 tables: Customer, Product, Cart, Order, Review, etc.)
│
└── README.md
```

---

## Getting Started

### Prerequisites

- **Python** 3.11+
- **Node.js** 16+
- **PostgreSQL 14+** (or a Supabase project)
- API keys for **Groq** and/or **OpenAI**, and **Tavily**

### 1. Clone the Repository

```bash
git clone https://github.com/C1earVision/Agentic-RAG-project.git
cd Agentic-RAG-project
```

### 2. Database Setup

Run the schema file in your PostgreSQL instance or the Supabase SQL Editor:

```sql
-- See supabase/schema.sql for the full DDL
-- Creates 9 tables: Customer, CPhone, Cart, Product, Product_IMG,
-- CartItem, TheOrder, OrderItem, OrderItemProducts, Review
```

An additional `AgentVisualization` table is auto-created by the visualization persistence module.

### 3. AI Backend (FastAPI)

```bash
cd AI_BackEnd

# Create a virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Copy .env.example to .env and fill in your values
cp .env.example .env

# Start the server
uvicorn main:app --reload --port 9000
```

### 4. Backend (Node.js)

```bash
cd BackEnd

npm install

# Copy .env.example to .env and fill in your values
cp .env.example .env

npm start
```

> The backend runs on **port 3000** by default.

### 5. Frontend (React)

```bash
cd FrontEnd/chatbot

npm install
npm run dev -- --port 9001
```

> Open [http://localhost:9001](http://localhost:9001) in your browser.

---

## Environment Variables

### AI Backend (`AI_BackEnd/.env`)

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for LLM calls |
| `OPENAI_API_KEY` | *(Optional)* OpenAI API key — activates GPT-4o Mini as final fallback |
| `TAVILY_API_KEY` | Tavily API key for web search and image search |
| `API_URL` | Node.js backend base URL (e.g. `http://localhost:3000/api/v1`) |
| `AI_BACKEND_URL` | AI backend's own public URL (used for visualization image URLs in production) |
| `DATABASE_SERVER` | PostgreSQL host (Supabase: **Session pooler** host, e.g. `aws-0-xx.pooler.supabase.com`) |
| `DATABASE_PORT` | PostgreSQL port (`5432` for Supabase Session pooler) |
| `DATABASE_NAME` | PostgreSQL database name (`postgres` on Supabase) |
| `DATABASE_USER_NAME` | PostgreSQL username (`postgres.your-project-ref` on Supabase pooler) |
| `DATABASE_PASS` | PostgreSQL password |
| `DATABASE_SSL` | Set to `true` for Supabase (auto-detected if host contains `supabase`) |

> **Common Supabase mistake:** putting `postgres.xxxx` in `DATABASE_SERVER`. That value belongs in `DATABASE_USER_NAME`; the pooler hostname goes in `DATABASE_SERVER`.

### Backend (`BackEnd/.env`)

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret key for JWT token signing |
| `JWT_LIFETIME` | Token expiry (default: `30d`) |
| `PORT` | Server port (default: `3000`) |
| `DATABASE_SERVER` | PostgreSQL host (Supabase: **Session pooler** host) |
| `DATABASE_PORT` | PostgreSQL port (default: `5432`) |
| `DATABASE_NAME` | PostgreSQL database name |
| `DATABASE_USER_NAME` | PostgreSQL username |
| `DATABASE_PASS` | PostgreSQL password |
| `DATABASE_SSL` | Set to `true` for Supabase (auto-detected if host contains `supabase`) |

### Frontend (Optional `FrontEnd/chatbot/.env`)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Node.js backend URL (defaults to `http://localhost:3000/api/v1`) |
| `VITE_AI_API_URL` | AI backend URL (defaults to `http://127.0.0.1:9000`) |

---

## Model Configuration

The LLM fallback chain is configured in [`AI_BackEnd/Model/config.yaml`](AI_BackEnd/Model/config.yaml):

```yaml
llm:
  models:
    - provider: "groq"
      model_name: "openai/gpt-oss-120b"     # Primary (120B params)
    - provider: "groq"
      model_name: "qwen/qwen3.8-27b"        # Fallback 1 (27B params)
    - provider: "groq"
      model_name: "openai/gpt-oss-20b"      # Fallback 2 (20B params)
    - provider: "openai"
      model_name: "gpt-4o-mini"             # Fallback 3 (requires OPENAI_API_KEY)
```

Add, remove, or reorder models by editing this file. The `ModelLoader` automatically builds the fallback chain at startup.

---

## Usage

### Pages

| Route | Description | Access |
|---|---|---|
| `/` | Business owner login | Public |
| `/agent` | Agent chat interface, interactive dashboards, Data Explorer, and data source management | Authenticated Business Owners |

### Example Queries

| Query | Agent Used | Output |
|---|---|---|
| *"What's the latest RTX 5090 benchmark?"* | 🔍 Search Agent | Web search results with sources |
| *"Show me all GPUs under $500"* | 🗃️ RAG Agent | SQL query results in natural language |
| *"Add a new product: RTX 4060 Ti at $399"* | ✏️ CRUD Agent | Product created with auto-fetched images |
| *"Show me a chart of monthly sales trends"* | 📊 Analysis Agent | Interactive area chart with KPIs |
| *"Give me a comprehensive business dashboard"* | 📊 Analysis Agent | Multi-page interactive dashboard (3-4 pages with KPIs, charts, insights) |

---

## API Reference

### AI Backend (FastAPI — `:9000`)

#### Query Endpoint

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/query` | Send a natural language query; routes to the best agent and returns the answer |

**Request body:**
```json
{
  "question": "Show monthly sales for GPUs",
  "admin": true,
  "source_id": "db_a1b2c3d4"
}
```

**Response:**
```json
{
  "answer": "### Key Takeaways\n- Total revenue reached $154,200...",
  "agent": "use_data_analysis_and_visualization_agent",
  "source_id": "db_a1b2c3d4",
  "source_name": "Production Analytics DB",
  "image": "http://127.0.0.1:9000/visualizations/uuid",
  "dashboard": { "title": "...", "pages": [...] }
}
```

#### Data Source Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/data-sources/connect` | Connect an external database via connection string |
| `POST` | `/data-sources/upload` | Upload CSV/Excel files (multipart form data) |
| `GET` | `/data-sources/active` | List all active data sources (default DB + connected/uploaded) |
| `GET` | `/data-sources/{source_id}/schema` | Get table schemas, DDL, and sample records |
| `GET` | `/data-sources/{source_id}/tables/{table_name}` | Get table records with configurable row limit |

#### Other Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/visualizations/{id}` | Serve a generated visualization image (PNG) from PostgreSQL |

### Backend (Node.js — `:3000`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | — | Login and receive JWT |
| `GET` | `/api/v1/products` | — | List all products |
| `GET` | `/api/v1/products/:id` | — | Get single product |
| `POST` | `/api/v1/user/admin` | JWT | Add a new product |
| `DELETE` | `/api/v1/user/admin/:id` | JWT | Delete a product |
| `PATCH` | `/api/v1/user/admin/:id` | JWT | Update a product (with image upload via multer) |
| `PATCH` | `/api/v1/user/admin/modifyAccess/:id` | JWT | Modify admin access level |
| `GET` | `/api/v1/user/order` | JWT | Get all orders |
| `PATCH` | `/api/v1/user/order` | JWT | Update order status |

---

## Deployment

The project is deployed across multiple platforms:

| Service | Platform | Config |
|---|---|---|
| **Frontend** | Vercel | Auto-deploy from `FrontEnd/chatbot/` |
| **Node.js Backend** | Vercel | Serverless functions via `BackEnd/api/` adapter |
| **AI Backend** | Render / Railway | Docker container via [`AI_BackEnd/Dockerfile`](AI_BackEnd/Dockerfile) + [`render.yaml`](render.yaml) |
| **Database** | Supabase | PostgreSQL with Session Pooler (9 tables, schema in [`supabase/schema.sql`](supabase/schema.sql)) |

### Local Development

Copy the `.env.example` files to `.env` in each service folder. The frontend falls back to `localhost:3000` and `127.0.0.1:9000` when `VITE_*` vars are not set.
