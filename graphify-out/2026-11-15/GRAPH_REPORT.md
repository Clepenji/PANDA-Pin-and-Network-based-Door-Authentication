# Graph Report - PiBAS  (2026-11-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 973 nodes · 2764 edges · 42 communities (32 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 99 edges (avg confidence: 0.94)
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
- postcss.config.js
- tailwind.config.js
- tailwind.config.js
- do_run_migrations
- sync_esp32_pins
- send_diagnostic_test_alert
- notification_service.py
- PreResetWarningResponse
- websocket_endpoint
- tailwind.config.js
- schemas/space.py

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 61 edges
2. `User` - 45 edges
3. `SuperUser` - 37 edges
4. `react` - 37 edges
5. `lucide-react` - 33 edges
6. `Base` - 32 edges
7. `PinService` - 27 edges
8. `api` - 24 edges
9. `EntryEventType` - 23 edges
10. `ESP32Service` - 22 edges

## Surprising Connections (you probably didn't know these)
- `sync_esp32_pins()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/esp32.py → backend/app/services/pin_service.py
- `list_active_pins_for_management()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `revoke_active_pin()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `verify_keypad_entry()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `PinService` --uses--> `EntryEventType`  [INFERRED]
  backend/app/services/pin_service.py → backend/app/models/entry_log.py

## Import Cycles
- None detected.

## Communities (42 total, 10 thin omitted)

### Community 0 - "requests.py"
Cohesion: 0.05
Nodes (18): create_direct_pin(), PinService, test_facility_spaces_seeded(), test_pin_generation_uniqueness(), test_root_admin_seeded(), test_esp32_keypad_event_logging(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow() (+10 more)

### Community 1 - "adjudicate_access_request"
Cohesion: 0.06
Nodes (24): create_secondary_admin(), create_superuser(), delete_secondary_admin(), get_admin_metrics(), get_cluster_graph_data(), get_user_directory(), list_admin_esp32_devices(), list_admin_superusers() (+16 more)

### Community 2 - "SpaceContext.tsx"
Cohesion: 0.08
Nodes (16): ActivePin, UserSpaceAssignment, EntryLog, SuperUser, User, execute_annual_september_purge(), test_user_space_assignment_unique_constraint(), test_inbound_hardware_events_ingestion() (+8 more)

### Community 3 - "PinService"
Cohesion: 0.10
Nodes (7): require_admin(), require_superuser_or_admin(), list_entry_logs(), get_db(), EntryEventType, ESP32FirmwareRelease, LogService

### Community 4 - "main.py"
Cohesion: 0.06
Nodes (6): esp32_hardware_websocket(), websocket_endpoint(), ESP32ConnectionManager, ESP32Service, handle_esp32_websocket_connection(), WebSocketManager

### Community 5 - "package.json"
Cohesion: 0.06
Nodes (17): FacilitySpaceDefinition, get_all_space_slugs(), get_registered_spaces(), get_space_by_device_id(), get_space_by_slug(), health_check(), index_root(), lifespan() (+9 more)

### Community 6 - "schemas/__init__.py"
Cohesion: 0.14
Nodes (4): Base, utc_now(), AccessRequest, RequestStatus

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (38): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+30 more)

### Community 8 - "compilerOptions"
Cohesion: 0.10
Nodes (29): AffiliationClusterModal(), AffiliationClusterModalProps, CLUSTER_COLORS, InteractiveClusterGraphProps, SortField, SortOrder, UserDirectoryProps, AdminTab (+21 more)

### Community 9 - "WebSocketManager"
Cohesion: 0.08
Nodes (9): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), PushSubscription, NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse (+1 more)

### Community 10 - "get_current_actor"
Cohesion: 0.12
Nodes (11): revoke_active_pin(), verify_keypad_entry(), ActivePinResponse, DirectPinCreateRequest, ESP32EventRequest, ESP32EventResponse, ESP32SyncPinItem, ESP32SyncResponse (+3 more)

### Community 11 - "compilerOptions"
Cohesion: 0.10
Nodes (8): create_facility_space(), create_user_space_assignment(), get_facility_space(), list_facility_spaces(), list_spaces_status(), update_user_space_assignment(), SpaceStatusResponse, SpaceService

### Community 12 - "a9c15669c747_initial_pibas_schema.py"
Cohesion: 0.11
Nodes (11): delete_account(), get_current_user_profile(), get_reset_warning(), list_available_superusers(), list_clubs(), update_profile(), ClubResponse, PreResetWarningResponse (+3 more)

### Community 13 - "websocket_endpoint"
Cohesion: 0.13
Nodes (20): App(), Toast, AuthView(), AuthViewProps, Header(), HeaderProps, KeypadSimulator(), KeypadSimulatorProps (+12 more)

