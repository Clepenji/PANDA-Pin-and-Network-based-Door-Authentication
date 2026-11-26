# PANDA — Pin And Network-based Door Authentication
### IoT-Integrated Facility Access Control, Delegated Authority & Cryptographic Physical Security System

---

## 1. Executive Summary & Design Philosophy

**PANDA (Pin And Network-based Door Authentication)** is an enterprise-grade, IoT-integrated facility access control platform designed for multi-space collegiate and research maker facilities (such as SandBoxx 0 on the ground floor and SandBoxx 1 on the upper floor). The platform eliminates mechanical keys and static RF badges by replacing them with high-entropy, short-lived, cryptographically verified 6-digit numeric PINs generated dynamically through a strict, delegated SuperUser approval hierarchy.

```
       +------------------------------------------------------------------------+
       |                               PANDA Core                               |
       |  FastAPI (asyncio) + SQLAlchemy 2.0 (asyncpg) + PostgreSQL 14+ Monorepo |
       +------------------------------------------------------------------------+
                                         |
            +----------------------------+----------------------------+
            |                                                         |
     (WebSockets & HTTP)                                    (Web Push & WebSockets)
            v                                                         v
+-------------------------+                               +-------------------------+
|     ESP32 WROOM IoT     |                               |   React 18 PWA Client   |
|   Hardware Lock Node    |                               |  (Vite + Tailwind CSS   |
| (Relay + 4x4 Matrix Pad)|                               |   + D3 Cluster Graph)   |
+-------------------------+                               +-------------------------+
```

### Core Design Tenets
1. **Zero-Trust Access Life Cycle:** Access PINs possess a strictly enforced Time-To-Live (TTL) defaulting to 180 seconds (3 minutes) for testing and up to 24 hours in release configuration. Active PINs are guaranteed to have zero collisions across the entire physical facility at any instant via PostgreSQL partial unique indexing.
2. **Delegated SuperUser Adjudication Hierarchy:** Faculty and facility administrators delegate room approval authority to club leads and lab heads (**SuperUsers**). Students and entrants are formally assigned to one lead per space (`UNIQUE(user_id, space_id)`), preventing multi-lead confusion or conflicting approvals.
3. **Immutable Attribution & Zero Self-Approval:** Authorizing identities and entrant metadata are snapshotted permanently into immutable audit ledgers at event time. Subsequent account deletions, student graduations, or SuperUser revocations can never rewrite history, leave orphaned records, or turn historical entries into "self-approved" entries.
4. **Universal Visibility with Strict UI Privacy:** All SuperUsers and Admins have universal visibility into shared space logs across all rooms. Raw PIN codes and failed keypad attempts (`INVALID_PIN_ATTEMPT`) are sanitized out of UI portal feeds, while being preserved in full inside raw CSV internal security audit exports.
5. **Hardware Synchronization & Resilience:** Facility doors operate via ESP32 WROOM microcontrollers connected via bidirectional WebSocket channels with fallback polling synchronization (`GET /api/esp32/{space_id}/sync`). Immediate key revocations broadcast instantaneous `REVOKE_PIN` commands to wipe the physical microcontroller memory in sub-second latency.
6. **Modular Facility Space Registry:** Facility zones are modeled generically as **Facility Spaces**. Rooms are never hardcoded into UI schemas or database columns; instead, adding a new facility zone requires editing solely the centralized data-driven registry (`backend/app/config/spaces.py` and `frontend/src/config/spaces.ts`).

---

## 2. Complete System Architecture & Monorepo Topology

PANDA is structured as a high-performance monorepo with an asynchronous Python 3.11+ backend, a reactive TypeScript single-page application (PWA) on Vite, and an indexed Graphify architectural knowledge base.

