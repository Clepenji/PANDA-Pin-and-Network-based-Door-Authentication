# Graph Report - PANDA  (2026-11-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1348 nodes · 3899 edges · 84 communities (49 shown, 35 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 116 edges (avg confidence: 0.93)
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
- vite-env.d.ts
- run_rehan.sh
- c7b2a9e4d1f0_add_registration_request_and_assignment_status.py
- e8c3b1a7d2e9_add_college_year_and_updated_at.py
- ingest_esp32_event
- stop_rehan.sh script
- Settings
- scan_value_for_sqli
- deploy_to_pi.sh
- .connect
- vite-env.d.ts
- run_rehan.sh
- setup_and_run.sh
- setup_rehan.sh
- start_services.sh
- stop_services.sh

## God Nodes (most connected - your core abstractions)
1. `utc_now()` - 76 edges
2. `User` - 57 edges
3. `ESP32Service` - 47 edges
4. `react` - 39 edges
5. `SuperUser` - 37 edges
6. `lucide-react` - 35 edges
7. `Base` - 34 edges
8. `ESP32Device` - 32 edges
9. `api` - 30 edges
10. `ActivePin` - 29 edges

## Surprising Connections (you probably didn't know these)
- `create_direct_pin()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `list_active_pins_for_management()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `revoke_active_pin()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `verify_keypad_entry()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/pins.py → backend/app/services/pin_service.py
- `adjudicate_access_request()` --uses--> `PinService`  [INFERRED]
  backend/app/api/v1/requests.py → backend/app/services/pin_service.py

## Import Cycles
- None detected.

## Communities (84 total, 35 thin omitted)

### Community 0 - "utc_now"
Cohesion: 0.07
Nodes (24): ActivePin, EntryEventType, EntryLog, User, execute_annual_september_purge(), prune_logs_older_than_three_years(), PinService, test_active_keys_scoped_strictly_to_superuser_authority() (+16 more)

### Community 1 - "adjudicate_access_request"
Cohesion: 0.07
Nodes (12): register_dynamic_space(), seed_initial_data(), Admin, ESP32Device, Space, SuperUser, reset_database(), ensure_hardware_test_space() (+4 more)

### Community 2 - "get_account_tag"
Cohesion: 0.09
Nodes (4): require_superuser_or_admin(), get_db(), RequestStatus, Club

### Community 3 - "esp32.py"
Cohesion: 0.14
Nodes (3): Base, utc_now(), ESP32CommandOutbox

### Community 4 - ".issue_pin_for_grant"
Cohesion: 0.09
Nodes (15): sync_esp32_pins(), create_direct_pin(), get_active_pin(), list_active_keys_privacy(), list_active_pins_for_management(), revoke_active_pin(), verify_keypad_entry(), ActivePinResponse (+7 more)

### Community 5 - "User"
Cohesion: 0.07
Nodes (17): list_available_superusers(), list_clubs(), update_user_space_assignment(), ActiveKeySummaryResponse, ActivePinSummary, ClubResponse, EmailLoginRequest, PendingRequestSummary (+9 more)

### Community 6 - "package.json"
Cohesion: 0.14
Nodes (29): AddSuperUserModal(), AddSuperUserModalProps, ClubSelector(), ClubSelectorProps, CopyButtonProps, JustificationModal(), JustificationModalProps, KeypadModal() (+21 more)

### Community 7 - "env.py"
Cohesion: 0.07
Nodes (37): dependencies, clsx@^2.1.1, d3@^7.9.2, lucide-react@^0.475.0, react@^18.3.1, react-dom@^18.3.1, tailwind-merge@^3.0.1, @types/d3@^7.4.3 (+29 more)

### Community 8 - "compilerOptions"
Cohesion: 0.10
Nodes (6): ESP32FirmwareRelease, SystemSetting, LogService, SystemSettingService, TotpService, test_batch_logs_disregarded_on_fresh_setup()

