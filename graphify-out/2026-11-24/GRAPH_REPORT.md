# Graph Report - PiBAS  (2026-11-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1232 nodes · 3624 edges · 67 communities (41 shown, 26 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 144 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- utc_now
- adjudicate_access_request
- get_account_tag
- esp32.py
- .issue_pin_for_grant
- User
- package.json
- env.py
- compilerOptions
- index.ts
- schemas/auth.py
- compilerOptions
- AsyncSession
- config/spaces.py
- schemas/admin.py
- SpaceService
- UUID
- components/SuperUserDashboard.tsx
- execute_admin_system_reset
- create_user_space_assignment
- schemas/__init__.py
- ESP32Service
- .process_inbound_event
- UserProfile
- ingest_esp32_event
- react
- vite-env.d.ts
- AffiliationClusterModal.tsx
- AsyncSession
- tailwind.config.js
- asyncio
- StudentDashboard.tsx
- a9c15669c747_initial_pibas_schema.py
- notification_service.py
- handle_esp32_websocket_connection
- lucide-react
- websocket_endpoint
- WebSocketManager
- schemas/space.py
- production_exception_handler
- .cleanup_expired_requests
- test_esp32_hardware_interface.py
- fe5f1af294f7_update_models_and_entry_logs.py
- init_lifecycle_scheduler
- purge_person_by_identifier
- seed_initial_data
- compilerOptions
- postcss.config.js
- update_superuser
- environment.yml
- test_concurrent_pin_generation_uniqueness_and_revocation
- c7b2a9e4d1f0_add_registration_request_and_assignment_status.py
- e8c3b1a7d2e9_add_college_year_and_updated_at.py
- stop_rehan.sh script
- Settings
- tailwind.config.js
- sw.js
- vite-env.d.ts
- tailwind.config.js
- start_services.sh
- stop_services.sh
- postcss.config.js

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 76 edges
2. `User` - 61 edges
3. `ESP32Service` - 42 edges
4. `SuperUser` - 42 edges
5. `react` - 39 edges
6. `lucide-react` - 35 edges
7. `Base` - 34 edges
8. `EntryEventType` - 29 edges
9. `PinService` - 29 edges
10. `ActivePin` - 29 edges

## Surprising Connections (you probably didn't know these)
- `test_annual_september_purge_execution()` --uses--> `AccessRequest`  [INFERRED]
  backend/tests/test_lifecycle_and_constraints.py → backend/app/models/access_request.py
- `AccessRequestDecision` --uses--> `RequestStatus`  [INFERRED]
  backend/app/schemas/access_request.py → backend/app/models/access_request.py
- `AccessRequestResponse` --uses--> `RequestStatus`  [INFERRED]
  backend/app/schemas/access_request.py → backend/app/models/access_request.py
- `test_annual_september_purge_execution()` --uses--> `RequestStatus`  [INFERRED]
  backend/tests/test_lifecycle_and_constraints.py → backend/app/models/access_request.py
- `RequestCleanupService` --uses--> `UserSpaceAssignment`  [INFERRED]
  backend/app/services/request_cleanup_service.py → backend/app/models/assignment.py

## Import Cycles
- None detected.

## Communities (67 total, 26 thin omitted)

### Community 0 - "utc_now"
Cohesion: 0.07
Nodes (13): Base, AccessRequest, RequestStatus, ESP32FirmwareRelease, ESP32CommandOutbox, PushSubscription, execute_annual_september_purge(), get_account_tag() (+5 more)

### Community 1 - "adjudicate_access_request"
Cohesion: 0.08
Nodes (9): get_current_actor(), require_admin(), require_root_admin(), require_superuser_or_admin(), get_db(), EntryEventType, LogService, SystemSettingService (+1 more)

### Community 2 - "get_account_tag"
Cohesion: 0.07
Nodes (6): lifespan(), ESP32Device, ESP32Service, test_fresh_setup_detection_and_toggle(), test_on_server_startup_sync_runs_cleanly(), test_purge_all_space_pins()

### Community 3 - "esp32.py"
Cohesion: 0.08
Nodes (43): AddAdminModal(), AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, CopyButton(), ESP32HardwareManagerProps, TotpInfo, CLUSTER_COLORS (+35 more)

### Community 4 - ".issue_pin_for_grant"
Cohesion: 0.09
Nodes (16): sync_esp32_pins(), create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse (+8 more)

### Community 5 - "User"
Cohesion: 0.09
Nodes (14): utc_now(), ActivePin, EntryLog, User, test_active_keys_scoped_strictly_to_superuser_authority(), test_pin_revocation_creates_visible_audit_log(), test_registration_approval_logs_reg_accepted(), test_user_space_assignment_unique_constraint() (+6 more)