```
PANDA/
├── alembic.ini                   # Alembic database migration environment configuration
├── CLAUDE.md                     # Claude Code agent workspace rules & Graphify instructions
├── GEMINI.md                     # Gemini CLI / Antigravity workspace instructions
├── pytest.ini                    # Pytest asynchronous test configuration
├── README.md                     # This comprehensive technical reference document
├── .env                          # Local environment variables (JWT, VAPID, DB, TTL)
├── .env.example                  # Versioned environment template
│
├── backend/                      # Asynchronous Python 3.11+ FastAPI Application
│   ├── alembic/                  # Database migration scripts
│   │   ├── env.py                # Alembic async migration runner
│   │   └── versions/             # Versioned schema migrations
│   ├── app/
│   │   ├── main.py               # FastAPI entrypoint, CORS, lifespan, SPA routing fallback
│   │   ├── api/                  # API endpoints and dependency injections
│   │   │   ├── deps.py           # Authentication dependencies (JWT, require_admin, etc.)
│   │   │   └── v1/               # Version 1 API assembly and endpoints
│   │   │       ├── __init__.py   # Router assembly
│   │   │       ├── admin.py      # Secondary admins, operational metrics, directory, cluster graph
│   │   │       ├── auth.py       # Email login, student onboarding, profile update, account deletion
│   │   │       ├── esp32.py      # IoT lock sync fallback and keypad event ingestion
│   │   │       ├── logs.py       # Excel-style logs, CSV audit ledger, annual purge test
│   │   │       ├── notifications.py # Web Push VAPID keys, push subscription, diagnostic test alerts
│   │   │       ├── pins.py       # PIN query, early revocation, direct issue, active keys
│   │   │       ├── requests.py   # Access request submission, pending queries, adjudication
│   │   │       ├── spaces.py     # Registry metadata, operational status, user space cards
│   │   │       └── ws.py         # Real-time WebSocket endpoint
│   │   ├── config/               # Configuration settings and data-driven registries
│   │   │   ├── settings.py       # Pydantic Settings v2 (.env parser)
│   │   │   └── spaces.py         # Central Facility Space Registry (SandBoxx 0, SandBoxx 1)
│   │   ├── db/                   # Database engine, connection pooling, and base model
│   │   │   ├── base.py           # SQLAlchemy declarative base with timezone-aware utc_now()
│   │   │   ├── init_db.py        # Database seeder (root admin, default clubs, initial superusers)
│   │   │   └── session.py        # asyncpg engine with connection pooling and sessionmaker
│   │   ├── models/               # SQLAlchemy 2.0 ORM Database Entities
│   │   │   ├── __init__.py       # Model exports
│   │   │   ├── access_request.py # Room entry request records with justification
│   │   │   ├── active_pin.py     # Active PINs with partial unique index on unrevoked codes
│   │   │   ├── admin.py          # Administrator accounts (Root Admin & secondary staff)
│   │   │   ├── assignment.py     # UserSpaceAssignment with UNIQUE(user_id, space_id)
│   │   │   ├── club.py           # Campus clubs / student organizations
│   │   │   ├── entry_log.py      # Immutable entry audit trail with actor/authority snapshots
│   │   │   ├── push_subscription.py # Browser Push API client cryptographic keys
│   │   │   ├── space.py          # Space model
│   │   │   ├── superuser.py      # Delegated SuperUsers with allowed_spaces JSONB
│   │   │   └── user.py           # Entrant user profiles
│   │   ├── schemas/              # Pydantic v2 validation and transfer schemas
│   │   │   ├── access_request.py # Request creation, adjudication schemas
│   │   │   ├── admin.py          # Admin metrics, directory, secondary admins, cluster graph
│   │   │   ├── auth.py           # Login, registration, profile update, cards, reset info
│   │   │   ├── log.py            # Sanitized portal logs schema
│   │   │   ├── notification.py   # Push subscription and VAPID key schemas
│   │   │   ├── pin.py            # Active PIN, direct issue, and keypad attempt schemas
│   │   │   └── space.py          # Space and status response schemas
│   │   └── services/             # Core business logic services
│   │       ├── lifecycle_service.py # Cohort tagging (New/Old) and Sept 1 purge engine
│   │       ├── log_service.py    # Immutable snapshot logger and CSV audit builder
│   │       ├── notification_service.py # pywebpush VAPID background push dispatcher
│   │       ├── pin_service.py    # Cryptographic PIN generator and keypad verifier
│   │       ├── space_service.py  # Space aggregation and live status service
│   │       └── websocket_service.py # Channel-based WebSocket ConnectionManager
│   └── tests/                    # Pytest Asynchronous Automated Test Suite
│       ├── test_admin_portal.py  # Operational metrics, secondary admins, directory, logs
│       ├── test_db_schema.py     # Schema constraints, seed data, and initial configuration
│       ├── test_esp32_and_pin_lifecycle.py # TTL, keypad verification, ESP32 event ingestion
│       ├── test_exhaustive_suite.py # End-to-end integration and lifecycle verification
│       ├── test_lifecycle_and_constraints.py # UNIQUE constraints, tagging, September 1st purge
│       └── test_spaces.py        # Modular space registry validation
│
├── frontend/                     # Progressive Web App (PWA) Frontend Client
│   ├── public/                   # Static PWA assets served at root
│   │   ├── icons/                # High-contrast SVG app icons (192x192, 512x512, badge)
│   │   ├── manifest.json         # Web App Manifest for mobile installation
│   │   └── sw.js                 # Custom Service Worker handling background push & navigation
│   ├── src/
│   │   ├── main.tsx              # Application bootstrap and Service Worker registration
│   │   ├── App.tsx               # Root component with role switcher toolbar
│   │   ├── index.css             # Tailwind CSS directives and custom styling
│   │   ├── config/
│   │   │   └── spaces.ts         # Frontend Facility Space Registry (SandBoxx 0, SandBoxx 1)
│   │   ├── context/
│   │   │   ├── AuthContext.tsx   # Authentication provider and profile management
│   │   │   └── SpaceContext.tsx  # Space provider, telemetry caching, and WebSocket listener
│   │   ├── components/           # Reusable UI components
│   │   │   ├── AddAdminModal.tsx # Confirmation modal with security warning for staff
│   │   │   ├── AddSuperUserModal.tsx # SuperUser registration modal with space authority
│   │   │   ├── ClubSelector.tsx  # Club dropdown with inline "+ New Club" creation
│   │   │   ├── CopyButton.tsx    # One-click copy button with visual feedback for phone numbers
│   │   │   ├── ESP32Simulator.tsx# Virtual on-screen keypad emulator for developer testing
│   │   │   ├── ExcelSpaceLogs.tsx# Excel-style log table with right-side inline expansion
│   │   │   ├── InteractiveClusterGraph.tsx # D3 force-directed affiliation cluster graph
│   │   │   ├── JustificationModal.tsx # Mandatory access justification popup with char counter
│   │   │   ├── Navbar.tsx        # Responsive navigation bar with space indicator & logout
│   │   │   ├── PhoneInput.tsx    # Phone number input with international prefix & 10-digit check
│   │   │   ├── ResetWarningBanner.tsx # Annual pre-reset warning banner (August 25-31)
│   │   │   ├── SettingsDrawer.tsx# Entrant hamburger drawer for profile edit & account deletion
│   │   │   └── UserDirectory.tsx # Sortable directory of all facility members (Admins excluded)
│   │   ├── pages/
│   │   │   ├── AdminDashboard.tsx# Desktop-optimized administrative portal
│   │   │   ├── LoginPage.tsx     # Email login screen with automatic onboarding transition
│   │   │   ├── SuperUserDashboard.tsx # Delegated lead portal (Requests, My Access, Active Keys, Logs)
│   │   │   └── UserDashboard.tsx # Mobile-first entrant dashboard with floating space cards
│   │   ├── services/
│   │   │   ├── api.ts            # Fetch API client interacting with FastAPI backend
│   │   │   ├── pushNotification.ts # Browser Push API & Service Worker subscription manager
│   │   │   └── websocket.ts      # Reconnecting WebSocket client for real-time telemetry
│   │   └── types/
│   │       └── index.ts          # Comprehensive TypeScript interface definitions
│   ├── index.html                # HTML entrypoint with PWA links and viewport meta
│   ├── package.json              # Dependencies (React 18, D3, Lucide, Tailwind)
│   ├── tailwind.config.js        # Modern dark-slate palette configuration
│   └── vite.config.ts            # Vite bundler configuration with 0.0.0.0 host binding
│
└── graphify-out/                 # Graphify Knowledge Graph
    ├── graph.json                # Complete AST dependency graph (722 nodes, 1942 edges)
    ├── graph.html                # Interactive HTML visualization of codebase topology
    └── GRAPH_REPORT.md           # Community structure and architectural report
```

