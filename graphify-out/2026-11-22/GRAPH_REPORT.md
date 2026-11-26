# Graph Report - PiBAS  (2026-11-20)

## Corpus Check
- 133 files · ~116,714 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 33 file(s) not represented in the graph (top: .bin 19, (none) 3, .csv 3)

## Summary
- 1172 nodes · 3332 edges · 77 communities (38 shown, 39 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 177 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- utc_now
- UUID
- lifecycle_service.py
- test_inbound_hardware_events_ingestion
- logs.py
- components/SuperUserDashboard.tsx
- v1/admin.py
- env.py
- compilerOptions
- AsyncSession
- test_lifecycle_and_constraints.py
- compilerOptions
- test_db_schema.py
- v1/spaces.py
- deps.py
- test_esp32_hardware_interface.py
- main.py
- UserProfileUpdateRequest
- User
- execute_admin_system_reset
- ESP32Service
- run.sh
- stop_rehan.sh script
- SpaceContext.tsx
- Settings
- env.py
- vite-env.d.ts
- lucide-react
- SpaceService
- tailwind.config.js
- NotificationTestResponse
- run_rehan.sh
- ESP32ConnectionManager
- notification_service.py
- test_admin_portal.py
- websocket_endpoint
- components/SuperUserDashboard.tsx
- schemas/space.py
- production_exception_handler
- fe5f1af294f7_update_models_and_entry_logs.py
- pins.py
- setup_rehan.sh
- init_lifecycle_scheduler
- postcss.config.js
- esp32.py
- Any
- test_concurrent_pin_generation_uniqueness_and_revocation
- v1/auth.py
- httpx
- tailwind.config.js
- sw.js
- tailwind.config.js
- start_services.sh
- stop_services.sh
- Club
- adjudicate_access_request
- ESP32CommandOutbox
- deploy_to_pi.sh

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 68 edges
2. `User` - 53 edges
3. `react` - 39 edges
4. `PinService` - 37 edges
5. `lucide-react` - 35 edges
6. `Base` - 34 edges
7. `SuperUser` - 31 edges
8. `ActivePin` - 30 edges
9. `EntryEventType` - 29 edges
10. `api` - 28 edges

## Surprising Connections (you probably didn't know these)
- `login_with_email()` --uses--> `EmailLoginRequest`  [INFERRED]
  backend/app/api/v1/auth.py → backend/app/schemas/auth.py
- `login_with_email()` --uses--> `TokenResponse`  [INFERRED]
  backend/app/api/v1/auth.py → backend/app/schemas/auth.py
- `register_user()` --uses--> `TokenResponse`  [INFERRED]
  backend/app/api/v1/auth.py → backend/app/schemas/auth.py
- `register_user()` --uses--> `UserRegisterRequest`  [INFERRED]
  backend/app/api/v1/auth.py → backend/app/schemas/auth.py
- `update_profile()` --uses--> `UserProfileResponse`  [INFERRED]
  backend/app/api/v1/auth.py → backend/app/schemas/auth.py

## Import Cycles
- None detected.

## Communities (77 total, 39 thin omitted)

### Community 0 - "utc_now"
Cohesion: 0.12
Nodes (5): downgrade(), upgrade(), Base, utc_now(), PushSubscription

### Community 1 - "UUID"
Cohesion: 0.13
Nodes (7): EntryLog, LogService, test_annual_september_purge_rules(), test_email_login_routing_and_revoked_superuser(), test_immutable_audit_log_attribution_on_superuser_deletion(), test_unique_user_space_assignment_and_inline_switching(), test_web_push_vapid_and_subscription_flow()

### Community 2 - "lifecycle_service.py"
Cohesion: 0.14
Nodes (6): register_user(), AccessRequest, execute_annual_september_purge(), get_account_tag(), is_tagging_window_active(), test_suite()

### Community 3 - "test_inbound_hardware_events_ingestion"
Cohesion: 0.15
Nodes (7): test_handshake_invalid_signature_rejection(), test_handshake_replay_drift_rejection(), test_handshake_successful_authentication(), test_handshake_unknown_space_rejection(), test_hardware_monitoring_role_restrictions(), test_inbound_hardware_events_ingestion(), test_outbox_persistence_and_ws_flush()

### Community 4 - "logs.py"
Cohesion: 0.09
Nodes (8): download_offline_archive(), export_audit_logs_csv(), list_entry_logs(), trigger_admin_system_reset(), get_space_by_slug(), get_db(), EntryEventType, EntryLogResponse

### Community 5 - "components/SuperUserDashboard.tsx"
Cohesion: 0.13
Nodes (27): App(), Toast, AddAdminModalProps, AdminDashboard(), AdminDashboardProps, AffiliationClusterModal(), AuthView(), AuthViewProps (+19 more)

### Community 6 - "v1/admin.py"
Cohesion: 0.05
Nodes (31): admin_system_reset(), create_secondary_admin(), create_superuser(), get_admin_metrics(), get_cluster_graph_data(), get_user_directory(), list_admin_superusers(), list_firmware_releases() (+23 more)

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 8 - "compilerOptions"
Cohesion: 0.09
Nodes (32): ESP32HardwareManagerProps, TotpInfo, ESP32StatusBarProps, CLUSTER_COLORS, InteractiveClusterGraphProps, ResetBanner(), ResetBannerProps, ActiveKeySummary (+24 more)

### Community 9 - "AsyncSession"
Cohesion: 0.08
Nodes (12): create_lock_device(), delete_lock_device(), disable_lock_device(), download_firmware_binary(), enable_lock_device(), get_esp32_devices_status(), ingest_esp32_event(), list_all_lock_devices() (+4 more)

### Community 10 - "test_lifecycle_and_constraints.py"
Cohesion: 0.14
Nodes (7): UserSpaceAssignment, prune_logs_older_than_three_years(), test_user_space_assignment_unique_constraint(), test_account_tagging_lifecycle(), test_active_pin_partial_uniqueness_constraint(), test_annual_september_purge_execution(), test_user_space_assignment_unique_constraint()

### Community 11 - "compilerOptions"
Cohesion: 0.15
Nodes (27): AddAdminModal(), CopyButton(), ConsoleLog, ESP32Simulator(), ExcelSpaceLogs(), ExcelSpaceLogsProps, TimePreset, InteractiveClusterGraph() (+19 more)

### Community 12 - "test_db_schema.py"
Cohesion: 0.14
Nodes (6): seed_initial_data(), Admin, Space, test_facility_spaces_seeded(), test_pin_generation_uniqueness(), test_root_admin_seeded()

### Community 13 - "v1/spaces.py"
Cohesion: 0.10
Nodes (15): create_user_space_assignment(), list_user_space_assignments(), update_user_space_assignment(), ActiveKeySummaryResponse, ActivePinSummary, ClubResponse, EmailLoginRequest, PendingRequestSummary (+7 more)

### Community 14 - "deps.py"
Cohesion: 0.17
Nodes (4): get_current_actor(), require_admin(), require_root_admin(), require_superuser_or_admin()

### Community 15 - "test_esp32_hardware_interface.py"
Cohesion: 0.21
Nodes (5): create_access_token(), regular_user_token(), root_admin_token(), superuser_sandboxx_0_token(), test_ota_firmware_upload_download_and_secret_rotation()

### Community 18 - "User"
Cohesion: 0.11
Nodes (9): ActivePin, User, PinService, test_esp32_keypad_event_logging(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow(), test_pin_ttl_seconds_configuration(), test_concurrent_pin_generation_uniqueness_and_revocation() (+1 more)

### Community 19 - "execute_admin_system_reset"
Cohesion: 0.22
Nodes (4): execute_admin_system_reset(), get_pre_reset_warning(), purge_person_by_identifier(), test_pre_reset_warning_banner()

### Community 23 - "SpaceContext.tsx"
Cohesion: 0.15
Nodes (13): AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, SortField, SortOrder, UserDirectoryProps, FacilitySpaceConfig, getRegisteredSpacesList() (+5 more)

### Community 25 - "env.py"
Cohesion: 0.12
Nodes (5): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online(), reset_database()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 27 - "lucide-react"
Cohesion: 0.21
Nodes (12): AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, KeypadSimulator(), KeypadSimulatorProps, COUNTRY_CODES, PhoneInput() (+4 more)

### Community 28 - "SpaceService"
Cohesion: 0.07
Nodes (15): create_facility_space(), delete_facility_space(), get_facility_space(), list_facility_spaces(), list_spaces_status(), update_facility_space(), register_dynamic_space(), unregister_space() (+7 more)

### Community 29 - "tailwind.config.js"
Cohesion: 0.18
Nodes (4): downgrade(), upgrade(), downgrade(), upgrade()

### Community 30 - "NotificationTestResponse"
Cohesion: 0.09
Nodes (8): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse, NotificationService

### Community 33 - "notification_service.py"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 35 - "test_admin_portal.py"
Cohesion: 0.26
Nodes (8): root_admin_token(), superuser_token(), test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins(), test_secondary_admin_lifecycle_and_root_protection(), test_shared_logs_universal_visibility_and_csv_export(), test_superuser_admin_management_and_revocation(), user_token()

### Community 37 - "components/SuperUserDashboard.tsx"
Cohesion: 0.24
Nodes (11): CopyButtonProps, RegistrationPendingView(), RegistrationPendingViewProps, StudentDashboard(), StudentDashboardProps, AccessRequest, ActivePin, SuperUserInfo (+3 more)

### Community 38 - "schemas/space.py"
Cohesion: 0.19
Nodes (10): KeypadModal(), KeypadModalProps, Navbar(), PWAInstallButton(), AuthContext, AuthContextType, AuthProvider(), pushService (+2 more)

### Community 39 - "production_exception_handler"
Cohesion: 0.18
Nodes (3): add_no_cache_headers_for_api(), production_exception_handler(), spa_fallback()

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 43 - "pins.py"
Cohesion: 0.09
Nodes (15): sync_esp32_pins(), create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse (+7 more)

### Community 46 - "init_lifecycle_scheduler"
Cohesion: 0.20
Nodes (5): lifespan(), init_lifecycle_scheduler(), scheduled_3yr_log_prune_job(), scheduled_purge_job(), scheduled_request_cleanup_job()

### Community 47 - "postcss.config.js"
Cohesion: 0.33
Nodes (5): channels, dependencies, pip, name, prefix

### Community 48 - "esp32.py"
Cohesion: 0.09
Nodes (7): esp32_hardware_websocket(), websocket_endpoint(), ESP32Device, ESP32FirmwareRelease, handle_esp32_websocket_connection(), SystemSettingService, TotpService

### Community 49 - "Any"
Cohesion: 0.08
Nodes (9): delete_secondary_admin(), delete_superuser(), delete_user(), get_emergency_totp_keys(), get_pin_validity_setting(), list_admin_esp32_devices(), PinValidityUpdateRequest, rotate_admin_esp32_secret() (+1 more)

### Community 51 - "v1/auth.py"
Cohesion: 0.10
Nodes (12): delete_account(), get_auth_config(), get_current_user_profile(), get_quick_accounts(), get_reset_warning(), google_oauth_login(), list_available_superusers(), list_clubs() (+4 more)

### Community 67 - "adjudicate_access_request"
Cohesion: 0.11
Nodes (10): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), RequestStatus, SuperUser, AccessRequestCreate, AccessRequestDecision (+2 more)

## Knowledge Gaps
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `utc_now` to `UUID`, `lifecycle_service.py`, `test_inbound_hardware_events_ingestion`, `logs.py`, `v1/admin.py`, `AsyncSession`, `test_lifecycle_and_constraints.py`, `test_db_schema.py`, `v1/spaces.py`, `test_esp32_hardware_interface.py`, `User`, `execute_admin_system_reset`, `ESP32Service`, `SpaceService`, `pins.py`, `init_lifecycle_scheduler`, `esp32.py`, `v1/auth.py`, `Club`, `adjudicate_access_request`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `User` (e.g. with `create_direct_pin()` and `get_active_pin()`) actually correct?**
  _`User` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Should `utc_now` be split into smaller, more focused modules?**
  _Cohesion score 0.11836734693877551 - nodes in this community are weakly interconnected._
- **Why does `WebSocketManager` connect `websocket_endpoint` to `esp32.py`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `UUID` be split into smaller, more focused modules?**
  _Cohesion score 0.13438735177865613 - nodes in this community are weakly interconnected._
- **Why does `User` connect `User` to `utc_now`, `UUID`, `lifecycle_service.py`, `adjudicate_access_request`, `logs.py`, `test_inbound_hardware_events_ingestion`, `v1/admin.py`, `test_lifecycle_and_constraints.py`, `pins.py`, `test_db_schema.py`, `v1/spaces.py`, `deps.py`, `test_esp32_hardware_interface.py`, `esp32.py`, `v1/auth.py`, `SpaceService`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `lifecycle_service.py` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._