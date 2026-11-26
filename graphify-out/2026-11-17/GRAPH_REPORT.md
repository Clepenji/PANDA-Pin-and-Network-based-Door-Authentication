# Graph Report - PiBAS  (2026-11-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1021 nodes · 2910 edges · 56 communities (39 shown, 17 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.94)
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
- RequestStatus
- PreResetWarningResponse
- websocket_endpoint
- tailwind.config.js
- schemas/space.py
- compilerOptions
- .connect
- vite-env.d.ts
- fe5f1af294f7_update_models_and_entry_logs.py
- Settings
- .connect
- vite-env.d.ts
- downgrade
- postcss.config.js
- sw.js
- tailwind.config.js
- test_concurrent_pin_generation_uniqueness_and_revocation
- .connect
- vite-env.d.ts

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 62 edges
2. `User` - 45 edges
3. `react` - 37 edges
4. `Base` - 34 edges
5. `SuperUser` - 33 edges
6. `lucide-react` - 33 edges
7. `PinService` - 28 edges
8. `api` - 25 edges
9. `ESP32Service` - 21 edges
10. `ActivePin` - 21 edges

## Surprising Connections (you probably didn't know these)
- `test_annual_september_purge_execution()` --uses--> `RequestStatus`  [INFERRED]
  backend/tests/test_lifecycle_and_constraints.py → backend/app/models/access_request.py
- `list_active_keys_privacy()` --uses--> `ActiveKeySummaryResponse`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/schemas/auth.py
- `list_user_space_assignments()` --uses--> `PendingRequestSummary`  [INFERRED]
  backend/app/api/v1/spaces.py → backend/app/schemas/auth.py
- `create_user_space_assignment()` --uses--> `UserSpaceAssignmentCreate`  [INFERRED]
  backend/app/api/v1/spaces.py → backend/app/schemas/auth.py
- `update_user_space_assignment()` --uses--> `UserSpaceAssignmentUpdate`  [INFERRED]
  backend/app/api/v1/spaces.py → backend/app/schemas/auth.py

## Import Cycles
- None detected.

## Communities (56 total, 17 thin omitted)

### Community 0 - "requests.py"
Cohesion: 0.06
Nodes (17): create_facility_space(), create_user_space_assignment(), get_facility_space(), list_facility_spaces(), list_spaces_status(), list_user_space_assignments(), update_user_space_assignment(), Space (+9 more)

### Community 2 - "SpaceContext.tsx"
Cohesion: 0.07
Nodes (9): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), Settings, PushSubscription, NotificationTestResponse, PushSubscriptionCreate, VapidPublicKeyResponse (+1 more)

### Community 3 - "PinService"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 4 - "main.py"
Cohesion: 0.11
Nodes (11): register_user(), ActivePin, UserSpaceAssignment, User, test_user_space_assignment_unique_constraint(), test_inbound_hardware_events_ingestion(), test_annual_september_purge_rules(), test_immutable_audit_log_attribution_on_superuser_deletion() (+3 more)

### Community 5 - "package.json"
Cohesion: 0.14
Nodes (4): ESP32Device, LogService, SystemSettingService, TotpService

### Community 6 - "schemas/__init__.py"
Cohesion: 0.12
Nodes (23): App(), Toast, AdminDashboard(), AffiliationClusterModal(), AuthView(), AuthViewProps, ESP32HardwareManager(), ESP32StatusBar() (+15 more)

### Community 7 - "env.py"
Cohesion: 0.12
Nodes (27): ESP32HardwareManagerProps, TotpInfo, CLUSTER_COLORS, InteractiveClusterGraphProps, AdminTab, SubView, ActiveKeySummary, ActivePinSummary (+19 more)

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (10): get_registered_spaces(), seed_initial_data(), health_check(), index_root(), lifespan(), spa_fallback(), init_lifecycle_scheduler(), scheduled_esp32_heartbeat_job() (+2 more)