### Community 14 - ".connect"
Cohesion: 0.11
Nodes (14): create_access_token(), get_current_actor(), require_root_admin(), root_admin_token(), superuser_token(), test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins(), test_secondary_admin_lifecycle_and_root_protection() (+6 more)

### Community 15 - "tailwind.config.js"
Cohesion: 0.11
Nodes (7): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), AccessRequestCreate, AccessRequestDecision, AccessRequestResponse

### Community 16 - "postcss.config.js"
Cohesion: 0.09
Nodes (6): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online(), Settings, reset_database()

### Community 17 - "space_service.py"
Cohesion: 0.18
Nodes (17): AddAdminModal(), AddAdminModalProps, AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, KeypadModal(), KeypadModalProps (+9 more)

### Community 18 - "compilerOptions"
Cohesion: 0.20
Nodes (19): AdminDashboard(), AdminDashboardProps, ESP32HardwareManager(), ESP32HardwareManagerProps, ESP32StatusBar(), ESP32StatusBarProps, ProfileModal(), ProfileModalProps (+11 more)

### Community 19 - "schemas/log.py"
Cohesion: 0.22
Nodes (16): CopyButton(), CopyButtonProps, ExcelSpaceLogs(), InteractiveClusterGraph(), JustificationModal(), JustificationModalProps, ResetWarningBanner(), SettingsDrawer() (+8 more)

### Community 20 - "asyncio"
Cohesion: 0.14
Nodes (15): ConsoleLog, ESP32Simulator(), ExcelSpaceLogsProps, TimePreset, FacilitySpaceConfig, getRegisteredSpacesList(), REGISTERED_SPACES, SpaceContext (+7 more)

### Community 21 - "websocket_endpoint"
Cohesion: 0.11
Nodes (9): list_user_space_assignments(), ActiveKeySummaryResponse, ActivePinSummary, EmailLoginRequest, PendingRequestSummary, UserRegisterRequest, UserSpaceAssignmentCreate, UserSpaceAssignmentUpdate (+1 more)

### Community 22 - ".connect"
Cohesion: 0.13
Nodes (5): seed_initial_data(), Admin, Club, ESP32Device, Space

### Community 23 - "vite-env.d.ts"
Cohesion: 0.14
Nodes (5): download_firmware_binary(), get_esp32_devices_status(), ingest_esp32_event(), ping_esp32_device(), sync_esp32_pins()

### Community 24 - "postcss.config.js"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 25 - "tailwind.config.js"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.18
Nodes (6): login_with_email(), register_user(), TokenResponse, get_account_tag(), is_tagging_window_active(), test_account_tagging_lifecycle()

### Community 28 - "tailwind.config.js"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 29 - "tailwind.config.js"
Cohesion: 0.24
Nodes (5): AuthContext, AuthContextType, AuthProvider(), pushService, UserRole

### Community 31 - "sync_esp32_pins"
Cohesion: 0.33
Nodes (3): get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management()

### Community 32 - "send_diagnostic_test_alert"
Cohesion: 0.29
Nodes (3): SpaceBase, SpaceCreate, SpaceResponse

### Community 33 - "notification_service.py"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

## Knowledge Gaps
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `schemas/__init__.py` to `requests.py`, `adjudicate_access_request`, `RequestStatus`, `PinService`, `SpaceContext.tsx`, `main.py`, `package.json`, `PreResetWarningResponse`, `get_current_actor`, `compilerOptions`, `a9c15669c747_initial_pibas_schema.py`, `tailwind.config.js`, `websocket_endpoint`, `.connect`, `vite-env.d.ts`, `vite-env.d.ts`, `postcss.config.js`, `sync_esp32_pins`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `User` (e.g. with `create_direct_pin()` and `get_active_pin()`) actually correct?**
  _`User` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Should `requests.py` be split into smaller, more focused modules?**
  _Cohesion score 0.0519774011299435 - nodes in this community are weakly interconnected._
- **Why does `User` connect `SpaceContext.tsx` to `requests.py`, `PinService`, `schemas/__init__.py`, `get_current_actor`, `compilerOptions`, `a9c15669c747_initial_pibas_schema.py`, `tailwind.config.js`, `websocket_endpoint`, `vite-env.d.ts`, `postcss.config.js`, `sync_esp32_pins`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `SuperUser` (e.g. with `get_current_user_profile()` and `list_available_superusers()`) actually correct?**
  _`SuperUser` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `adjudicate_access_request` be split into smaller, more focused modules?**
  _Cohesion score 0.056107539450613676 - nodes in this community are weakly interconnected._
- **Why does `SuperUser` connect `SpaceContext.tsx` to `adjudicate_access_request`, `PinService`, `schemas/__init__.py`, `compilerOptions`, `a9c15669c747_initial_pibas_schema.py`, `tailwind.config.js`, `websocket_endpoint`, `.connect`, `vite-env.d.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._