### Community 9 - "index.ts"
Cohesion: 0.09
Nodes (8): get_vapid_public_key(), send_diagnostic_test_alert(), subscribe_for_push(), NotificationTestResponse, PushSubscriptionCreate, PushSubscriptionKeys, VapidPublicKeyResponse, NotificationService

### Community 10 - "schemas/auth.py"
Cohesion: 0.10
Nodes (27): AffiliationClusterModalProps, ClusterPosition, MemberNodePosition, CopyButton(), ExcelSpaceLogs(), ExcelSpaceLogsProps, TimePreset, CLUSTER_COLORS (+19 more)

### Community 11 - "compilerOptions"
Cohesion: 0.12
Nodes (23): App(), Toast, AdminDashboardProps, AuthView(), AuthViewProps, Header(), HeaderProps, KeypadSimulator() (+15 more)

### Community 12 - "AsyncSession"
Cohesion: 0.12
Nodes (25): ESP32HardwareManagerProps, TotpInfo, ESP32StatusBarProps, RegistrationPendingView(), RegistrationPendingViewProps, StudentDashboard(), AccessRequest, ActivePin (+17 more)

### Community 13 - "config/spaces.py"
Cohesion: 0.10
Nodes (12): get_auth_config(), get_google_oauth_url(), create_lock_device(), delete_lock_device(), disable_lock_device(), download_firmware_binary(), enable_lock_device(), get_esp32_devices_status() (+4 more)

### Community 14 - "schemas/admin.py"
Cohesion: 0.12
Nodes (10): FacilitySpaceDefinition, get_all_space_slugs(), get_space_by_device_id(), get_space_by_slug(), reset_to_default_spaces(), unregister_space(), test_lookup_by_device_id(), test_registered_spaces_presence() (+2 more)

### Community 15 - "SpaceService"
Cohesion: 0.11
Nodes (12): delete_account(), get_current_user_profile(), get_quick_accounts(), google_oauth_login(), login_with_email(), record_account_login(), register_user(), update_profile() (+4 more)

### Community 16 - "UUID"
Cohesion: 0.20
Nodes (21): AddAdminModal(), AddAdminModalProps, AdminDashboard(), AffiliationClusterModal(), ESP32HardwareManager(), ESP32StatusBar(), SuperUserDashboard(), ActiveKeySummary (+13 more)

### Community 17 - "components/SuperUserDashboard.tsx"
Cohesion: 0.12
Nodes (10): get_admin_metrics(), get_emergency_totp_keys(), get_pin_validity_setting(), get_user_directory(), list_admin_esp32_devices(), list_firmware_releases(), list_secondary_admins(), lookup_registered_user() (+2 more)

### Community 18 - "execute_admin_system_reset"
Cohesion: 0.14
Nodes (5): update_facility_space(), SpaceResponse, SpaceService, test_facility_spaces_seeded(), test_create_and_reregister_space()

### Community 19 - "create_user_space_assignment"
Cohesion: 0.10
Nodes (13): test_user_note_registration_profile_and_validity(), test_delete_shadow_device_by_uuid_or_space_id(), test_settings_base_dir_accessible(), _root_token(), _std_admin_token(), test_auth_login_and_me_include_full_profile_for_prefill(), test_emergency_totp_fixed_24h_independent_of_pin_validity(), test_factory_reset_root_only_zero_state() (+5 more)

### Community 21 - "ESP32Service"
Cohesion: 0.13
Nodes (3): test_esp32_sync_polling_fallback(), test_concurrent_pin_generation_uniqueness_and_revocation(), issue_single_pin()

### Community 23 - "UserProfile"
Cohesion: 0.13
Nodes (12): ConsoleLog, ESP32Simulator(), FacilitySpaceConfig, getRegisteredSpacesList(), REGISTERED_SPACES, AuthProvider(), SpaceContext, SpaceContextType (+4 more)

### Community 25 - "react"
Cohesion: 0.15
Nodes (7): create_facility_space(), create_user_space_assignment(), delete_facility_space(), get_facility_space(), list_facility_spaces(), list_spaces_status(), list_user_space_assignments()