### Community 10 - "get_current_actor"
Cohesion: 0.10
Nodes (15): create_access_token(), get_current_actor(), require_admin(), require_root_admin(), root_admin_token(), superuser_token(), test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins() (+7 more)

### Community 11 - "compilerOptions"
Cohesion: 0.12
Nodes (8): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), RequestStatus, AccessRequestCreate, AccessRequestDecision, AccessRequestResponse

### Community 12 - "a9c15669c747_initial_pibas_schema.py"
Cohesion: 0.17
Nodes (20): CopyButton(), CopyButtonProps, ExcelSpaceLogs(), ExcelSpaceLogsProps, TimePreset, InteractiveClusterGraph(), JustificationModal(), JustificationModalProps (+12 more)

### Community 13 - "websocket_endpoint"
Cohesion: 0.11
Nodes (11): login_with_email(), ActiveKeySummaryResponse, ClubResponse, EmailLoginRequest, PendingRequestSummary, PreResetWarningResponse, SuperUserInfoResponse, TokenResponse (+3 more)

### Community 14 - ".connect"
Cohesion: 0.17
Nodes (18): AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, ConsoleLog, ESP32Simulator(), KeypadModal(), KeypadModalProps (+10 more)

### Community 15 - "tailwind.config.js"
Cohesion: 0.15
Nodes (8): create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse, RevokePinResponse

### Community 16 - "postcss.config.js"
Cohesion: 0.12
Nodes (7): AccessRequest, SuperUser, execute_annual_september_purge(), get_account_tag(), is_tagging_window_active(), test_suite(), test_account_tagging_lifecycle()

### Community 17 - "space_service.py"
Cohesion: 0.13
Nodes (17): AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, KeypadSimulator(), KeypadSimulatorProps, SortField, SortOrder, UserDirectoryProps (+9 more)