---

## 3. Detailed Data Flow Architecture

### 3.1 Room Access Request & Dynamic PIN Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student Entrant
    participant React as React PWA Client
    participant API as FastAPI Backend
    participant DB as PostgreSQL
    participant FCM as Web Push Service (FCM/Mozilla)
    actor SuperUser as SuperUser Lead Phone
    participant ESP as ESP32 WROOM (Physical Door)

    Student->>React: Clicks Masked PIN Box [• • • • • •]
    React->>Student: Prompts Mandatory Justification Modal
    Student->>React: Submits Justification ("Soldering PCB")
    React->>API: POST /api/v1/requests (space_slug, justification)
    API->>DB: INSERT INTO access_requests (status=PENDING)
    API->>React: WebSocket broadcast: ACCESS_REQUEST_SUBMITTED
    API-->>FCM: VAPID Web Push Payload (Background Notification)
    FCM-->>SuperUser: System Push Alert on Mobile Phone
    SuperUser->>React: Opens SuperUser Dashboard -> Pending Requests
    SuperUser->>React: Clicks Instant Approve [✓]
    React->>API: POST /api/v1/requests/{id}/decision (status=APPROVED)
    API->>DB: Generate random 6-digit PIN (zero collision verified)
    API->>DB: INSERT INTO active_pins (expires_at = NOW() + TTL)
    API->>DB: INSERT INTO entry_logs (event_type=ACCESS_GRANTED)
    API->>ESP: WebSocket: {action: "ADD_PIN", space_id: "...", pin: "123456"}
    API->>React: WebSocket: ACCESS_REQUEST_ADJUDICATED
    React->>Student: Card Unmasks: "123456" (Valid till 6:45 PM)
    Student->>ESP: Enters "123456#" on Physical 4x4 Keypad
    ESP->>ESP: Memory match -> Energizes 12V Solenoid Relay (Door Opens)
    ESP->>API: POST /api/esp32/events (door_unlocked=true, pin=123456)
    API->>DB: INSERT INTO entry_logs (event_type=DOOR_UNLOCKED)
```

---

## 4. Ubuntu 22.04 & Local Environment Setup Guide

### 4.1 System Prerequisites
PANDA is optimized for **Ubuntu 22.04 LTS**. Ensure system packages and developer dependencies are installed:
```bash
sudo apt update && sudo apt install -y curl wget git build-essential postgresql postgresql-contrib libpq-dev
```

### 4.2 Python Environment Setup with Micromamba
We recommend **micromamba** for isolated, lightweight environment management:
```bash
# Install micromamba if not present
"${SHELL}" <(curl -L micro.mamba.pm/install.sh)
source ~/.bashrc

# Create and activate the panda environment
micromamba create -n panda python=3.11 -c conda-forge -y
micromamba activate panda