### Community 26 - "vite-env.d.ts"
Cohesion: 0.16
Nodes (7): delete_secondary_admin(), list_admin_superusers(), PinValidityUpdateRequest, revoke_superuser(), update_pin_validity_setting(), update_superuser(), AdminSuperUserResponse

### Community 27 - "AffiliationClusterModal.tsx"
Cohesion: 0.15
Nodes (5): AssignedLockSummary, SpaceBase, SpaceCreate, SpaceStatusResponse, SpaceUpdate

### Community 28 - "AsyncSession"
Cohesion: 0.14
Nodes (7): _root_headers(), test_benign_apostrophes_and_semicolons_still_work(), test_database_error_does_not_leak_sql_details(), test_middleware_blocks_sqli_in_query_path_and_body(), test_schema_validation_rejects_malformed_identifiers(), test_sqli_detector_allows_benign_inputs(), test_sqli_detector_catches_malicious_payloads()

### Community 29 - "tailwind.config.js"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 30 - "asyncio"
Cohesion: 0.13
Nodes (4): AccessRequest, UserSpaceAssignment, PushSubscription, RequestCleanupService

### Community 31 - "StudentDashboard.tsx"
Cohesion: 0.17
Nodes (7): get_cluster_graph_data(), AdminAccountResponse, AdminMetricsResponse, ClusterGraphLink, ClusterGraphNode, ClusterGraphResponse, DirectoryMemberResponse

### Community 32 - "a9c15669c747_initial_pibas_schema.py"
Cohesion: 0.13
Nodes (5): download_offline_archive(), export_audit_logs_csv(), list_entry_logs(), trigger_admin_system_reset(), EntryLogResponse

### Community 33 - "notification_service.py"
Cohesion: 0.17
Nodes (5): adjudicate_access_request(), create_access_request(), delete_access_request(), list_access_requests(), AccessRequestResponse

### Community 34 - "handle_esp32_websocket_connection"
Cohesion: 0.15
Nodes (7): test_handshake_invalid_signature_rejection(), test_handshake_replay_drift_rejection(), test_handshake_successful_authentication(), test_handshake_unknown_space_rejection(), test_hardware_monitoring_role_restrictions(), test_inbound_hardware_events_ingestion(), test_outbox_persistence_and_ws_flush()

### Community 35 - "lucide-react"
Cohesion: 0.15
Nodes (4): do_run_migrations(), run_async_migrations(), run_migrations_offline(), run_migrations_online()

### Community 36 - "websocket_endpoint"
Cohesion: 0.17
Nodes (8): get_registered_spaces(), lifespan(), execute_admin_system_reset(), execute_factory_reset(), init_lifecycle_scheduler(), scheduled_3yr_log_prune_job(), scheduled_esp32_heartbeat_job(), scheduled_purge_job()

### Community 37 - "WebSocketManager"
Cohesion: 0.21
Nodes (3): AdminCreateRequest, SuperUserCreateRequest, SuperUserUpdateRequest

### Community 38 - "schemas/space.py"
Cohesion: 0.14
Nodes (6): downgrade(), upgrade(), downgrade(), upgrade(), downgrade(), upgrade()

### Community 40 - ".cleanup_expired_requests"
Cohesion: 0.15
Nodes (4): contains_null_byte(), _decode_variants(), _empty_receive(), _get_header()

### Community 42 - "fe5f1af294f7_update_models_and_entry_logs.py"
Cohesion: 0.17
Nodes (5): admin_system_reset(), create_secondary_admin(), create_superuser(), upload_firmware_binary(), detect_sql_injection()

### Community 46 - "compilerOptions"
Cohesion: 0.25
Nodes (7): create_access_token(), root_admin_token(), superuser_token(), user_token(), regular_user_token(), root_admin_token(), superuser_sandboxx_0_token()

### Community 47 - "postcss.config.js"
Cohesion: 0.20
Nodes (3): add_no_cache_headers_for_api(), production_exception_handler(), sqlalchemy_exception_handler()