### Community 18 - "compilerOptions"
Cohesion: 0.16
Nodes (4): PinService, test_pin_generation_uniqueness(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow()

### Community 19 - "schemas/log.py"
Cohesion: 0.13
Nodes (4): ESP32Service, handle_esp32_websocket_connection(), test_handshake_successful_authentication(), test_outbox_persistence_and_ws_flush()

### Community 20 - "asyncio"
Cohesion: 0.15
Nodes (7): FacilitySpaceDefinition, get_all_space_slugs(), get_space_by_device_id(), get_space_by_slug(), test_lookup_by_device_id(), test_registered_spaces_presence(), test_space_metadata_integrity()

### Community 21 - "websocket_endpoint"
Cohesion: 0.16
Nodes (8): PushSubscriptionKeys, DirectPinCreateRequest, ESP32EventRequest, ESP32EventResponse, ESP32SyncPinItem, ESP32SyncResponse, KeypadAttemptRequest, KeypadAttemptResponse

### Community 22 - ".connect"
Cohesion: 0.17
Nodes (16): AddAdminModal(), AddAdminModalProps, AdminDashboardProps, Header(), HeaderProps, ProfileModal(), ProfileModalProps, RegistrationModal() (+8 more)

### Community 23 - "vite-env.d.ts"
Cohesion: 0.10
Nodes (9): test_pin_ttl_seconds_configuration(), test_handshake_invalid_signature_rejection(), test_handshake_replay_drift_rejection(), test_handshake_unknown_space_rejection(), test_hardware_monitoring_role_restrictions(), test_ota_firmware_upload_download_and_secret_rotation(), test_email_login_routing_and_revoked_superuser(), test_unique_user_space_assignment_and_inline_switching() (+1 more)

### Community 24 - "postcss.config.js"
Cohesion: 0.13
Nodes (7): delete_account(), get_current_user_profile(), get_reset_warning(), list_available_superusers(), list_clubs(), update_profile(), UserProfileResponse

### Community 25 - "tailwind.config.js"
Cohesion: 0.14
Nodes (4): get_db(), Admin, get_pre_reset_warning(), test_pre_reset_warning_banner()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 27 - "postcss.config.js"
Cohesion: 0.17
Nodes (7): delete_secondary_admin(), delete_superuser(), delete_user(), get_pin_validity_setting(), list_firmware_releases(), PinValidityUpdateRequest, update_pin_validity_setting()

### Community 29 - "tailwind.config.js"
Cohesion: 0.17
Nodes (6): create_superuser(), list_admin_superusers(), update_superuser(), Club, ESP32FirmwareRelease, AdminSuperUserResponse

### Community 30 - "do_run_migrations"
Cohesion: 0.16
Nodes (4): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online()

### Community 31 - "sync_esp32_pins"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 32 - "send_diagnostic_test_alert"
Cohesion: 0.19
Nodes (4): require_superuser_or_admin(), list_entry_logs(), EntryEventType, EntryLogResponse

### Community 33 - "notification_service.py"
Cohesion: 0.18
Nodes (4): download_firmware_binary(), get_esp32_devices_status(), ping_esp32_device(), sync_esp32_pins()

### Community 34 - "RequestStatus"
Cohesion: 0.20
Nodes (5): get_cluster_graph_data(), AdminMetricsResponse, ClusterGraphLink, ClusterGraphNode, ClusterGraphResponse

### Community 35 - "PreResetWarningResponse"
Cohesion: 0.20
Nodes (3): AdminCreateRequest, SuperUserCreateRequest, SuperUserUpdateRequest

### Community 36 - "websocket_endpoint"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 37 - "tailwind.config.js"
Cohesion: 0.22
Nodes (3): get_admin_metrics(), get_emergency_totp_keys(), list_admin_esp32_devices()

### Community 40 - ".connect"
Cohesion: 0.25
Nodes (3): revoke_superuser(), rotate_admin_esp32_secret(), upload_firmware_binary()

### Community 41 - "vite-env.d.ts"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.33
Nodes (3): create_secondary_admin(), list_secondary_admins(), AdminAccountResponse

### Community 47 - "postcss.config.js"
Cohesion: 0.40
Nodes (4): AuthContext, AuthContextType, AuthProvider(), UserRole

## Knowledge Gaps
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `adjudicate_access_request` to `requests.py`, `main.py`, `package.json`, `compilerOptions`, `compilerOptions`, `tailwind.config.js`, `postcss.config.js`, `compilerOptions`, `schemas/log.py`, `vite-env.d.ts`, `postcss.config.js`, `tailwind.config.js`, `tailwind.config.js`, `tailwind.config.js`, `send_diagnostic_test_alert`, `notification_service.py`, `tailwind.config.js`, `schemas/space.py`, `downgrade`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `User` (e.g. with `create_direct_pin()` and `get_active_pin()`) actually correct?**
  _`User` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Should `requests.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06352087114337568 - nodes in this community are weakly interconnected._
- **Why does `handle_esp32_websocket_connection()` connect `schemas/log.py` to `adjudicate_access_request`, `main.py`, `package.json`, `WebSocketManager`, `vite-env.d.ts`, `asyncio`, `vite-env.d.ts`, `tailwind.config.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `adjudicate_access_request` be split into smaller, more focused modules?**
  _Cohesion score 0.1468599033816425 - nodes in this community are weakly interconnected._
- **Why does `User` connect `main.py` to `send_diagnostic_test_alert`, `requests.py`, `adjudicate_access_request`, `package.json`, `schemas/space.py`, `compilerOptions`, `websocket_endpoint`, `downgrade`, `tailwind.config.js`, `postcss.config.js`, `compilerOptions`, `test_concurrent_pin_generation_uniqueness_and_revocation`, `vite-env.d.ts`, `tailwind.config.js`, `tailwind.config.js`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Should `SpaceContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07171717171717172 - nodes in this community are weakly interconnected._