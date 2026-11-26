# Graph Report - PiBAS  (2026-11-19)

## Corpus Check
- 132 files · ~115,177 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 31 file(s) not represented in the graph (top: .bin 16, (none) 3, .csv 3)

## Summary
- 1168 nodes · 3366 edges · 73 communities (39 shown, 34 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 225 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- utc_now
- main.py
- SpaceContext.tsx
- asyncio
- list_entry_logs
- components/AdminDashboard.tsx
- schemas/admin.py
- env.py
- compilerOptions
- AsyncSession
- lifecycle_service.py
- compilerOptions
- create_access_token
- create_access_token
- production_exception_handler
- config/spaces.py
- utc_now
- User
- v1/admin.py
- ESP32Service
- run.sh
- stop_rehan.sh script
- SpaceContext.tsx
- deps.py
- env.py
- vite-env.d.ts
- App.tsx
- SpaceService
- tailwind.config.js
- NotificationTestResponse
- run_rehan.sh
- ESP32ConnectionManager
- notification_service.py
- pins.py
- websocket_endpoint
- components/SuperUserDashboard.tsx
- schemas/space.py
- entry_log.py
- fe5f1af294f7_update_models_and_entry_logs.py
- schemas/__init__.py
- setup_rehan.sh
- httpx
- postcss.config.js
- esp32.py
- PinService
- test_concurrent_pin_generation_uniqueness_and_revocation
- init_lifecycle_scheduler
- tailwind.config.js
- sw.js
- tailwind.config.js
- start_services.sh
- stop_services.sh
- esp32_hardware_websocket
- adjudicate_access_request
- test_admin_portal.py
- test_pin_generation_uniqueness

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 68 edges
2. `User` - 59 edges
3. `react` - 39 edges
4. `PinService` - 37 edges
5. `SuperUser` - 36 edges
6. `lucide-react` - 35 edges
7. `Base` - 34 edges
8. `ActivePin` - 31 edges
9. `EntryEventType` - 30 edges
10. `UserSpaceAssignment` - 29 edges

## Surprising Connections (you probably didn't know these)
- `create_secondary_admin()` --uses--> `Admin`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/admin.py
- `delete_secondary_admin()` --uses--> `Admin`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/admin.py
- `list_secondary_admins()` --uses--> `Admin`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/admin.py
- `test_root_admin_seeded()` --uses--> `Admin`  [INFERRED]
  backend/tests/test_db_schema.py → backend/app/models/admin.py
- `test_annual_september_purge_rules()` --uses--> `Admin`  [INFERRED]
  backend/tests/test_exhaustive_suite.py → backend/app/models/admin.py

## Import Cycles
- None detected.

## Communities (73 total, 34 thin omitted)

### Community 0 - "utc_now"
Cohesion: 0.10
Nodes (6): Base, seed_initial_data(), Admin, PushSubscription, Space, SystemSetting

### Community 2 - "SpaceContext.tsx"
Cohesion: 0.09
Nodes (14): admin_system_reset(), create_secondary_admin(), delete_secondary_admin(), delete_superuser(), delete_user(), get_emergency_totp_keys(), get_pin_validity_setting(), list_admin_esp32_devices() (+6 more)

### Community 3 - "asyncio"
Cohesion: 0.13
Nodes (8): ESP32CommandOutbox, test_handshake_invalid_signature_rejection(), test_handshake_replay_drift_rejection(), test_handshake_successful_authentication(), test_handshake_unknown_space_rejection(), test_hardware_monitoring_role_restrictions(), test_ota_firmware_upload_download_and_secret_rotation(), test_outbox_persistence_and_ws_flush()

### Community 4 - "list_entry_logs"
Cohesion: 0.12
Nodes (5): download_offline_archive(), export_audit_logs_csv(), trigger_admin_system_reset(), execute_admin_system_reset(), purge_person_by_identifier()

### Community 5 - "components/AdminDashboard.tsx"
Cohesion: 0.20
Nodes (18): AdminDashboard(), AffiliationClusterModal(), ESP32HardwareManager(), ESP32StatusBar(), ESP32StatusBarProps, ProfileModal(), RegistrationModal(), SuperUserDashboard() (+10 more)

### Community 6 - "schemas/admin.py"
Cohesion: 0.11
Nodes (9): AdminAccountResponse, AdminCreateRequest, AdminMetricsResponse, ClusterGraphLink, ClusterGraphNode, ClusterGraphResponse, DirectoryMemberResponse, SuperUserCreateRequest (+1 more)

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 8 - "compilerOptions"
Cohesion: 0.09
Nodes (29): ESP32HardwareManagerProps, TotpInfo, ConsoleLog, ESP32Simulator(), ExcelSpaceLogsProps, TimePreset, CLUSTER_COLORS, InteractiveClusterGraphProps (+21 more)

### Community 9 - "AsyncSession"
Cohesion: 0.11
Nodes (10): create_lock_device(), delete_lock_device(), disable_lock_device(), download_firmware_binary(), enable_lock_device(), get_esp32_devices_status(), list_all_lock_devices(), ping_esp32_device() (+2 more)

### Community 10 - "lifecycle_service.py"
Cohesion: 0.11
Nodes (10): SuperUser, execute_annual_september_purge(), get_account_tag(), get_pre_reset_warning(), is_tagging_window_active(), prune_logs_older_than_three_years(), test_suite(), test_account_tagging_lifecycle() (+2 more)

### Community 11 - "compilerOptions"
Cohesion: 0.15
Nodes (31): AddAdminModal(), AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, CopyButton(), CopyButtonProps, ExcelSpaceLogs() (+23 more)

### Community 12 - "create_access_token"
Cohesion: 0.25
Nodes (7): create_access_token(), root_admin_token(), superuser_token(), user_token(), regular_user_token(), root_admin_token(), superuser_sandboxx_0_token()

### Community 13 - "create_access_token"
Cohesion: 0.07
Nodes (24): delete_account(), get_auth_config(), get_current_user_profile(), get_quick_accounts(), get_reset_warning(), google_oauth_login(), list_available_superusers(), list_clubs() (+16 more)

### Community 14 - "production_exception_handler"
Cohesion: 0.18
Nodes (3): add_no_cache_headers_for_api(), production_exception_handler(), spa_fallback()

### Community 15 - "config/spaces.py"
Cohesion: 0.16
Nodes (6): get_all_space_slugs(), get_registered_spaces(), reset_to_default_spaces(), unregister_space(), test_registered_spaces_presence(), test_space_metadata_integrity()

### Community 16 - "utc_now"
Cohesion: 0.11
Nodes (11): list_entry_logs(), list_active_keys_privacy(), create_user_space_assignment(), list_user_space_assignments(), update_user_space_assignment(), get_space_by_slug(), utc_now(), RequestStatus (+3 more)

### Community 18 - "User"
Cohesion: 0.09
Nodes (16): ActivePin, EntryLog, User, test_user_space_assignment_unique_constraint(), test_esp32_keypad_event_logging(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow(), test_pin_ttl_seconds_configuration() (+8 more)

### Community 19 - "v1/admin.py"
Cohesion: 0.12
Nodes (11): create_superuser(), get_admin_metrics(), get_cluster_graph_data(), get_user_directory(), list_admin_superusers(), update_superuser(), AccessRequest, UserSpaceAssignment (+3 more)

### Community 23 - "SpaceContext.tsx"
Cohesion: 0.15
Nodes (15): AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, SortField, SortOrder, UserDirectoryProps, FacilitySpaceConfig, getRegisteredSpacesList() (+7 more)

### Community 24 - "deps.py"
Cohesion: 0.09
Nodes (7): get_current_actor(), require_admin(), require_root_admin(), require_superuser_or_admin(), get_vapid_public_key(), Settings, get_db()

### Community 25 - "env.py"
Cohesion: 0.12
Nodes (5): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online(), reset_database()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 27 - "App.tsx"
Cohesion: 0.13
Nodes (17): App(), Toast, AddAdminModalProps, AdminDashboardProps, AuthView(), AuthViewProps, Header(), HeaderProps (+9 more)

### Community 28 - "SpaceService"
Cohesion: 0.06
Nodes (17): create_facility_space(), delete_facility_space(), get_facility_space(), list_facility_spaces(), list_spaces_status(), update_facility_space(), FacilitySpaceDefinition, get_space_by_device_id() (+9 more)

### Community 29 - "tailwind.config.js"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 30 - "NotificationTestResponse"
Cohesion: 0.09
Nodes (7): send_diagnostic_test_alert(), subscribe_for_push(), NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse, NotificationService

### Community 33 - "notification_service.py"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 35 - "pins.py"
Cohesion: 0.16
Nodes (6): create_direct_pin(), get_active_pin(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse

### Community 37 - "components/SuperUserDashboard.tsx"
Cohesion: 0.24
Nodes (12): RegistrationPendingView(), RegistrationPendingViewProps, StudentDashboard(), StudentDashboardProps, SuperUserDashboardProps, AccessRequest, ActiveKeySummary, ActivePin (+4 more)

### Community 38 - "schemas/space.py"
Cohesion: 0.18
Nodes (9): KeypadModal(), KeypadModalProps, Navbar(), PWAInstallButton(), AuthContext, AuthContextType, AuthProvider(), pushService (+1 more)

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 43 - "schemas/__init__.py"
Cohesion: 0.10
Nodes (11): AccessRequestCreate, AccessRequestDecision, AccessRequestResponse, DirectPinCreateRequest, ESP32EventRequest, ESP32EventResponse, ESP32SyncPinItem, ESP32SyncResponse (+3 more)

### Community 47 - "postcss.config.js"
Cohesion: 0.33
Nodes (5): channels, dependencies, pip, name, prefix

### Community 48 - "esp32.py"
Cohesion: 0.12
Nodes (5): EntryEventType, ESP32FirmwareRelease, LogService, SystemSettingService, TotpService

### Community 49 - "PinService"
Cohesion: 0.09
Nodes (4): ingest_esp32_event(), PinService, test_inbound_hardware_events_ingestion(), issue_single_pin()

### Community 52 - "init_lifecycle_scheduler"
Cohesion: 0.22
Nodes (5): lifespan(), init_lifecycle_scheduler(), scheduled_3yr_log_prune_job(), scheduled_esp32_heartbeat_job(), scheduled_purge_job()

### Community 67 - "adjudicate_access_request"
Cohesion: 0.09
Nodes (7): PinValidityUpdateRequest, update_pin_validity_setting(), adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), scheduled_request_cleanup_job()

### Community 68 - "test_admin_portal.py"
Cohesion: 0.39
Nodes (5): test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins(), test_secondary_admin_lifecycle_and_root_protection(), test_shared_logs_universal_visibility_and_csv_export(), test_superuser_admin_management_and_revocation()

### Community 70 - "test_pin_generation_uniqueness"
Cohesion: 0.29
Nodes (3): test_facility_spaces_seeded(), test_pin_generation_uniqueness(), test_root_admin_seeded()

## Knowledge Gaps
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `utc_now` to `utc_now`, `ESP32ConnectionManager`, `pins.py`, `adjudicate_access_request`, `asyncio`, `entry_log.py`, `AsyncSession`, `lifecycle_service.py`, `create_access_token`, `esp32.py`, `PinService`, `User`, `v1/admin.py`, `ESP32Service`, `init_lifecycle_scheduler`, `SpaceService`, `NotificationTestResponse`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `User` (e.g. with `create_superuser()` and `get_admin_metrics()`) actually correct?**
  _`User` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Should `utc_now` be split into smaller, more focused modules?**
  _Cohesion score 0.10377358490566038 - nodes in this community are weakly interconnected._
- **Why does `User` connect `User` to `utc_now`, `SpaceContext.tsx`, `pins.py`, `adjudicate_access_request`, `asyncio`, `lifecycle_service.py`, `create_access_token`, `esp32.py`, `utc_now`, `PinService`, `v1/admin.py`, `deps.py`, `SpaceService`, `NotificationTestResponse`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `SpaceContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08819345661450925 - nodes in this community are weakly interconnected._
- **Why does `NotificationService` connect `NotificationTestResponse` to `utc_now`, `adjudicate_access_request`, `lifecycle_service.py`, `create_access_token`, `utc_now`, `deps.py`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Should `asyncio` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._