# Install backend dependencies
pip install fastapi uvicorn[standard] sqlalchemy asyncpg psycopg2-binary alembic pydantic pydantic-settings python-jose[cryptography] passlib[bcrypt] pywebpush pytest pytest-asyncio anyio httpx
```

### 4.3 PostgreSQL Database Provisioning
Start and configure PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create default development database
sudo -u postgres psql -c "CREATE DATABASE panda;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
```

### 4.4 Environment Configuration (`.env`)
Create `.env` at the repository root:
```ini
ENVIRONMENT=development
DEBUG=True

# Database Configuration (PostgreSQL with asyncpg connection pooling)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/panda
SYNC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/panda

# Security & JWT Tokens
SECRET_KEY=panda-jwt-secure-secret-key-change-in-production-random-token-2026
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200

# Access PIN Configuration (180s for testing, up to 86400s for 24h production)
PIN_TTL_SECONDS=180
PIN_TTL_MINUTES=3

# Root Administrator
ROOT_ADMIN_EMAIL=rehankuriance@gmail.com

# Web Push Notification (VAPID) Settings
VAPID_PUBLIC_KEY=BGYYyGhat5PNu2w7q_w4uhC1kdsSYOTCd8vrYSXgdxrKIoetQmhpbqxRZl_SRUxeJNubyWZXrU5F1mCkCtjLBmo
VAPID_PRIVATE_KEY=z3iINySUY5XeTyVsO19yv6CjFQbOo-J1FUt4LqDVscE
VAPID_CLAIM_EMAIL=mailto:rehankuriance@gmail.com

# Server Binding
HOST=0.0.0.0
PORT=8000
FRONTEND_URL=http://localhost:5173
```

### 4.5 Database Migrations & Initial Data Seeding
Run Alembic migrations to construct the database schema and initialize seed records:
```bash
# Execute migrations
micromamba run -n panda alembic upgrade head

# Seed Master Root Admin (rehankuriance@gmail.com), spaces, and clubs
micromamba run -n panda python -c "
import asyncio
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.init_db import seed_initial_data
async def run():
    async with AsyncSessionLocal() as s:
        await seed_initial_data(s)
asyncio.run(run())
"

# Quick Clean Database Reset (Wipes all test data and restores clean baseline)
micromamba run -n panda python backend/scripts/reset_db.py
```

### 4.6 Frontend Installation & LAN IP Mobile Binding
Install Node dependencies:
```bash
cd frontend
npm install
```

#### How to Test on a Physical Mobile Phone Over Local Wi-Fi
Both Vite and FastAPI are pre-configured to bind to `0.0.0.0` (all network interfaces).
1. Locate your Ubuntu development machine's local IP address:
   ```bash
   hostname -I | awk '{print $1}'
   # Example: 192.168.1.45
   ```
2. Start the FastAPI backend server bound to `0.0.0.0`:
   ```bash
   cd /home/clepenji/PANDA
   micromamba run -n panda uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
   ```
3. Start the Vite development server:
   ```bash
   cd /home/clepenji/PANDA/frontend
   npm run dev -- --host 0.0.0.0
   ```
4. On your mobile phone connected to the **same Wi-Fi network**, open Chrome or Safari and navigate to:
   ```
   http://192.168.1.45:5173
   ```
5. In Chrome on Android, tap `⋮` $\rightarrow$ **"Add to Home screen"** or **"Install App"**. On iOS Safari, tap `Share` $\rightarrow$ **"Add to Home Screen"**. The application will install as a standalone PWA with its native icon.

---

## 5. Exhaustive Backend Function & Module Reference

Every backend module, service, function, dependency, and scheduled task is documented below with its exact parameters, return types, and architectural responsibilities.

### 5.1 `backend/app/config/settings.py`
- **Class `Settings(BaseSettings)`**: Pydantic Settings v2 container parsing `.env`.
  - Attributes: `ENVIRONMENT` (str), `DEBUG` (bool), `DATABASE_URL` (str), `SYNC_DATABASE_URL` (str), `SECRET_KEY` (str), `ALGORITHM` (str), `ACCESS_TOKEN_EXPIRE_MINUTES` (int), `PIN_TTL_SECONDS` (int), `PIN_TTL_MINUTES` (int), `ROOT_ADMIN_EMAIL` (str), `VAPID_PUBLIC_KEY` (str), `VAPID_PRIVATE_KEY` (str), `VAPID_CLAIM_EMAIL` (str), `HOST` (str), `PORT` (int), `FRONTEND_URL` (str).
- **`settings`**: Singleton instantiation of `Settings`.

### 5.2 `backend/app/config/spaces.py`
- **Class `FacilitySpace(BaseModel)`**: Data-driven schema defining an authorized physical zone. Fields: `id` (str), `slug` (str), `name` (str), `esp32_device_id` (str), `is_active` (bool).
- **`get_registered_spaces() -> List[FacilitySpace]`**: Returns all facility spaces defined in the central registry (currently `sandboxx_0` and `sandboxx_1`).
- **`get_space_by_slug(slug: str) -> Optional[FacilitySpace]`**: Look up a space definition by its slug.
- **`get_space_by_device_id(device_id: str) -> Optional[FacilitySpace]`**: Look up a space definition by its physical ESP32 device identifier (e.g., `ESP32-SANDBOXX-0`).

