# PANDA (Pin And Network-based Door Authentication) - Workspace Instructions

## Knowledge Graph Navigation (Graphify)
- **Always Consult the Knowledge Graph First**: Before exploring files or reading code blindly across the repository, read `graphify-out/GRAPH_REPORT.md` or query `graphify-out/graph.json` (or use `graphify query "<question>"`).
- **Update the Graph at Milestones**: Run `graphify . --update` at the end of every implementation milestone so all nodes, relations, and architecture boundaries are up-to-date.

## Facility Space Registry Pattern
- Always refer to facility zones as **"Facility Space"** (never "Primary Floor" or floor descriptions in UI metadata).
- Central registry: `backend/app/config/spaces.py` (and frontend counterpart `frontend/src/config/spaces.ts`).
- Current registered spaces:
  - `sandboxx_0`: `SandBoxx 0` (Ground Floor)
  - `sandboxx_1`: `SandBoxx 1` (Upper Floor)
- All database queries, APIs, WebSocket channels, and React views must iterate dynamically over the registered spaces.
- Maintenance team adds new spaces solely through the registry configuration; no admin UI exists to create spaces.

## Monorepo Architecture & Environments
- **Backend**: FastAPI + SQLAlchemy 2.0 (asyncio + asyncpg) + Alembic + Pydantic v2. Run inside micromamba environment `panda`.
- **Frontend**: React (Vite + TypeScript + Tailwind CSS) with mobile-first responsive design for Users/SuperUsers and desktop layout for Admins.
- **Database**: PostgreSQL with asyncpg connection pooling.
- **SPA Routing**: Fallback routing configured in both Vite and FastAPI static serving to prevent 404 errors on deep linking or email login.