### Community 6 - "package.json"
Cohesion: 0.09
Nodes (17): create_superuser(), delete_account(), get_auth_config(), get_current_user_profile(), get_google_oauth_url(), get_quick_accounts(), get_reset_warning(), google_oauth_login() (+9 more)

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 8 - "compilerOptions"
Cohesion: 0.15
Nodes (25): AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, JustificationModalProps, KeypadModal(), KeypadModalProps, Navbar() (+17 more)

### Community 9 - "index.ts"
Cohesion: 0.09
Nodes (15): admin_system_reset(), delete_secondary_admin(), delete_superuser(), delete_user(), get_admin_metrics(), get_emergency_totp_keys(), get_pin_validity_setting(), get_user_directory() (+7 more)

### Community 10 - "schemas/auth.py"
Cohesion: 0.10
Nodes (12): create_secondary_admin(), get_cluster_graph_data(), AdminAccountResponse, AdminCreateRequest, AdminMetricsResponse, AdminSuperUserResponse, ClusterGraphLink, ClusterGraphNode (+4 more)

### Community 11 - "compilerOptions"
Cohesion: 0.16
Nodes (25): AdminDashboard(), AffiliationClusterModal(), CopyButtonProps, ESP32HardwareManager(), ESP32StatusBar(), ESP32StatusBarProps, RegistrationPendingView(), RegistrationPendingViewProps (+17 more)

### Community 12 - "AsyncSession"
Cohesion: 0.09
Nodes (8): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse, NotificationService

### Community 13 - "config/spaces.py"
Cohesion: 0.11
Nodes (4): PinService, test_esp32_keypad_event_logging(), test_esp32_sync_polling_fallback(), test_immediate_pin_revocation_flow()

### Community 14 - "schemas/admin.py"
Cohesion: 0.11
Nodes (21): ConsoleLog, ESP32Simulator(), ExcelSpaceLogs(), ExcelSpaceLogsProps, TimePreset, JustificationModal(), FacilitySpaceConfig, getRegisteredSpacesList() (+13 more)

### Community 15 - "SpaceService"
Cohesion: 0.09
Nodes (12): revoke_superuser(), create_lock_device(), delete_lock_device(), disable_lock_device(), download_firmware_binary(), enable_lock_device(), get_esp32_devices_status(), ingest_esp32_event() (+4 more)

### Community 16 - "UUID"
Cohesion: 0.13
Nodes (22): App(), Toast, AddAdminModalProps, AdminDashboardProps, AuthView(), AuthViewProps, Header(), HeaderProps (+14 more)

### Community 17 - "components/SuperUserDashboard.tsx"
Cohesion: 0.11
Nodes (10): create_facility_space(), create_user_space_assignment(), delete_facility_space(), get_facility_space(), list_facility_spaces(), list_spaces_status(), list_user_space_assignments(), update_facility_space() (+2 more)

### Community 18 - "execute_admin_system_reset"
Cohesion: 0.13
Nodes (11): prune_logs_older_than_three_years(), test_annual_september_purge_rules(), test_concurrent_pin_generation_uniqueness_and_revocation(), issue_single_pin(), test_email_login_routing_and_revoked_superuser(), test_immutable_audit_log_attribution_on_superuser_deletion(), test_unique_user_space_assignment_and_inline_switching(), test_web_push_vapid_and_subscription_flow() (+3 more)

### Community 19 - "create_user_space_assignment"
Cohesion: 0.12
Nodes (7): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), AccessRequestCreate, AccessRequestDecision, AccessRequestResponse

### Community 20 - "schemas/__init__.py"
Cohesion: 0.11
Nodes (11): ActiveKeySummaryResponse, ActivePinSummary, ClubResponse, EmailLoginRequest, PendingRequestSummary, PreResetWarningResponse, SuperUserInfoResponse, TokenResponse (+3 more)

### Community 21 - "ESP32Service"
Cohesion: 0.11
Nodes (5): esp32_hardware_websocket(), websocket_endpoint(), get_all_space_slugs(), get_space_by_slug(), handle_esp32_websocket_connection()

### Community 22 - ".process_inbound_event"
Cohesion: 0.14
Nodes (7): test_handshake_invalid_signature_rejection(), test_handshake_replay_drift_rejection(), test_handshake_successful_authentication(), test_handshake_unknown_space_rejection(), test_hardware_monitoring_role_restrictions(), test_ota_firmware_upload_download_and_secret_rotation(), test_outbox_persistence_and_ws_flush()

