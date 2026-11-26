# Graph Report - PiBAS  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 628 nodes · 1657 edges · 29 communities (19 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 80 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- requests.py
- adjudicate_access_request
- SpaceContext.tsx
- PinService
- main.py
- package.json
- schemas/__init__.py
- env.py
- compilerOptions
- WebSocketManager
- get_current_actor
- compilerOptions
- a9c15669c747_initial_pibas_schema.py
- websocket_endpoint
- .connect
- tailwind.config.js
- postcss.config.js
- space_service.py
- compilerOptions
- schemas/log.py
- asyncio
- websocket_endpoint
- .connect
- vite-env.d.ts
- postcss.config.js
- tailwind.config.js
- vite-env.d.ts

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 42 edges
2. `User` - 31 edges
3. `Base` - 26 edges
4. `PinService` - 20 edges
5. `react` - 20 edges
6. `ActivePin` - 19 edges
7. `UserSpaceAssignment` - 18 edges
8. `SuperUser` - 18 edges
9. `adjudicate_access_request()` - 18 edges
10. `EntryEventType` - 17 edges

## Surprising Connections (you probably didn't know these)
- `adjudicate_access_request()` --uses--> `AccessRequest`  [INFERRED]
  backend/app/api/v1/requests.py → backend/app/models/access_request.py
- `create_access_request()` --uses--> `AccessRequest`  [INFERRED]
  backend/app/api/v1/requests.py → backend/app/models/access_request.py
- `list_access_requests()` --uses--> `AccessRequest`  [INFERRED]
  backend/app/api/v1/requests.py → backend/app/models/access_request.py
- `SpaceService` --uses--> `AccessRequest`  [INFERRED]
  backend/app/services/space_service.py → backend/app/models/access_request.py
- `SpaceService` --uses--> `ActivePin`  [INFERRED]
  backend/app/services/space_service.py → backend/app/models/active_pin.py

## Import Cycles
- None detected.

## Communities (29 total, 10 thin omitted)

### Community 0 - "requests.py"
Cohesion: 0.05
Nodes (20): require_superuser_or_admin(), Base, utc_now(), get_db(), AccessRequest, ActivePin, Admin, UserSpaceAssignment (+12 more)

### Community 1 - "adjudicate_access_request"
Cohesion: 0.08
Nodes (60): App(), ClubSelector(), ClubSelectorProps, CopyButton(), CopyButtonProps, ConsoleLog, ESP32Simulator(), JustificationModal() (+52 more)

### Community 2 - "SpaceContext.tsx"
Cohesion: 0.06
Nodes (15): create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse, PinService (+7 more)

### Community 3 - "PinService"
Cohesion: 0.07
Nodes (15): FacilitySpaceDefinition, get_all_space_slugs(), get_registered_spaces(), get_space_by_device_id(), get_space_by_slug(), seed_initial_data(), health_check(), index_root() (+7 more)

### Community 4 - "main.py"
Cohesion: 0.07
Nodes (34): dependencies, clsx@^2.1.1, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, devDependencies, autoprefixer@^10.4.20 (+26 more)

### Community 5 - "package.json"
Cohesion: 0.11
Nodes (7): get_facility_space(), list_facility_spaces(), list_spaces_status(), SpaceBase, SpaceResponse, SpaceStatusResponse, SpaceService

### Community 6 - "schemas/__init__.py"
Cohesion: 0.12
Nodes (10): ActiveKeySummaryResponse, ClubResponse, EmailLoginRequest, PendingRequestSummary, PreResetWarningResponse, SuperUserInfoResponse, UserProfileUpdateRequest, UserRegisterRequest (+2 more)

### Community 7 - "env.py"
Cohesion: 0.11
Nodes (5): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online(), Settings

### Community 8 - "compilerOptions"
Cohesion: 0.14
Nodes (8): DirectPinCreateRequest, ESP32EventRequest, ESP32EventResponse, ESP32SyncPinItem, ESP32SyncResponse, KeypadAttemptRequest, KeypadAttemptResponse, RevokePinResponse

### Community 9 - "WebSocketManager"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 10 - "get_current_actor"
Cohesion: 0.19
Nodes (5): adjudicate_access_request(), create_access_request(), list_access_requests(), RequestStatus, AccessRequestResponse

### Community 11 - "compilerOptions"
Cohesion: 0.18
Nodes (5): delete_account(), get_current_user_profile(), get_reset_warning(), list_available_superusers(), list_clubs()

### Community 12 - "a9c15669c747_initial_pibas_schema.py"
Cohesion: 0.18
Nodes (6): login_with_email(), register_user(), TokenResponse, get_account_tag(), is_tagging_window_active(), test_account_tagging_lifecycle()

### Community 13 - "websocket_endpoint"
Cohesion: 0.19
Nodes (5): create_user_space_assignment(), list_user_space_assignments(), update_user_space_assignment(), ActivePinSummary, UserSpaceCardResponse

### Community 15 - "tailwind.config.js"
Cohesion: 0.18
Nodes (4): downgrade(), upgrade(), downgrade(), upgrade()

### Community 16 - "postcss.config.js"
Cohesion: 0.20
Nodes (3): create_access_token(), get_current_actor(), require_admin()

### Community 17 - "space_service.py"
Cohesion: 0.20
Nodes (3): export_audit_logs_csv(), list_entry_logs(), trigger_annual_purge_test()

### Community 20 - "asyncio"
Cohesion: 0.25
Nodes (3): update_profile(), Club, UserProfileResponse

### Community 21 - "websocket_endpoint"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

## Knowledge Gaps
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `requests.py` to `SpaceContext.tsx`, `package.json`, `get_current_actor`, `a9c15669c747_initial_pibas_schema.py`, `websocket_endpoint`, `.connect`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `User` (e.g. with `adjudicate_access_request()` and `create_access_request()`) actually correct?**
  _`User` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Should `requests.py` be split into smaller, more focused modules?**
  _Cohesion score 0.05421749556876238 - nodes in this community are weakly interconnected._
- **Why does `User` connect `requests.py` to `get_current_actor`, `SpaceContext.tsx`, `a9c15669c747_initial_pibas_schema.py`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `adjudicate_access_request` be split into smaller, more focused modules?**
  _Cohesion score 0.07647058823529412 - nodes in this community are weakly interconnected._
- **Why does `WebSocketManager` connect `.connect` to `requests.py`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `SpaceContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06386066763425254 - nodes in this community are weakly interconnected._