### 5.3 `backend/app/db/base.py` & `backend/app/db/session.py`
- **`utc_now() -> datetime`**: Returns the current timezone-aware timestamp in UTC (`datetime.now(timezone.utc)`). Used across all models as default timestamp.
- **`Base`**: Declarative base class inheriting from SQLAlchemy `DeclarativeBase`.
- **`engine`**: SQLAlchemy `AsyncEngine` configured with `asyncpg`, pre-ping health checks (`pool_pre_ping=True`), `pool_size=10`, `max_overflow=20`, and connection recycling (`pool_recycle=1800`).
- **`AsyncSessionLocal`**: `async_sessionmaker` factory bound to `engine` with `expire_on_commit=False`.
- **`get_db() -> AsyncGenerator[AsyncSession, None]`**: FastAPI dependency yielding an isolated async database session with automatic exception rollback and graceful session closure.

### 5.4 `backend/app/api/deps.py`
- **`create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str`**: Encodes a signed JWT bearer token containing actor email, role, full name, root status, and governed spaces.
- **`get_current_actor(token: str = Depends(oauth2_scheme)) -> Dict[str, Any]`**: Decodes and verifies the cryptographic signature of the bearer token, extracting actor claims. Raises `401 Unauthorized` on expired or tampered credentials.
- **`require_admin(actor: Dict[str, Any] = Depends(get_current_actor)) -> Dict[str, Any]`**: Dependency verifying the caller holds role `admin`. Raises `403 Forbidden` otherwise.
- **`require_superuser_or_admin(actor: Dict[str, Any] = Depends(get_current_actor)) -> Dict[str, Any]`**: Dependency verifying the caller holds either role `admin` or role `superuser`.

### 5.5 `backend/app/services/pin_service.py`
- **`PinService.generate_secure_pin(session: AsyncSession) -> str`**: Generates a cryptographically random 6-digit numeric string (`000000`–`999999`) using `secrets.choice`. Verifies against `active_pins` where `revoked_at IS NULL` to ensure zero collisions facility-wide.
- **`PinService.issue_pin_for_grant(session, space_id, holder_user_id, issued_by_superuser_id, issued_by_name, issued_by_email, custom_ttl_seconds=None) -> ActivePin`**: Generates a collision-free PIN, computes `expires_at = NOW() + TTL`, persists an `ActivePin` entity, writes an immutable `ACCESS_GRANTED` entry log, and broadcasts `{ "action": "ADD_PIN", "pin": "...", "space_id": "..." }` to the space's ESP32 WebSocket channel.
- **`PinService.revoke_pin(session, pin_id, actor) -> ActivePin`**: Early revocation engine. Validates authority (Admins can revoke any space; SuperUsers check `allowed_spaces`). Marks `revoked_at = NOW()` and broadcasts `{ "action": "REVOKE_PIN", "pin": "...", "space_id": "..." }` to the ESP32 channel for instantaneous lock memory invalidation.
- **`PinService.direct_issue_pin(session, space_id, entrant_email, actor, justification) -> ActivePin`**: Allows a SuperUser or Admin to generate an immediate PIN for an entrant under their jurisdiction without a prior request.
- **`PinService.verify_keypad_attempt(session, device_id, pin_code) -> Dict[str, Any]`**: Hardware keypad verification endpoint. Maps `device_id` to `space_id`, checks unrevoked non-expired matching records in `active_pins`. Writes `DOOR_UNLOCKED` on success; writes `INVALID_PIN_ATTEMPT` on failure.
- **`PinService.get_active_pin_for_user(session, user_id, space_id) -> Optional[ActivePin]`**: Retrieves the currently valid, unrevoked active PIN held by a user for a designated space.
- **`PinService.sync_esp32_pins(session, space_id) -> List[Dict[str, Any]]`**: Fallback synchronization querying all active unexpired pins for a space so offline ESP32 units can repopulate local RAM on reboot.

### 5.6 `backend/app/services/log_service.py`
- **`LogService.create_entry_log(session, event_type, space_id, actor_name, actor_email, authority_name, authority_email, pin_used=None, justification_snapshot=None) -> EntryLog`**: Inserts an immutable audit record preserving permanent actor and authority snapshots. Broadcasts `ENTRY_LOG_{event_type}` over WebSockets.
- **`LogService.export_entry_logs_csv(session) -> str`**: Generates a complete CSV text document of all historical entry logs—including `INVALID_PIN_ATTEMPT` entries and raw `pin_used` mappings—for internal security auditing.

