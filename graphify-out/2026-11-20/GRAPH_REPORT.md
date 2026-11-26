# Graph Report - PiBAS  (2026-11-20)

## Corpus Check
- 132 files · ~115,273 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 33 file(s) not represented in the graph (top: .bin 19, (none) 3, .csv 3)

## Summary
- 1168 nodes · 3366 edges · 72 communities (34 shown, 38 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 225 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- utc_now
- UUID
- AsyncSession
- test_esp32_hardware_interface.py
- list_entry_logs
- components/AdminDashboard.tsx
- schemas/admin.py
- env.py
- compilerOptions
- AsyncSession
- test_lifecycle_and_constraints.py
- compilerOptions
- AccessRequestCreate
- create_access_token
- config/spaces.py
- User
- update_superuser
- ESP32Service
- run.sh
- stop_rehan.sh script
- SpaceContext.tsx
- Settings
- main.py
- vite-env.d.ts
- App.tsx
- SpaceService
- tailwind.config.js
- NotificationTestResponse
- run_rehan.sh
- ESP32ConnectionManager
- notification_service.py
- websocket_endpoint
- components/SuperUserDashboard.tsx
- schemas/space.py
- entry_log.py
- fe5f1af294f7_update_models_and_entry_logs.py
- pins.py
- setup_rehan.sh
- postcss.config.js
- esp32.py
- v1/admin.py
- test_concurrent_pin_generation_uniqueness_and_revocation
- get
- tailwind.config.js
- sw.js
- tailwind.config.js
- start_services.sh
- stop_services.sh
- esp32_hardware_websocket
- adjudicate_access_request

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
- `create_superuser()` --uses--> `Club`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/club.py
- `get_cluster_graph_data()` --uses--> `Club`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/club.py
- `get_user_directory()` --uses--> `Club`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/club.py
- `list_admin_superusers()` --uses--> `Club`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/club.py
- `lookup_registered_user()` --uses--> `Club`  [INFERRED]
  backend/app/api/v1/admin.py → backend/app/models/club.py

## Import Cycles
- None detected.

## Communities (72 total, 38 thin omitted)

### Community 0 - "utc_now"
Cohesion: 0.09
Nodes (7): Base, utc_now(), Club, PushSubscription, Space, SystemSetting, is_tagging_window_active()

### Community 1 - "UUID"
Cohesion: 0.12
Nodes (12): Admin, EntryLog, execute_annual_september_purge(), test_annual_september_purge_rules(), test_concurrent_pin_generation_uniqueness_and_revocation(), issue_single_pin(), test_email_login_routing_and_revoked_superuser(), test_immutable_audit_log_attribution_on_superuser_deletion() (+4 more)

### Community 2 - "AsyncSession"
Cohesion: 0.10
Nodes (11): admin_system_reset(), create_secondary_admin(), create_superuser(), get_admin_metrics(), get_user_directory(), list_admin_superusers(), list_firmware_releases(), list_secondary_admins() (+3 more)

### Community 3 - "test_esp32_hardware_interface.py"
Cohesion: 0.05
Nodes (26): create_access_token(), get_current_actor(), require_admin(), require_root_admin(), ESP32CommandOutbox, root_admin_token(), superuser_token(), test_admin_metrics() (+18 more)

### Community 4 - "list_entry_logs"
Cohesion: 0.07
Nodes (10): download_offline_archive(), export_audit_logs_csv(), trigger_admin_system_reset(), execute_admin_system_reset(), init_lifecycle_scheduler(), scheduled_3yr_log_prune_job(), scheduled_esp32_heartbeat_job(), scheduled_purge_job() (+2 more)

### Community 5 - "components/AdminDashboard.tsx"
Cohesion: 0.20
Nodes (18): AdminDashboard(), AffiliationClusterModal(), ESP32HardwareManager(), ESP32StatusBar(), ESP32StatusBarProps, ProfileModal(), RegistrationModal(), SuperUserDashboard() (+10 more)

### Community 6 - "schemas/admin.py"
Cohesion: 0.10
Nodes (11): get_cluster_graph_data(), AdminAccountResponse, AdminCreateRequest, AdminMetricsResponse, AdminSuperUserResponse, ClusterGraphLink, ClusterGraphNode, ClusterGraphResponse (+3 more)

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 8 - "compilerOptions"
Cohesion: 0.09
Nodes (29): ESP32HardwareManagerProps, TotpInfo, ConsoleLog, ESP32Simulator(), ExcelSpaceLogsProps, TimePreset, CLUSTER_COLORS, InteractiveClusterGraphProps (+21 more)

### Community 9 - "AsyncSession"
Cohesion: 0.08
Nodes (13): delete_account(), get_auth_config(), create_lock_device(), delete_lock_device(), disable_lock_device(), download_firmware_binary(), enable_lock_device(), get_esp32_devices_status() (+5 more)

### Community 10 - "test_lifecycle_and_constraints.py"
Cohesion: 0.11
Nodes (9): UserSpaceAssignment, get_pre_reset_warning(), test_facility_spaces_seeded(), test_root_admin_seeded(), test_user_space_assignment_unique_constraint(), test_account_tagging_lifecycle(), test_active_pin_partial_uniqueness_constraint(), test_pre_reset_warning_banner() (+1 more)

### Community 11 - "compilerOptions"
Cohesion: 0.15
Nodes (31): AddAdminModal(), AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, CopyButton(), CopyButtonProps, ExcelSpaceLogs() (+23 more)

### Community 13 - "create_access_token"
Cohesion: 0.10
Nodes (17): get_current_user_profile(), google_oauth_login(), login_with_email(), record_account_login(), register_user(), update_profile(), validate_email_domain(), ActiveKeySummaryResponse (+9 more)

### Community 15 - "config/spaces.py"
Cohesion: 0.13
Nodes (9): FacilitySpaceDefinition, get_all_space_slugs(), get_registered_spaces(), get_space_by_device_id(), get_space_by_slug(), reset_to_default_spaces(), test_lookup_by_device_id(), test_registered_spaces_presence() (+1 more)

### Community 18 - "User"
Cohesion: 0.11
Nodes (8): ActivePin, User, PinService, test_pin_generation_uniqueness(), test_esp32_keypad_event_logging(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow(), test_pin_ttl_seconds_configuration()

### Community 19 - "update_superuser"
Cohesion: 0.14
Nodes (6): delete_secondary_admin(), delete_superuser(), delete_user(), revoke_superuser(), update_superuser(), purge_person_by_identifier()

### Community 23 - "SpaceContext.tsx"
Cohesion: 0.15
Nodes (15): AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, SortField, SortOrder, UserDirectoryProps, FacilitySpaceConfig, getRegisteredSpacesList() (+7 more)

### Community 25 - "main.py"
Cohesion: 0.05
Nodes (12): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online(), seed_initial_data(), add_no_cache_headers_for_api(), health_check(), index_root() (+4 more)

### Community 26 - "vite-env.d.ts"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 27 - "App.tsx"
Cohesion: 0.13
Nodes (17): App(), Toast, AddAdminModalProps, AdminDashboardProps, AuthView(), AuthViewProps, Header(), HeaderProps (+9 more)

### Community 28 - "SpaceService"
Cohesion: 0.06
Nodes (23): create_facility_space(), create_user_space_assignment(), delete_facility_space(), get_facility_space(), list_facility_spaces(), list_spaces_status(), list_user_space_assignments(), update_facility_space() (+15 more)

### Community 29 - "tailwind.config.js"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 30 - "NotificationTestResponse"
Cohesion: 0.08
Nodes (7): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse

### Community 33 - "notification_service.py"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 37 - "components/SuperUserDashboard.tsx"
Cohesion: 0.24
Nodes (12): RegistrationPendingView(), RegistrationPendingViewProps, StudentDashboard(), StudentDashboardProps, SuperUserDashboardProps, AccessRequest, ActiveKeySummary, ActivePin (+4 more)

### Community 38 - "schemas/space.py"
Cohesion: 0.18
Nodes (9): KeypadModal(), KeypadModalProps, Navbar(), PWAInstallButton(), AuthContext, AuthContextType, AuthProvider(), pushService (+1 more)

### Community 39 - "entry_log.py"
Cohesion: 0.19
Nodes (3): list_entry_logs(), EntryEventType, EntryLogResponse

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 43 - "pins.py"
Cohesion: 0.10
Nodes (15): create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse, DirectPinCreateRequest (+7 more)

### Community 47 - "postcss.config.js"
Cohesion: 0.33
Nodes (5): channels, dependencies, pip, name, prefix

### Community 48 - "esp32.py"
Cohesion: 0.11
Nodes (5): require_superuser_or_admin(), get_db(), SuperUser, LogService, NotificationService

### Community 49 - "v1/admin.py"
Cohesion: 0.10
Nodes (8): get_emergency_totp_keys(), get_pin_validity_setting(), list_admin_esp32_devices(), PinValidityUpdateRequest, rotate_admin_esp32_secret(), update_pin_validity_setting(), SystemSettingService, TotpService

### Community 51 - "get"
Cohesion: 0.22
Nodes (4): get_quick_accounts(), get_reset_warning(), list_available_superusers(), list_clubs()

### Community 67 - "adjudicate_access_request"
Cohesion: 0.13
Nodes (8): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), AccessRequest, RequestStatus, AccessRequestResponse, RequestCleanupService

## Knowledge Gaps
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `utc_now` to `ESP32ConnectionManager`, `UUID`, `AsyncSession`, `adjudicate_access_request`, `list_entry_logs`, `test_esp32_hardware_interface.py`, `entry_log.py`, `AsyncSession`, `test_lifecycle_and_constraints.py`, `pins.py`, `create_access_token`, `esp32.py`, `v1/admin.py`, `User`, `update_superuser`, `ESP32Service`, `SpaceService`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `User` (e.g. with `create_superuser()` and `get_admin_metrics()`) actually correct?**
  _`User` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Should `utc_now` be split into smaller, more focused modules?**
  _Cohesion score 0.09317051108095885 - nodes in this community are weakly interconnected._
- **Why does `User` connect `User` to `utc_now`, `UUID`, `AsyncSession`, `adjudicate_access_request`, `test_esp32_hardware_interface.py`, `schemas/admin.py`, `test_lifecycle_and_constraints.py`, `pins.py`, `create_access_token`, `esp32.py`, `v1/admin.py`, `update_superuser`, `SpaceService`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `UUID` be split into smaller, more focused modules?**
  _Cohesion score 0.12315270935960591 - nodes in this community are weakly interconnected._
- **Why does `ESP32Service` connect `ESP32Service` to `ESP32ConnectionManager`, `utc_now`, `AsyncSession`, `test_esp32_hardware_interface.py`, `list_entry_logs`, `entry_log.py`, `esp32.py`, `v1/admin.py`, `User`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `AsyncSession` be split into smaller, more focused modules?**
  _Cohesion score 0.09971509971509972 - nodes in this community are weakly interconnected._