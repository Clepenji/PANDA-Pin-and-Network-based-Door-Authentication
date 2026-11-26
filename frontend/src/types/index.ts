/**
 * Type definitions for PANDA frontend application.
 */

export type UserRole = 'admin' | 'superuser' | 'user';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  is_root?: boolean;
  club_name?: string;
  college_year?: string;
  note?: string | null;
  authorized_spaces?: string[];
}

export interface AssignedLock {
  id: string;
  device_id: string;
  name: string;
  is_online: boolean;
  is_disabled: boolean;
  firmware_version?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  last_seen_at?: string | null;
  last_ping_ms?: number | null;
}

export interface FacilitySpace {
  id: string;
  slug: string;
  name: string;
  esp32_device_id?: string;
  is_active: boolean;
  assigned_devices?: AssignedLock[];
}

export interface SpaceStatus {
  slug: string;
  name: string;
  is_active: boolean;
  door_locked: boolean;
  active_pin_count: number;
  pending_request_count: number;
}

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AccessRequest {
  id: string;
  requester_email: string;
  requester_name: string;
  requester_phone?: string;
  requester_college_year?: string;
  club_name?: string;
  club_name_snapshot?: string;
  space_id?: string;
  space_slug?: string;
  space_name?: string;
  justification: string;
  status: RequestStatus;
  request_type?: 'ACCESS' | 'REGISTRATION';
  target_superuser_id?: string;
  superuser_id?: string;
  resolved_by_superuser_id?: string;
  resolved_by_name_snapshot?: string;
  created_at: string;
  resolved_at?: string;
}

export interface ActivePin {
  id: string;
  pin_code: string;
  space_slug: string;
  space_name: string;
  holder_email: string;
  holder_name: string;
  approver_name: string;
  issued_at: string;
  expires_at: string;
  is_revoked: boolean;
  remaining_seconds: number;
}

export type PortalEventType =
  | 'ACCESS_GRANTED'
  | 'ACCESS_REJECTED'
  | 'REQUEST_REJECTED'
  | 'DOOR_OPENED'
  | 'DOOR_UNLOCKED';

export interface PortalLog {
  id: string;
  event_type: PortalEventType | string;
  actor_email: string;
  actor_name: string;
  authority_name: string;
  authority_email?: string;
  club_name?: string;
  space_id?: string;
  space_name: string;
  door_name?: string;
  device_id?: string;
  justification?: string;
  justification_snapshot?: string;
  created_at: string;
}

export interface ESP32SyncPinItem {
  pin: string;
  expires_at: string;
  holder_name: string;
  holder_email: string;
}

export interface ESP32SyncResponse {
  space_id: string;
  synced_at: string;
  pins: ESP32SyncPinItem[];
}

export interface ESP32EventRequest {
  space_id: string;
  pin_entered: string;
  timestamp?: string;
  door_unlocked?: boolean;
}

export interface ESP32EventResponse {
  status: string;
  event_recorded: string;
  granted: boolean;
  message: string;
  space_id: string;
}

export interface RevokePinResponse {
  id: string;
  pin_code: string;
  space_id: string;
  revoked_at: string;
  message: string;
}

export interface Club {
  id: string;
  name: string;
}

export interface SuperUserInfo {
  id: string;
  name: string;
  email: string;
  phone: string;
  college_year?: string;
  club_name?: string;
  allowed_spaces: string[];
  note?: string | null;
}

export interface ActivePinSummary {
  id: string;
  pin_code?: string;
  expires_at: string;
  valid_till: string;
}

export interface PendingRequestSummary {
  id: string;
  justification: string;
  created_at: string;
}

export interface UserSpaceCard {
  space_id: string;
  space_name: string;
  assigned_superuser_id?: string;
  assigned_superuser_name?: string;
  assigned_superuser_phone?: string;
  active_pin?: ActivePinSummary | null;
  pending_request?: PendingRequestSummary | null;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface ActiveKeySummary {
  id: string;
  holder_name: string;
  holder_email: string;
  space_id: string;
  space_name: string;
  expires_at: string;
  valid_till: string;
  account_tag?: string | null;
  can_revoke: boolean;
}

export interface ResetWarningInfo {
  is_warning_active: boolean;
  warning_message?: string | null;
}

export interface AdminMetrics {
  total_registered_users: number;
  weekly_entries_per_space: Record<string, number>;
  weekly_entries_space_names: Record<string, string>;
  avg_access_requests_per_day: number;
}

export interface SecondaryAdmin {
  id: string;
  name: string;
  email: string;
  is_root: boolean;
  created_at: string;
}

export interface AdminSuperUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  college_year?: string;
  club_id?: string | null;
  club_name?: string | null;
  allowed_spaces: string[];
  is_active: boolean;
  account_tag?: string | null;
  note?: string | null;
  created_at: string;
}

export interface DirectoryMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'superuser';
  college_year?: string;
  club_id?: string | null;
  club_name?: string | null;
  spaces: string[];
  assigned_superuser_ids?: string[];
  assigned_superusers?: Array<{ space_id: string; superuser_id: string; superuser_name?: string }>;
  is_active: boolean;
  account_tag?: string | null;
  note?: string | null;
  created_at: string;
}

export interface ClusterGraphNode {
  id: string;
  name: string;
  role: 'club' | 'superuser' | 'user';
  college_year?: string;
  club_id?: string | null;
  club_name?: string | null;
  phone?: string | null;
  email?: string | null;
  spaces?: string[];
  assigned_superuser_ids?: string[];
  assigned_superusers?: Array<{ space_id: string; superuser_id: string; superuser_name?: string }>;
  is_active?: boolean;
  member_count?: number | null;
  note?: string | null;
  // D3 force simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface ClusterGraphLink {
  source: string | ClusterGraphNode;
  target: string | ClusterGraphNode;
  relation: string;
}

export interface ClusterGraphData {
  nodes: ClusterGraphNode[];
  links: ClusterGraphLink[];
}

export interface ESP32DeviceStatus {
  id?: string;
  device_id?: string;
  name?: string;
  space_id: string;
  space_name?: string;
  is_online: boolean;
  last_seen_at?: string | null;
  last_ping_ms?: number | null;
  firmware_version?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  is_disabled?: boolean;
  disabled_reason?: string | null;
}

export interface ESP32AdminDevice {
  id: string;
  device_id?: string;
  name?: string;
  space_id: string;
  space_name?: string;
  device_secret: string;
  is_disabled?: boolean;
  disabled_by_email?: string | null;
  disabled_reason?: string | null;
  totp_pin?: string;
  totp_remaining_seconds?: number;
  totp_time_step?: number;
  totp_valid_till?: number;
  is_online: boolean;
  last_seen_at?: string | null;
  last_ping_ms?: number | null;
  firmware_version?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  created_at: string;
}

export interface ESP32FirmwareRelease {
  id: string;
  version: string;
  filename: string;
  sha256_checksum: string;
  target_space_id: string;
  uploaded_by_email: string;
  created_at: string;
}

export interface ESP32PingResponse {
  space_id: string;
  is_online: boolean;
  ping_ms?: number | null;
  last_seen_at?: string | null;
  message: string;
}