### 5.7 `backend/app/services/lifecycle_service.py`
- **`get_account_tag(created_at: datetime, reference_date: Optional[datetime] = None) -> Optional[str]`**: Evaluates whether the current date falls between **July 15 and September 1**. If active: accounts created $\ge$ July 15 return `"New"`; accounts created $<$ July 15 return `"Old"`. Outside this window, returns `None`.
- **`get_pre_reset_warning(reference_date: Optional[datetime] = None) -> Tuple[bool, Optional[str]]`**: Evaluates whether the current date falls between **August 25 and August 31**. Returns `(True, warning_text)` during this window, else `(False, None)`.
- **`execute_annual_september_purge(session, reference_date=None) -> Dict[str, int]`**: Executes the annual September 1st facility purge:
  1. Deletes all records in `active_pins`, `access_requests`, and `user_space_assignments`.
  2. Deletes all records in `users`.
  3. Deletes `superusers` whose `created_at < July 15` of the current year (preserves SuperUsers created $\ge$ July 15).
  4. Preserves all `admins` (Root Admin and secondary staff).
  5. Deletes `entry_logs` older than 3 years (`created_at < NOW() - 3 years`).
  Returns dictionary of purged row counts.

### 5.8 `backend/app/services/websocket_service.py`
- **Class `ConnectionManager`**:
  - `connect(websocket, channel="global")`: Accepts WebSocket handshake and registers socket under a named topic channel.
  - `disconnect(websocket, channel="global")`: Removes connection and cleans empty channels.
  - `broadcast(channel, message)`: Asynchronously broadcasts JSON payloads to all clients in a specific channel.
  - `broadcast_space_event(space_slug, event_type, data)`: Helper broadcasting structured telemetry to both space-specific channel and the global administrative channel.
- **`ws_manager`**: Singleton instance of `ConnectionManager`.

### 5.9 `backend/app/services/notification_service.py`
- **`NotificationService.register_subscription(session, user_email, payload) -> PushSubscription`**: Registers or updates browser Push API subscription keys (`p256dh`, `auth`, `endpoint`) in the PostgreSQL `push_subscriptions` table.
- **`NotificationService._dispatch_single_push(subscription_record, title, body, url="/", tag="panda-notification") -> bool`**: Executes synchronous `pywebpush.webpush` dispatch using VAPID keys with a 2-second timeout and exception catching.
- **`NotificationService.notify_superusers_new_request(session, space_id, requester_name, justification, target_su_id=None) -> int`**: Queries push subscriptions for the assigned SuperUser (or all active SuperUsers governing that space) and dispatches background Web Push notifications.
- **`NotificationService.send_test_alert(session, user_email) -> int`**: Dispatches a diagnostic test notification to all devices registered under the caller's email.

### 5.10 API Route Handlers

#### `backend/app/api/v1/auth.py`
- **`POST /api/v1/auth/login` (`login_with_email`)**: Authenticates via institutional email. Returns JWT token with role `admin`, `superuser`, or `user`. Revoked SuperUsers (`is_active=False`) raise `403 REVOKED_SUPERUSER_NEEDS_REGISTRATION`. Unknown emails raise `404 ACCOUNT_NOT_FOUND`.
- **`GET /api/v1/auth/me` (`get_current_user_profile`)**: Retrieves profile details for the authenticated actor.
- **`POST /api/v1/auth/register` (`register_user`)**: Onboards new users or re-registers revoked SuperUsers. Assigns Name, Phone, Club, ONE initial space, and assigned SuperUser.
- **`PUT /api/v1/auth/profile` (`update_user_profile`)**: Entrant profile editing for Name, Phone, and Club.
- **`DELETE /api/v1/auth/account` (`delete_account`)**: Self-service deletion cascading user assignments and requests.
- **`GET /api/v1/auth/superusers` (`list_available_superusers`)**: Returns active SuperUsers for registration dropdowns (`SuperUser Name — Club Name`).
- **`GET /api/v1/auth/clubs` (`list_campus_clubs`)**: Returns registered campus clubs.
- **`GET /api/v1/auth/warning` (`get_lifecycle_warning_status`)**: Returns August 25–31 lifecycle warning flag.

#### `backend/app/api/v1/admin.py`
- **`GET /api/v1/admin/metrics` (`get_admin_metrics`)**: Operational metrics strip: Total Registered Users, Weekly entries per space, Average requests per day. Strictly zero active PINs or pending requests cards.
- **`GET /api/v1/admin/admins` (`list_secondary_admins`)**: Returns secondary admin accounts. Root Admin (`rehankuriance@gmail.com`) is strictly hidden.
- **`POST /api/v1/admin/admins` (`create_secondary_admin`)**: Creates secondary staff administrator.
- **`DELETE /api/v1/admin/admins/{admin_id}` (`delete_secondary_admin`)**: Deletes secondary administrator. Root Admin cannot be deleted (`403 Forbidden`).
- **`GET /api/v1/admin/superusers` (`list_admin_superusers`)**: Lists all SuperUsers (active and revoked).
- **`POST /api/v1/admin/superusers` (`create_superuser`)**: Creates SuperUser with club and space authority.
- **`PUT /api/v1/admin/superusers/{su_id}` (`update_superuser`)**: Updates space authority or active status.
- **`POST /api/v1/admin/superusers/{su_id}/revoke` (`revoke_superuser`)**: Immediately revokes SuperUser (`is_active=False`).
- **`GET /api/v1/admin/directory` (`get_user_directory`)**: Sortable directory of all Users and SuperUsers (Admins excluded).
- **`GET /api/v1/admin/cluster-graph` (`get_cluster_graph_data`)**: Graph payload for D3 force-directed simulation (Admins excluded).

