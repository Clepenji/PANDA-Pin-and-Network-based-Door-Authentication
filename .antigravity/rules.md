# PANDA (Pin And Network-based Door Authentication) Project Rules & Architecture Guidelines

## Knowledge Graph & Context Management (Graphify)
- **Mandatory Knowledge Graph Querying**: Before exploring source files or tracing dependencies across the codebase, consult `graphify-out/GRAPH_REPORT.md` or query `graphify-out/graph.json` rather than reading raw source files blindly.
- **Index Maintenance**: Run `graphify . --update` at the completion of every implementation milestone and whenever new models, endpoints, or architectural components are introduced.
- **Node Linking**: When referencing modules, database models, or services in design documentation, use exact naming that aligns with Graphify node identities.

## Monorepo Architecture
- **Backend**: `/backend` - FastAPI, SQLAlchemy 2.0 (asyncio + asyncpg), Alembic, Pydantic v2, WebSockets.
- **Frontend**: `/frontend` - React 18+, Vite, TypeScript, Tailwind CSS, Lucide icons, mobile-responsive layout.
- **Database**: PostgreSQL with connection pooling via asyncpg.

## Facility Space Registry Pattern
- Always use the generic terminology **"Facility Space"** (never "Primary Floor", and do not hardcode floor metadata).
- Central registry is defined in `backend/app/config/spaces.py` and shared with the frontend.
- Current initial registered spaces:
  1. `sandboxx_0`: Display Name `SandBoxx 0` (Ground Floor)
  2. `sandboxx_1`: Display Name `SandBoxx 1` (Upper Floor)
- All database queries, APIs, WebSocket channels, and UI views must iterate dynamically over the space registry without hardcoded assumptions.
- No UI option shall exist to create spaces dynamically via Admin dashboard; future spaces will only be added by the maintenance team in the space registry module.

## Routing & Resilience
- SPA fallback routing must be configured in both Vite dev server and FastAPI static file serving so deep links, direct refreshes, and email login submissions never return 404 errors.
