/**
 * API client for interacting with PANDA FastAPI backend.
 */

import {
  UserProfile,
  SpaceStatus,
  AccessRequest,
  ActivePin,
  PortalLog,
  RequestStatus,
  Club,
  SuperUserInfo,
  UserSpaceCard,
  ActiveKeySummary,
  ResetWarningInfo,
  AdminMetrics,
  SecondaryAdmin,
  AdminSuperUser,
  DirectoryMember,
  ClusterGraphData,
  ESP32DeviceStatus,
  ESP32AdminDevice,
  ESP32FirmwareRelease,
  ESP32PingResponse,
} from '../types';

const API_BASE = '/api/v1';

// Wrap fetch so any 401 while a token is stored immediately invalidates the active session.
const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await window.fetch(input, init);
  if (res.status === 401 && localStorage.getItem('panda_token')) {
    window.dispatchEvent(new CustomEvent('panda:unauthorized'));
  }
  return res;
};

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('panda_token');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const api = {
  async loginWithEmail(email: string): Promise<{
    access_token: string;
    token_type: string;
    role: string;
    email: string;
    name: string;
    phone?: string;
    club_name?: string;
    college_year?: string;
    note?: string | null;
    is_root: boolean;
    authorized_spaces: string[];
  }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to authenticate');
    }
    return res.json();
  },

  async fetchProfile(): Promise<UserProfile> {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('panda:unauthorized'));
      throw new Error('Session expired or invalidated');
    }
    if (!res.ok) throw new Error('Failed to load profile');
    return res.json();
  },

  async fetchSpaces(): Promise<Array<{
    id: string;
    slug: string;
    name: string;
    esp32_device_id: string;
    is_active: boolean;
  }>> {
    const res = await fetch(`${API_BASE}/spaces?_t=${Date.now()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to fetch spaces');
    return res.json();
  },

  async createSpace(payload: {
    slug: string;
    name: string;
    lock_name?: string;
    esp32_device_id?: string;
    is_active?: boolean;
  }): Promise<{
    id: string;
    slug: string;
    name: string;
    esp32_device_id?: string;
    is_active: boolean;
    assigned_devices?: Array<{ device_id: string; name: string; is_online: boolean; is_disabled: boolean }>;
  }> {
    const res = await fetch(`${API_BASE}/spaces`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register new facility space');
    }
    return res.json();
  },

  async fetchSpacesStatus(): Promise<SpaceStatus[]> {
    const res = await fetch(`${API_BASE}/spaces/status?_t=${Date.now()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to fetch space statuses');
    return res.json();
  },

  async fetchRequests(spaceSlug?: string, status?: RequestStatus, scope?: string): Promise<AccessRequest[]> {
    const params = new URLSearchParams();
    if (spaceSlug) params.append('space_slug', spaceSlug);
    if (status) params.append('status_filter', status);
    if (scope) params.append('scope', scope);

    const res = await fetch(`${API_BASE}/requests?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch access requests');
    return res.json();
  },

  async createRequest(spaceSlug: string, justification: string, targetSuperuserId?: string): Promise<AccessRequest> {
    const res = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        space_slug: spaceSlug,
        justification,
        ...(targetSuperuserId ? { target_superuser_id: targetSuperuserId } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to submit request');
    }
    return res.json();
  },

  async adjudicateRequest(requestId: string, status: RequestStatus): Promise<AccessRequest> {
    const res = await fetch(`${API_BASE}/requests/${requestId}/decision`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to adjudicate request');
    }
    return res.json();
  },

  async deleteRequest(requestId: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/requests/${requestId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete access request');
    }
    return res.json();
  },

  async fetchActivePin(spaceSlug: string): Promise<ActivePin | null> {
    const res = await fetch(`${API_BASE}/pins/active?space_slug=${encodeURIComponent(spaceSlug)}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch active PIN');
    return res.json();
  },

  async verifyKeypad(deviceId: string, pinCode: string): Promise<{
    granted: boolean;
    message: string;
    space_slug?: string;
    unlock_duration_seconds: number;
  }> {
    const res = await fetch(`${API_BASE}/pins/verify-keypad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, pin_code: pinCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to verify keypad');
    }
    return res.json();
  },

  async fetchPortalLogs(
    spaceSlug?: string,
    startDate?: string,
    endDate?: string,
    limit: number = 500,
    clubName?: string,
    eventType?: string
  ): Promise<PortalLog[]> {
    const params = new URLSearchParams();
    if (spaceSlug && spaceSlug !== 'all') params.append('space_slug', spaceSlug);
    if (clubName && clubName !== 'all') params.append('club_name', clubName);
    if (eventType && eventType !== 'all') params.append('event_type', eventType);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    params.append('limit', limit.toString());

    const res = await fetch(`${API_BASE}/logs/portal?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch portal logs');
    return res.json();
  },

  getAuditLogsCsvUrl(): string {
    return `${API_BASE}/logs/audit/csv`;
  },

  async downloadAuditLogsCsv(): Promise<void> {
    const res = await fetch(`${API_BASE}/logs/audit/csv`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to download internal audit CSV');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panda_internal_audit_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  async syncEsp32Pins(spaceId: string): Promise<{ space_id: string; synced_at: string; pins: Array<{ pin: string; expires_at: string; holder_name: string; holder_email: string }> }> {
    const res = await fetch(`/api/esp32/${encodeURIComponent(spaceId)}/sync`);
    if (!res.ok) throw new Error('Failed to synchronize ESP32 PIN memory');
    return res.json();
  },

  async sendEsp32Event(payload: {
    space_id: string;
    pin_entered: string;
    timestamp?: string;
    door_unlocked?: boolean;
  }): Promise<{
    status: string;
    event_recorded: string;
    granted: boolean;
    message: string;
    space_id: string;
  }> {
    const res = await fetch('/api/esp32/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to submit ESP32 keypad event');
    }
    return res.json();
  },

  async revokePin(pinId: string): Promise<{ id: string; pin_code: string; space_id: string; revoked_at: string; message: string }> {
    const res = await fetch(`${API_BASE}/pins/${pinId}/revoke`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to revoke PIN');
    }
    return res.json();
  },

  async directIssuePin(spaceId: string, entrantEmail: string, justification?: string): Promise<ActivePin> {
    const res = await fetch(`${API_BASE}/pins/direct`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ space_id: spaceId, entrant_email: entrantEmail, justification }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to issue direct PIN');
    }
    return res.json();
  },

  async fetchActivePinsList(spaceSlug: string): Promise<ActivePin[]> {
    const res = await fetch(`${API_BASE}/pins/active-list?space_slug=${encodeURIComponent(spaceSlug)}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch active PINs list');
    return res.json();
  },

  async register(payload: {
    email: string;
    name: string;
    phone: string;
    college_year?: string;
    club_name?: string;
    space_id?: string;
    assigned_superuser_id?: string;
    note?: string;
    oauth_registration_token?: string;
  }): Promise<{
    access_token: string;
    token_type: string;
    role: string;
    email: string;
    name: string;
    phone?: string;
    club_name?: string;
    college_year?: string;
    note?: string | null;
    is_root: boolean;
    authorized_spaces: string[];
    account_tag?: string | null;
  }> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Registration failed');
    }
    return res.json();
  },

  async updateProfile(payload: { name?: string; phone?: string; college_year?: string; club_name?: string; note?: string }): Promise<UserProfile> {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update profile');
    }
    return res.json();
  },

  async deleteAccount(): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/auth/account`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete account');
    }
    return res.json();
  },

  async fetchSuperUsers(): Promise<SuperUserInfo[]> {
    const res = await fetch(`${API_BASE}/auth/superusers`);
    if (!res.ok) throw new Error('Failed to fetch superusers list');
    return res.json();
  },

  async fetchClubs(): Promise<Club[]> {
    const res = await fetch(`${API_BASE}/auth/clubs`);
    if (!res.ok) throw new Error('Failed to fetch clubs list');
    return res.json();
  },

  async fetchUserSpaceCards(): Promise<UserSpaceCard[]> {
    const res = await fetch(`${API_BASE}/spaces/user/assignments`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch user space cards');
    return res.json();
  },

  async createUserSpaceCard(payload: { space_id: string; assigned_superuser_id?: string }): Promise<UserSpaceCard> {
    const res = await fetch(`${API_BASE}/spaces/user/assignments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register additional facility space');
    }
    return res.json();
  },

  async updateUserSpaceCard(spaceId: string, assignedSuperUserId?: string): Promise<UserSpaceCard> {
    const res = await fetch(`${API_BASE}/spaces/user/assignments/${encodeURIComponent(spaceId)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ assigned_superuser_id: assignedSuperUserId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update assigned SuperUser');
    }
    return res.json();
  },

  async fetchActiveKeys(): Promise<ActiveKeySummary[]> {
    const res = await fetch(`${API_BASE}/pins/active-keys`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch active keys');
    return res.json();
  },

  async fetchResetWarning(): Promise<ResetWarningInfo> {
    const res = await fetch(`${API_BASE}/auth/warning`);
    if (!res.ok) throw new Error('Failed to fetch reset warning');
    return res.json();
  },

  async fetchQuickAccounts(): Promise<Array<{
    email: string;
    name: string;
    role: string;
    is_root: boolean;
    badge: string;
    subtitle: string;
    last_login: string;
  }>> {
    const res = await fetch(`${API_BASE}/auth/quick-accounts`);
    if (!res.ok) throw new Error('Failed to fetch quick accounts');
    return res.json();
  },

  async fetchAdminMetrics(): Promise<AdminMetrics> {
    const res = await fetch(`${API_BASE}/admin/metrics`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch operational metrics');
    return res.json();
  },

  async fetchSecondaryAdmins(): Promise<SecondaryAdmin[]> {
    const res = await fetch(`${API_BASE}/admin/admins`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch secondary admins');
    return res.json();
  },

  async createSecondaryAdmin(payload: { name: string; email: string; is_root?: boolean }): Promise<SecondaryAdmin> {
    const res = await fetch(`${API_BASE}/admin/admins`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create secondary admin');
    }
    return res.json();
  },

  async deleteSecondaryAdmin(adminId: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/admin/admins/${encodeURIComponent(adminId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete administrator');
    }
    return res.json();
  },

  async fetchAdminSuperUsers(): Promise<AdminSuperUser[]> {
    const res = await fetch(`${API_BASE}/admin/superusers`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch superusers for admin');
    return res.json();
  },

  async createSuperUser(payload: {
    name: string;
    email: string;
    phone: string;
    college_year?: string;
    club_name?: string;
    allowed_spaces: string[];
  }): Promise<AdminSuperUser> {
    const res = await fetch(`${API_BASE}/admin/superusers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register SuperUser');
    }
    return res.json();
  },

  async updateSuperUser(
    suId: string,
    payload: {
      name?: string;
      phone?: string;
      college_year?: string;
      club_name?: string;
      allowed_spaces?: string[];
      is_active?: boolean;
    }
  ): Promise<AdminSuperUser> {
    const res = await fetch(`${API_BASE}/admin/superusers/${encodeURIComponent(suId)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update SuperUser');
    }
    return res.json();
  },

  async revokeSuperUser(suId: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/admin/superusers/${encodeURIComponent(suId)}/revoke`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to revoke SuperUser');
    }
    return res.json();
  },

  async deleteAdminSuperuser(suId: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/admin/superusers/${encodeURIComponent(suId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete SuperUser');
    }
    return res.json();
  },

  async deleteAdminUser(userId: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete user');
    }
    return res.json();
  },

  async fetchDirectory(): Promise<DirectoryMember[]> {
    const res = await fetch(`${API_BASE}/admin/directory`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch member directory');
    return res.json();
  },

  async fetchClusterGraph(): Promise<ClusterGraphData> {
    const res = await fetch(`${API_BASE}/admin/cluster-graph`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch cluster graph data');
    return res.json();
  },

  async fetchVapidPublicKey(): Promise<string> {
    const res = await fetch(`${API_BASE}/notifications/vapid-public-key`);
    if (!res.ok) throw new Error('Failed to fetch VAPID public key');
    const data = await res.json();
    return data.public_key;
  },

  async subscribePush(payload: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE}/notifications/subscribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register push subscription');
    }
    return res.json();
  },

  async unsubscribePush(): Promise<{ status: string; removed_count: number }> {
    const res = await fetch(`${API_BASE}/notifications/subscribe`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to remove push subscription');
    }
    return res.json();
  },

  async sendPushTestAlert(): Promise<{ status: string; delivered_count: number; message: string }> {
    const res = await fetch(`${API_BASE}/notifications/test-alert`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to dispatch push test alert');
    }
    return res.json();
  },

  async fetchEsp32Status(): Promise<ESP32DeviceStatus[]> {
    const res = await fetch(`${API_BASE}/esp32/status?_t=${Date.now()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to fetch ESP32 hardware status');
    return res.json();
  },

  async pingEsp32(spaceId: string): Promise<ESP32PingResponse> {
    const res = await fetch(`${API_BASE}/esp32/${encodeURIComponent(spaceId)}/ping`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to ping ESP32 for space '${spaceId}'`);
    }
    return res.json();
  },

  async fetchAdminEsp32Devices(): Promise<ESP32AdminDevice[]> {
    const res = await fetch(`${API_BASE}/admin/esp32/devices`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch ESP32 devices list');
    return res.json();
  },

  async rotateAdminEsp32Secret(spaceId: string): Promise<{ status: string; space_id: string; new_device_secret: string; message: string }> {
    const res = await fetch(`${API_BASE}/admin/esp32/devices/${encodeURIComponent(spaceId)}/rotate-secret`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to rotate secret for space '${spaceId}'`);
    }
    return res.json();
  },

  async uploadAdminFirmware(formData: FormData): Promise<{
    status: string;
    release_id: string;
    version: string;
    filename: string;
    sha256_checksum: string;
    target_space_id?: string;
    dispatched_to_spaces: string[];
    message: string;
  }> {
    const token = localStorage.getItem('panda_token');
    const res = await fetch(`${API_BASE}/admin/esp32/firmware`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload firmware release');
    }
    return res.json();
  },

  async fetchAdminFirmwareReleases(): Promise<ESP32FirmwareRelease[]> {
    const res = await fetch(`${API_BASE}/admin/esp32/firmware`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch firmware releases');
    return res.json();
  },

  async fetchPinValidity(): Promise<{ pin_validity_seconds: number; pin_validity_minutes: number }> {
    const res = await fetch(`${API_BASE}/admin/settings/pin-validity`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch PIN validity setting');
    return res.json();
  },

  async updatePinValidity(seconds: number): Promise<{
    status: string;
    pin_validity_seconds: number;
    pin_validity_minutes: number;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/admin/settings/pin-validity`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pin_validity_seconds: seconds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update PIN validity lifespan');
    }
    return res.json();
  },

  async fetchAdminEsp32Totp(): Promise<Record<string, {
    space_id: string;
    pin: string;
    remaining_seconds: number;
    time_step: number;
    valid_till: number;
  }>> {
    const res = await fetch(`${API_BASE}/admin/esp32/totp`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch emergency master TOTP keys');
    return res.json();
  },

  async registerFacilitySpace(payload: { slug: string; name: string; esp32_device_id: string; is_active?: boolean }): Promise<{ id: string; slug: string; name: string; esp32_device_id: string; is_active: boolean }> {
    const res = await fetch(`${API_BASE}/spaces`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register facility space');
    }
    return res.json();
  },

  async deleteFacilitySpace(slug: string): Promise<{ status: string; message: string; space_slug: string }> {
    const res = await fetch(`${API_BASE}/spaces/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to remove facility space '${slug}'`);
    }
    return res.json();
  },

  async fetchAllLockDevices(): Promise<Array<{
    id: string;
    device_id: string;
    name: string;
    space_id: string | null;
    is_online: boolean;
    is_disabled: boolean;
    disabled_by_email: string | null;
    disabled_reason: string | null;
    firmware_version: string;
    last_seen_at: string | null;
    last_ping_ms: number | null;
    ip_address: string | null;
  }>> {
    const res = await fetch(`${API_BASE}/esp32/devices?_t=${Date.now()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to fetch door lock devices');
    return res.json();
  },

  async disableLockDevice(deviceId: string, reason?: string): Promise<{ status: string; message: string; is_disabled: boolean }> {
    const res = await fetch(`${API_BASE}/esp32/devices/${encodeURIComponent(deviceId)}/disable`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to disable lock '${deviceId}'`);
    }
    return res.json();
  },

  async enableLockDevice(deviceId: string): Promise<{ status: string; message: string; is_disabled: boolean }> {
    const res = await fetch(`${API_BASE}/esp32/devices/${encodeURIComponent(deviceId)}/enable`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to re-enable lock '${deviceId}'`);
    }
    return res.json();
  },

  async createLockDevice(payload: { device_id: string; name: string; space_id?: string | null }): Promise<{
    id: string;
    device_id: string;
    name: string;
    space_id: string | null;
    device_secret: string;
    is_disabled: boolean;
    is_online: boolean;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/esp32/devices`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to register lock device');
    }
    return res.json();
  },

  async lookupRegisteredUser(email: string): Promise<{
    found: boolean;
    name?: string;
    email?: string;
    phone?: string;
    college_year?: string;
    club_name?: string;
  }> {
    const res = await fetch(`${API_BASE}/admin/users/lookup?email=${encodeURIComponent(email)}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to lookup registered user');
    return res.json();
  },
  async deleteLockDevice(deviceId: string): Promise<{
    status: string;
    message: string;
    device_id: string;
    space_deleted?: boolean;
    space_slug?: string;
  }> {
    const res = await fetch(`${API_BASE}/esp32/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to remove lock '${deviceId}'`);
    }
    return res.json();
  },

  async unbindLockDevice(deviceId: string): Promise<{
    status: string;
    device_id: string;
    name: string;
    ip_address: null;
    mac_address: null;
    is_online: boolean;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/esp32/devices/${encodeURIComponent(deviceId)}/unbind`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to unbind hardware for lock '${deviceId}'`);
    }
    return res.json();
  },

  async executeFactoryReset(): Promise<{ status: string; message: string; stats: any }> {
    const res = await fetch(`${API_BASE}/admin/factory-reset`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to execute factory reset');
    }
    return res.json();
  },

  async updateFacilitySpace(slug: string, payload: { name?: string; is_active?: boolean; esp32_device_id?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/spaces/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to update facility space '${slug}'`);
    }
    return res.json();
  },

  async updateLockDevice(deviceId: string, payload: { name?: string; space_id?: string; is_disabled?: boolean; disabled_reason?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/esp32/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to update lock '${deviceId}'`);
    }
    return res.json();
  },

  async revokeAllPins(spaceSlug?: string): Promise<{ status: string; revoked_count: number; message: string }> {
    const params = new URLSearchParams();
    if (spaceSlug && spaceSlug !== 'all') params.append('space_slug', spaceSlug);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/pins/revoke-all${qs}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('panda:unauthorized'));
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to revoke all PINs');
    }
    return res.json();
  },

  async fetchAuthConfig(): Promise<{
    auth_mode: string;
    allowed_email_domain: string;
    google_client_id: string;
    root_admin_email: string;
  }> {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) throw new Error('Failed to fetch auth configuration');
    return res.json();
  },

  async getAuthConfig() {
    return this.fetchAuthConfig();
  },

  async fetchGoogleOAuthUrl(redirectUri?: string): Promise<{ url: string }> {
    const params = new URLSearchParams();
    if (redirectUri) params.append('redirect_uri', redirectUri);
    const res = await fetch(`${API_BASE}/auth/oauth/google/url?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to generate Google OAuth URL');
    return res.json();
  },

  async loginWithGoogleOAuth(payload: { email?: string; credential?: string; code?: string; redirect_uri?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/auth/oauth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Google Workspace OAuth login failed');
    }
    return res.json();
  },
};