#### `backend/app/api/v1/requests.py`
- **`POST /api/v1/requests` (`create_access_request`)**: Submits room entry justification (max 256 chars, non-empty). Dispatches WebSocket event and background Web Push notification to assigned SuperUsers.
- **`GET /api/v1/requests` (`list_access_requests`)**: Lists requests filtered by space and status. Entrants only see their own requests; SuperUsers/Admins view supervised requests.
- **`POST /api/v1/requests/{request_id}/decision` (`adjudicate_access_request`)**: Approves or rejects request. On approval, generates PIN, updates ESP32, and writes entry log.

#### `backend/app/api/v1/pins.py`
- **`GET /api/v1/pins/active` (`get_active_pin`)**: Returns active unmasked PIN token for the caller.
- **`POST /api/v1/pins/verify-keypad` (`verify_keypad`)**: Simulates or receives physical 4x4 keypad code entry.
- **`POST /api/v1/pins/{pin_id}/revoke` (`revoke_active_pin`)**: Early key revocation.
- **`POST /api/v1/pins/direct` (`direct_issue_pin`)**: Direct key issuance by SuperUsers or Admins.
- **`GET /api/v1/pins/active-keys` (`list_active_keys_summary`)**: Lists active key holders with `Valid till` timestamps across all spaces (raw PIN numbers strictly sanitized).

#### `backend/app/api/v1/logs.py`
- **`GET /api/v1/logs/portal` (`list_entry_logs`)**: Universal visibility log table. Strictly excludes `INVALID_PIN_ATTEMPT` and raw PINs. Defaults to last 7 days, allowing queries up to 3 years.
- **`GET /api/v1/logs/audit/csv` (`export_audit_logs_csv`)**: Downloads complete raw audit CSV including `INVALID_PIN_ATTEMPT` and raw PIN mappings.
- **`POST /api/v1/logs/annual-purge-test` (`trigger_annual_purge_test`)**: Invokes September 1st purge logic on demand (Admin only).

#### `backend/app/api/v1/notifications.py`
- **`GET /api/v1/notifications/vapid-public-key` (`get_vapid_public_key`)**: Returns VAPID public key.
- **`POST /api/v1/notifications/subscribe` (`subscribe_for_push`)**: Stores browser push subscription.
- **`POST /api/v1/notifications/test-alert` (`send_diagnostic_test_alert`)**: Dispatches diagnostic push alert.

#### `backend/app/api/v1/esp32.py`
- **`GET /api/esp32/{space_id}/sync` (`esp32_sync_pins`)**: Polling fallback endpoint for ESP32 units to synchronize active PIN memory.
- **`POST /api/esp32/events` (`esp32_event_ingest`)**: Ingests physical door unlock or failed keypad attempt events.

---

## 6. Step-by-Step Maintenance & Feature Modification Guide

### 6.1 Tracing Data Flows During Debugging

When an unexpected event occurs, follow this deterministic tracing sequence:

```
[Student Request]
       |
       v
1. Inspect FastAPI console logs -> Look for POST /api/v1/requests
2. Query database: SELECT * FROM access_requests WHERE status='PENDING';
       |
       v
[SuperUser Notification]
3. Inspect WebPush log -> NotificationService._dispatch_single_push
4. Query subscriptions: SELECT * FROM push_subscriptions WHERE user_email='<lead_email>';
       |
       v
[Approval & PIN Issuance]
5. SuperUser clicks [✓] -> POST /api/v1/requests/{id}/decision
6. Check database: SELECT * FROM active_pins WHERE revoked_at IS NULL;
7. Verify WebSocket broadcast on channel: esp32:<space_slug>
       |
       v
[Physical Keypad Unlock]
8. ESP32 receives {action: "ADD_PIN", pin: "123456"}
9. User types 123456# -> POST /api/esp32/events
10. Query audit ledger: SELECT * FROM entry_logs ORDER BY created_at DESC LIMIT 5;
```

---

### 6.2 How to Safely Add a New Facility Space (e.g. `SandBoxx 2`)

PANDA employs the **Modular Facility Space Registry Pattern**. Adding a third room (e.g., `SandBoxx 2` for an electronics lab) requires **zero database schema migrations**, zero SQL table alterations, and zero admin UI changes.

#### Step 1: Update the Backend Registry
Open `backend/app/config/spaces.py` and append `sandboxx_2` to `_FACILITY_SPACES`:
```python
_FACILITY_SPACES: List[FacilitySpace] = [
    FacilitySpace(
        id="space_sandboxx_0",
        slug="sandboxx_0",
        name="SandBoxx 0",
        esp32_device_id="ESP32-SANDBOXX-0",
        is_active=True,
    ),
    FacilitySpace(
        id="space_sandboxx_1",
        slug="sandboxx_1",
        name="SandBoxx 1",
        esp32_device_id="ESP32-SANDBOXX-1",
        is_active=True,
    ),
    # NEW FACILITY SPACE:
    FacilitySpace(
        id="space_sandboxx_2",
        slug="sandboxx_2",
        name="SandBoxx 2",
        esp32_device_id="ESP32-SANDBOXX-2",
        is_active=True,
    ),
]
```