### Community 23 - "UserProfile"
Cohesion: 0.13
Nodes (5): seed_initial_data(), Admin, Space, SystemSetting, test_system_reset_execution_and_orphan_purge()

### Community 24 - "ingest_esp32_event"
Cohesion: 0.13
Nodes (6): EntryLogResponse, SpaceBase, SpaceCreate, SpaceResponse, SpaceStatusResponse, SpaceUpdate

### Community 25 - "react"
Cohesion: 0.12
Nodes (3): add_no_cache_headers_for_api(), production_exception_handler(), spa_fallback()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.16
Nodes (4): register_dynamic_space(), unregister_space(), SpaceService, test_create_and_reregister_space()

### Community 27 - "AffiliationClusterModal.tsx"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 28 - "AsyncSession"
Cohesion: 0.17
Nodes (10): create_access_token(), configure_test_db_settings(), configure_test_environment(), run_db_migrations(), root_admin_token(), superuser_token(), user_token(), regular_user_token() (+2 more)

### Community 30 - "asyncio"
Cohesion: 0.14
Nodes (3): PinValidityUpdateRequest, update_pin_validity_setting(), scheduled_request_cleanup_job()

### Community 31 - "StudentDashboard.tsx"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 32 - "a9c15669c747_initial_pibas_schema.py"
Cohesion: 0.15
Nodes (7): upload_firmware_binary(), get_registered_spaces(), index_root(), init_lifecycle_scheduler(), scheduled_3yr_log_prune_job(), scheduled_esp32_heartbeat_job(), scheduled_purge_job()

### Community 33 - "notification_service.py"
Cohesion: 0.16
Nodes (4): download_offline_archive(), export_audit_logs_csv(), list_entry_logs(), trigger_admin_system_reset()

### Community 34 - "handle_esp32_websocket_connection"
Cohesion: 0.18
Nodes (4): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online()

### Community 36 - "websocket_endpoint"
Cohesion: 0.18
Nodes (5): get_space_by_device_id(), test_lookup_by_device_id(), test_registered_spaces_presence(), test_space_creation_deletion_and_recreation(), test_space_metadata_integrity()

### Community 37 - "WebSocketManager"
Cohesion: 0.22
Nodes (5): update_superuser(), UserSpaceAssignment, get_token(), test_fixes(), test_suite()

### Community 38 - "schemas/space.py"
Cohesion: 0.27
Nodes (7): test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins(), test_reappoint_revoked_superuser_and_existing_user_sync(), test_secondary_admin_lifecycle_and_root_protection(), test_shared_logs_universal_visibility_and_csv_export(), test_superuser_admin_management_and_revocation(), test_settings_base_dir_accessible()

### Community 39 - "production_exception_handler"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 41 - "test_esp32_hardware_interface.py"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.29
Nodes (3): test_facility_spaces_seeded(), test_pin_generation_uniqueness(), test_root_admin_seeded()

### Community 45 - "seed_initial_data"
Cohesion: 0.33
Nodes (5): channels, dependencies, pip, name, prefix

## Knowledge Gaps
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `User` to `utc_now`, `adjudicate_access_request`, `get_account_tag`, `.issue_pin_for_grant`, `package.json`, `index.ts`, `schemas/auth.py`, `config/spaces.py`, `SpaceService`, `components/SuperUserDashboard.tsx`, `execute_admin_system_reset`, `create_user_space_assignment`, `ESP32Service`, `.process_inbound_event`, `UserProfile`, `vite-env.d.ts`, `asyncio`, `a9c15669c747_initial_pibas_schema.py`, `notification_service.py`, `WebSocketManager`, `init_lifecycle_scheduler`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `User` (e.g. with `get_current_user_profile()` and `get_quick_accounts()`) actually correct?**
  _`User` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Should `utc_now` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Why does `ESP32Service` connect `get_account_tag` to `a9c15669c747_initial_pibas_schema.py`, `adjudicate_access_request`, `utc_now`, `User`, `schemas/auth.py`, `purge_person_by_identifier`, `SpaceService`, `.process_inbound_event`, `react`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `ESP32Service` (e.g. with `disable_lock_device()` and `enable_lock_device()`) actually correct?**
  _`ESP32Service` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Should `adjudicate_access_request` be split into smaller, more focused modules?**
  _Cohesion score 0.07945566286215978 - nodes in this community are weakly interconnected._
- **Why does `User` connect `User` to `utc_now`, `adjudicate_access_request`, `.issue_pin_for_grant`, `package.json`, `schemas/auth.py`, `config/spaces.py`, `components/SuperUserDashboard.tsx`, `execute_admin_system_reset`, `create_user_space_assignment`, `.process_inbound_event`, `vite-env.d.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._