### Community 48 - "update_superuser"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 49 - "environment.yml"
Cohesion: 0.20
Nodes (3): get_current_actor(), require_admin(), require_root_admin()

### Community 50 - "test_concurrent_pin_generation_uniqueness_and_revocation"
Cohesion: 0.22
Nodes (3): test_fresh_setup_detection_and_toggle(), test_on_server_startup_sync_runs_cleanly(), test_purge_all_space_pins()

### Community 52 - "e8c3b1a7d2e9_add_college_year_and_updated_at.py"
Cohesion: 0.36
Nodes (6): test_admin_metrics(), test_directory_and_cluster_graph_exclude_admins(), test_reappoint_revoked_superuser_and_existing_user_sync(), test_secondary_admin_lifecycle_and_root_protection(), test_shared_logs_universal_visibility_and_csv_export(), test_superuser_admin_management_and_revocation()

### Community 54 - "Settings"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 55 - "tailwind.config.js"
Cohesion: 0.33
Nodes (3): delete_superuser(), delete_user(), purge_person_by_identifier()

### Community 56 - "sw.js"
Cohesion: 0.29
Nodes (3): configure_test_db_settings(), configure_test_environment(), run_db_migrations()

### Community 57 - "vite-env.d.ts"
Cohesion: 0.33
Nodes (3): get_reset_warning(), get_pre_reset_warning(), test_pre_reset_warning_banner()

### Community 58 - "tailwind.config.js"
Cohesion: 0.33
Nodes (5): channels, dependencies, pip, name, prefix

## Knowledge Gaps
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `utc_now()` connect `esp32.py` to `utc_now`, `adjudicate_access_request`, `get_account_tag`, `.issue_pin_for_grant`, `User`, `compilerOptions`, `config/spaces.py`, `SpaceService`, `components/SuperUserDashboard.tsx`, `execute_admin_system_reset`, `schemas/__init__.py`, `ESP32Service`, `.process_inbound_event`, `ingest_esp32_event`, `react`, `vite-env.d.ts`, `asyncio`, `a9c15669c747_initial_pibas_schema.py`, `notification_service.py`, `handle_esp32_websocket_connection`, `production_exception_handler`, `fe5f1af294f7_update_models_and_entry_logs.py`, `c7b2a9e4d1f0_add_registration_request_and_assignment_status.py`, `vite-env.d.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `User` (e.g. with `create_user_space_assignment()` and `list_user_space_assignments()`) actually correct?**
  _`User` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `utc_now` be split into smaller, more focused modules?**
  _Cohesion score 0.0673903211216644 - nodes in this community are weakly interconnected._
- **Why does `ESP32Service` connect `ingest_esp32_event` to `utc_now`, `adjudicate_access_request`, `handle_esp32_websocket_connection`, `esp32.py`, `websocket_endpoint`, `compilerOptions`, `fe5f1af294f7_update_models_and_entry_logs.py`, `purge_person_by_identifier`, `config/spaces.py`, `components/SuperUserDashboard.tsx`, `test_concurrent_pin_generation_uniqueness_and_revocation`, `schemas/__init__.py`, `.process_inbound_event`, `vite-env.d.ts`, `asyncio`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `ESP32Service` (e.g. with `get_emergency_totp_keys()` and `list_admin_esp32_devices()`) actually correct?**
  _`ESP32Service` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Should `adjudicate_access_request` be split into smaller, more focused modules?**
  _Cohesion score 0.07474600870827286 - nodes in this community are weakly interconnected._
- **Why does `User` connect `utc_now` to `notification_service.py`, `get_account_tag`, `esp32.py`, `.issue_pin_for_grant`, `User`, `adjudicate_access_request`, `handle_esp32_websocket_connection`, `compilerOptions`, `fe5f1af294f7_update_models_and_entry_logs.py`, `SpaceService`, `create_user_space_assignment`, `ESP32Service`, `react`, `vite-env.d.ts`, `asyncio`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._