#### Step 2: Update the Frontend Registry Counterpart
Open `frontend/src/config/spaces.ts` and add the matching space object:
```typescript
export const FACILITY_SPACES: FacilitySpaceConfig[] = [
  {
    slug: 'sandboxx_0',
    name: 'SandBoxx 0',
    esp32_deviceId: 'ESP32-SANDBOXX-0',
    is_active: true,
  },
  {
    slug: 'sandboxx_1',
    name: 'SandBoxx 1',
    esp32_deviceId: 'ESP32-SANDBOXX-1',
    is_active: true,
  },
  // NEW FACILITY SPACE:
  {
    slug: 'sandboxx_2',
    name: 'SandBoxx 2',
    esp32_deviceId: 'ESP32-SANDBOXX-2',
    is_active: true,
  },
];
```

#### Step 3: Verification
Restart the backend and rebuild the frontend:
1. `GET /health` and `GET /api/v1/spaces` will immediately list `["sandboxx_0", "sandboxx_1", "sandboxx_2"]`.
2. All entrant dashboards will automatically render a third floating space card for SandBoxx 2.
3. SuperUser registration authority checkboxes will automatically present SandBoxx 2.
4. ESP32 WebSocket channels (`esp32:sandboxx_2`) and polling endpoints (`/api/esp32/sandboxx_2/sync`) activate immediately.

---

### 6.3 Modifying PIN TTL Policy (Testing vs. Production)
To change PIN validity from 3 minutes (180s) to 24 hours (86,400s) for production deployment:
1. Edit `.env`:
   ```ini
   PIN_TTL_SECONDS=86400
   PIN_TTL_MINUTES=1440
   ```
2. Restart the FastAPI server. All future PIN grants will automatically set `expires_at = NOW() + 86400 seconds`.

---

## 7. Automated Testing Suite Guide

PANDA includes an exhaustive asynchronous test suite covering all constraint rules, PIN lifecycles, and role boundaries:

```bash
# Run the complete test suite
micromamba run -n panda pytest backend/tests -v
```

### Test Coverage Summary (100% Pass Rate Across 27 Tests)
- `backend/tests/test_admin_portal.py`:
  - `test_admin_metrics`: Validates that operational metrics return registered user counts, weekly entries per space, and average requests per day with zero active PIN or pending request summary cards.
  - `test_secondary_admin_lifecycle_and_root_protection`: Validates secondary admin creation, deletion, and verifies `rehankuriance@gmail.com` is protected and hidden.
  - `test_superuser_admin_management_and_revocation`: Validates SuperUser creation, space authority modification, and revocation redirecting to `403`.
  - `test_directory_and_cluster_graph_exclude_admins`: Validates that directory and D3 cluster graph responses strictly isolate and exclude administrator accounts.
  - `test_shared_logs_universal_visibility_and_csv_export`: Validates universal log visibility and CSV internal audit export for both Admins and SuperUsers.
- `backend/tests/test_exhaustive_suite.py`:
  - `test_email_login_routing_and_revoked_superuser`: Comprehensive verification of passwordless login routing.
  - `test_unique_user_space_assignment_and_inline_switching`: Enforces `UNIQUE(user_id, space_id)` and validates inline SuperUser switching without duplicate cards.
  - `test_concurrent_pin_generation_uniqueness_and_revocation`: Generates concurrent PINs across isolated database sessions, verifying zero collisions and early revocation.
  - `test_immutable_audit_log_attribution_on_superuser_deletion`: Deletes an authorizing SuperUser and verifies that historical entry logs retain permanent immutable snapshots.
  - `test_annual_september_purge_rules`: Verifies July 14 vs. July 15 cohort cutoffs, Admin preservation, and 3-year log retention.
  - `test_web_push_vapid_and_subscription_flow`: Verifies VAPID public key retrieval, subscription persistence, and test alert dispatch.
- `backend/tests/test_esp32_and_pin_lifecycle.py`:
  - Validates TTL duration, keypad verification, and ESP32 polling fallback.
- `backend/tests/test_lifecycle_and_constraints.py`:
  - Validates account cohort tagging and pre-reset warning banners.
- `backend/tests/test_spaces.py`:
  - Validates data-driven registry lookup integrity.

---

## 8. Architectural Knowledge Graph Navigation (Graphify)

PANDA integrates directly with **Graphify** to index code relationships, call trees, and communities:
- **Query the Codebase Graph:**
  ```bash
  micromamba run -n panda graphify query "How does PIN revocation broadcast to ESP32?"
  ```
- **Inspect Graph Metrics:**
  Open `graphify-out/GRAPH_REPORT.md` or launch the interactive visualization `graphify-out/graph.html` in your browser.
- **Update Graphify at Implementation Milestones:**
  ```bash
  micromamba run -n panda graphify . --code-only --update
  micromamba run -n panda graphify cluster-only /home/clepenji/PANDA
  ```
