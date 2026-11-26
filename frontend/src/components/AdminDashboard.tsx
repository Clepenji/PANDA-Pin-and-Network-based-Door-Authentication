import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  TrendingUp,
  ShieldCheck,
  UserPlus,
  ShieldAlert,
  Trash2,
  Check,
  X,
  Download,
  Copy,
  RotateCcw,
  KeyRound,
  Search,
  Cpu,
  ChevronDown,
  Crown,
  MoreHorizontal,
  Plus,
  Pencil,
  RefreshCw,
  Loader2,
  CheckSquare,
  QrCode,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { copyToClipboard } from '../utils/clipboard';
import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  autoCompleteInstitutionalEmail,
  formatTimeAgo,
  formatTimeOnly,
  formatValidTill,
  getDayColor,
  WEEK_DAYS,
} from '../utils/format';
import {
  AdminMetrics,
  AdminSuperUser,
  SecondaryAdmin,
  ActiveKeySummary,
  PortalLog,
  Club,
  UserProfile,
} from '../types';
import AffiliationClusterModal from './AffiliationClusterModal';
import ESP32StatusBar from './ESP32StatusBar';
import ESP32HardwareManager from './ESP32HardwareManager';
import { useSpace } from '../context/SpaceContext';

interface AdminDashboardProps {
  currentUser?: UserProfile | null;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  showToast,
}) => {
  const { refreshStatuses } = useSpace();
  const [activeTab, setActiveTab] = useState<'users' | 'superusers' | 'active-keys' | 'admins' | 'logs' | 'spaces' | 'esp32_hardware'>('users');
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrUrl, setQrUrl] = useState<string>(() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const [creationWarningTarget, setCreationWarningTarget] = useState<'superuser' | 'admin' | null>(null);
  const [creationWarningAck, setCreationWarningAck] = useState(false);
  const [revokingAllPins, setRevokingAllPins] = useState(false);

  // Stats
  const [stats, setStats] = useState<AdminMetrics>({
    total_registered_users: 0,
    weekly_entries_per_space: { sandboxx_0: 0, sandboxx_1: 0 },
    weekly_entries_space_names: { sandboxx_0: 'SandBoxx 0', sandboxx_1: 'SandBoxx 1' },
    avg_access_requests_per_day: 0,
  });

  // Clubs & Spaces
  const [spaces, setSpaces] = useState<Array<{
    id: string;
    slug: string;
    name: string;
    esp32_device_id?: string;
    is_active?: boolean;
    assigned_devices?: Array<{ device_id: string; name: string; is_online: boolean; is_disabled: boolean }>;
  }>>([]);
  const [availableClubs, setAvailableClubs] = useState<Club[]>([]);

  // Tab 5: Facility Spaces (Root Administrator Only)
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const [spaceForm, setSpaceForm] = useState({
    name: '',
    slug: '',
    lock_name: 'Main Door',
    esp32_device_id: '',
    is_active: true,
  });
  const [spaceSubmitting, setSpaceSubmitting] = useState(false);

  // Modal: Add Lock to Space
  const [showAddLockModal, setShowAddLockModal] = useState(false);
  const [addLockForm, setAddLockForm] = useState({
    space_id: '',
    space_name: '',
    device_id: '',
    name: 'Secondary Door',
  });
  const [addLockSubmitting, setAddLockSubmitting] = useState(false);

  // Modal: Edit Facility Space
  const [editingSpace, setEditingSpace] = useState<any | null>(null);
  const [editSpaceForm, setEditSpaceForm] = useState({
    name: '',
    is_active: true,
    esp32_device_id: '',
  });
  const [editSpaceSubmitting, setEditSpaceSubmitting] = useState(false);

  // Modal: Edit Door Lock
  const [editingLock, setEditingLock] = useState<{
    device_id: string;
    name: string;
    space_id: string;
    is_disabled: boolean;
    disabled_reason: string;
  } | null>(null);
  const [editLockSubmitting, setEditLockSubmitting] = useState(false);
  const [isRefreshingSpaces, setIsRefreshingSpaces] = useState(false);

  const handleManualRefreshSpaces = async () => {
    setIsRefreshingSpaces(true);
    try {
      await fetchSpaces();
      await fetchStats();
      showToast('Facility spaces and door locks refreshed', 'info');
    } catch (err: any) {
      showToast('Failed to refresh facility spaces', 'error');
    } finally {
      setIsRefreshingSpaces(false);
    }
  };

  // Tab 1: SuperUsers
  const [superusers, setSuperusers] = useState<AdminSuperUser[]>([]);
  const [showSuModal, setShowSuModal] = useState(false);
  const [isLookingUpSu, setIsLookingUpSu] = useState(false);
  const [suAutofilledUser, setSuAutofilledUser] = useState<string | null>(null);
  const [suForm, setSuForm] = useState({
    name: '',
    email: '',
    phone: '',
    collegeYear: 'Not Applicable',
    clubSelection: '',
    customClub: '',
    spacePermissions: {} as Record<string, boolean>,
  });
  const [editingSu, setEditingSu] = useState<AdminSuperUser | null>(null);
  const [editSuForm, setEditSuForm] = useState({
    name: '',
    phone: '',
    collegeYear: 'Not Applicable',
    clubSelection: '',
    customClub: '',
    spacePermissions: {} as Record<string, boolean>,
  });

  const handleOpenAddSu = () => {
    if (spaces.length === 0) {
      showToast('No Facility Spaces configured yet. Create a Facility Space first before appointing a SuperUser.', 'error');
      return;
    }
    setCreationWarningAck(false);
    setCreationWarningTarget('superuser');
  };

  const proceedToSuModal = () => {
    const defaultPerms: Record<string, boolean> = {};
    spaces.forEach((s) => {
      defaultPerms[s.slug] = true;
    });
    setSuForm({
      name: '',
      email: '',
      phone: '',
      collegeYear: 'Not Applicable',
      clubSelection: '',
      customClub: '',
      spacePermissions: defaultPerms,
    });
    setSuAutofilledUser(null);
    setShowSuModal(true);
  };

  // Debounced lookup when email is typed in Add SuperUser modal
  useEffect(() => {
    if (!showSuModal) return;
    const cleanEmail = suForm.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length < 5) {
      setSuAutofilledUser(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLookingUpSu(true);
      try {
        const res = await api.lookupRegisteredUser(cleanEmail);
        if (res.found && res.name) {
          setSuForm((prev) => {
            let clubSel = prev.clubSelection;
            let custClub = prev.customClub;
            if (res.club_name) {
              const matched = availableClubs.some(
                (c) => c.name.toLowerCase() === res.club_name!.toLowerCase()
              );
              if (matched) {
                clubSel = res.club_name;
                custClub = '';
              } else {
                clubSel = '__new__';
                custClub = res.club_name;
              }
            }
            return {
              ...prev,
              name: res.name ? res.name.slice(0, 25) : prev.name,
              phone: res.phone ? res.phone : prev.phone,
              collegeYear: res.college_year || prev.collegeYear,
              clubSelection: clubSel,
              customClub: custClub,
            };
          });
          setSuAutofilledUser(res.name);
        } else {
          setSuAutofilledUser(null);
        }
      } catch {
        setSuAutofilledUser(null);
      } finally {
        setIsLookingUpSu(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [suForm.email, showSuModal, availableClubs]);

  // Tab 2: Admins
  const [admins, setAdmins] = useState<SecondaryAdmin[]>([]);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    is_root: false,
  });

  // Tab 3: Active Keys
  const [activeKeys, setActiveKeys] = useState<ActiveKeySummary[]>([]);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  // Tab 4: Logs
  const [logs, setLogs] = useState<PortalLog[]>([]);
  const [logSpace, setLogSpace] = useState('all');
  const [logClub, setLogClub] = useState('all');
  const [logEvent, setLogEvent] = useState('all');
  const [logRange, setLogRange] = useState('7d');
  const [logSearch, setLogSearch] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [expandedSuId, setExpandedSuId] = useState<string | null>(null);
  const [expandedActiveKeyId, setExpandedActiveKeyId] = useState<string | null>(null);
  const [expandedAdminId, setExpandedAdminId] = useState<string | null>(null);
  const [expandedSpaceSlug, setExpandedSpaceSlug] = useState<string | null>(null);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);

  // System Reset & Factory Reset Modals
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showFactoryResetModal, setShowFactoryResetModal] = useState(false);
  const [factoryResetLoading, setFactoryResetLoading] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState<string>('hyderabad.bits-pilani.ac.in');

  // User Roster & K-Means Cluster Modal
  const [showRosterModal, setShowRosterModal] = useState(false);

  // Filters for SuperUsers tab
  const [suSearch, setSuSearch] = useState('');
  const [suClubFilter, setSuClubFilter] = useState('all');
  const [suSpaceFilter, setSuSpaceFilter] = useState('all');
  const [suYearFilter, setSuYearFilter] = useState('all');

  // Filters for Active Keys tab
  const [keySearch, setKeySearch] = useState('');
  const [keySpaceFilter, setKeySpaceFilter] = useState('all');

  // Filters for Admins tab
  const [adminSearch, setAdminSearch] = useState('');
  const [adminRoleFilter, setAdminRoleFilter] = useState('all'); // 'all' | 'root' | 'standard'

  // Filters for Spaces tab
  const [spaceSearch, setSpaceSearch] = useState('');
  const [spaceStatusFilter, setSpaceStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'

  // Filtered SuperUsers
  const filteredSuperusers = useMemo(() => {
    return superusers.filter((su) => {
      // Club filter
      if (suClubFilter !== 'all') {
        const clubName = su.club_name || 'General / Unaffiliated';
        if (suClubFilter === '__independent__') {
          if (su.club_name) return false;
        } else if (clubName !== suClubFilter) {
          return false;
        }
      }

      // Space filter
      if (suSpaceFilter !== 'all') {
        if (!su.allowed_spaces || !su.allowed_spaces.includes(suSpaceFilter)) return false;
      }

      // Year filter
      if (suYearFilter !== 'all') {
        if ((su.college_year || 'Not Applicable') !== suYearFilter) return false;
      }

      // Search query
      if (suSearch.trim()) {
        const q = suSearch.toLowerCase().trim();
        const match =
          su.name.toLowerCase().includes(q) ||
          su.email.toLowerCase().includes(q) ||
          (su.phone && su.phone.includes(q)) ||
          (su.club_name && su.club_name.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [superusers, suSearch, suClubFilter, suSpaceFilter, suYearFilter]);

  // Filtered Active Keys
  const filteredActiveKeys = useMemo(() => {
    return activeKeys.filter((k) => {
      // Space filter
      if (keySpaceFilter !== 'all' && k.space_id !== keySpaceFilter) return false;

      // Search query
      if (keySearch.trim()) {
        const q = keySearch.toLowerCase().trim();
        const match =
          k.holder_name.toLowerCase().includes(q) ||
          k.holder_email.toLowerCase().includes(q) ||
          (k.space_name && k.space_name.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [activeKeys, keySearch, keySpaceFilter]);

  // Filtered Admins
  const filteredAdmins = useMemo(() => {
    return admins.filter((adm) => {
      // Role filter
      if (adminRoleFilter === 'root' && !adm.is_root) return false;
      if (adminRoleFilter === 'standard' && adm.is_root) return false;

      // Search query
      if (adminSearch.trim()) {
        const q = adminSearch.toLowerCase().trim();
        const match =
          adm.name.toLowerCase().includes(q) ||
          adm.email.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [admins, adminSearch, adminRoleFilter]);

  // Filtered Spaces
  const filteredSpaces = useMemo(() => {
    return spaces.filter((sp) => {
      // Status filter
      if (spaceStatusFilter === 'active' && sp.is_active === false) return false;
      if (spaceStatusFilter === 'inactive' && sp.is_active !== false) return false;

      // Search query
      if (spaceSearch.trim()) {
        const q = spaceSearch.toLowerCase().trim();
        const match =
          sp.name.toLowerCase().includes(q) ||
          sp.slug.toLowerCase().includes(q) ||
          (sp.esp32_device_id && sp.esp32_device_id.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [spaces, spaceSearch, spaceStatusFilter]);

  const fetchStats = async () => {
    try {
      const res = await api.fetchAdminMetrics();
      setStats(res);
    } catch (err) {
      console.error('Fetch stats error:', err);
    }
  };

  const fetchSpaces = async () => {
    try {
      const res = await api.fetchSpaces();
      setSpaces(res || []);
      const perms: Record<string, boolean> = {};
      res.forEach((s) => (perms[s.slug] = false));
      setSuForm((prev) => ({ ...prev, spacePermissions: perms }));
    } catch (err) {
      console.error('Fetch spaces error:', err);
    }
  };

  const fetchClubs = async () => {
    try {
      const res = await api.fetchClubs();
      setAvailableClubs(res || []);
    } catch (err) {
      console.error('Fetch clubs error:', err);
    }
  };

  const fetchSuperusers = async () => {
    try {
      const res = await api.fetchAdminSuperUsers();
      setSuperusers(res || []);
    } catch (err) {
      console.error('Fetch superusers error:', err);
    }
  };

  const fetchAdmins = async () => {
    try {
      const res = await api.fetchSecondaryAdmins();
      setAdmins(res || []);
    } catch (err) {
      console.error('Fetch admins error:', err);
    }
  };

  const fetchActiveKeys = async () => {
    try {
      const res = await api.fetchActiveKeys();
      setActiveKeys(res || []);
    } catch (err) {
      console.error('Fetch active keys error:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      let startDate: string | undefined;
      const now = new Date();
      if (logRange === '24h') {
        startDate = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      } else if (logRange === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      } else if (logRange === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      }

      const res = await api.fetchPortalLogs(
        logSpace === 'all' ? undefined : logSpace,
        startDate,
        undefined,
        500,
        logClub === 'all' ? undefined : logClub === '__independent__' ? 'Independent' : logClub,
        logEvent === 'all' ? undefined : logEvent
      );
      setLogs(res || []);
    } catch (err) {
      console.error('Fetch logs error:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSpaces();
    fetchClubs();
    fetchSuperusers();
    fetchAdmins();
    fetchActiveKeys();
    api.fetchAuthConfig().then((cfg) => {
      if (cfg?.allowed_email_domain) setAllowedDomain(cfg.allowed_email_domain);
    }).catch(() => {});
  }, []);

  // Real-time synchronization for spaces, hardware locks, and operational telemetry
  useEffect(() => {
    const unsubscribe = wsService.subscribe('global', (event: any) => {
      const type = event.event_type || event.type;
      if (
        type === 'SPACE_UPDATED' ||
        type === 'ESP32_STATUS_UPDATE' ||
        type === 'ESP_DEVICE_STATUS' ||
        type === 'ESP_DEVICE_REGISTERED' ||
        type === 'ESP_DEVICE_DELETED' ||
        type === 'FACILITY_SPACE_CREATED' ||
        type === 'FACILITY_SPACE_REMOVED' ||
        type === 'FACTORY_RESET' ||
        type === 'USER_DIRECTORY_UPDATED'
      ) {
        fetchSpaces();
        fetchStats();
        fetchSuperusers();
        fetchActiveKeys();
        if (type === 'FACTORY_RESET' || type === 'FACILITY_SPACE_REMOVED') {
          fetchAdmins();
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') fetchLogs();
    if (activeTab === 'active-keys') fetchActiveKeys();
    if (activeTab === 'superusers') fetchSuperusers();
    if (activeTab === 'admins') fetchAdmins();
    if (activeTab === 'spaces' || activeTab === 'esp32_hardware') {
      fetchSpaces();
      fetchStats();
    }
  }, [activeTab, logSpace, logClub, logEvent, logRange]);

  const handleCopyPhone = async (phone?: string, id?: string) => {
    if (!phone) return;
    const ok = await copyToClipboard(phone);
    if (id) setCopiedPhoneId(id);
    if (ok) {
      showToast('Phone number copied to clipboard', 'info');
    } else {
      showToast(`Phone: ${phone}`, 'info');
    }
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  // Create SuperUser
  const handleSaveSuperuser = async (e: React.FormEvent) => {
    e.preventDefault();
    const normPhone = normalizePhoneNumber(suForm.phone);
    if (!isValidPhoneNumber(normPhone)) {
      showToast('Please enter a valid 10-15 digit phone number (e.g. 9876543210)', 'error');
      return;
    }

    const effectiveClub =
      suForm.clubSelection === '__new__'
        ? suForm.customClub.trim()
        : suForm.clubSelection.trim();

    const allowed = Object.entries(suForm.spacePermissions)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (allowed.length === 0) {
      showToast('Please select at least one authorized Facility Space', 'error');
      return;
    }

    try {
      await api.createSuperUser({
        name: suForm.name.trim(),
        email: suForm.email.trim(),
        phone: normPhone,
        college_year: suForm.collegeYear,
        club_name: effectiveClub || undefined,
        allowed_spaces: allowed,
      });

      showToast(`SuperUser privileges granted to ${suForm.email}`, 'success');
      setShowSuModal(false);
      setSuAutofilledUser(null);
      setSuForm({
        name: '',
        email: '',
        phone: '',
        collegeYear: 'Not Applicable',
        clubSelection: '',
        customClub: '',
        spacePermissions: {},
      });
      fetchSuperusers();
      fetchClubs();
      fetchStats();
    } catch (err: any) {
      showToast(err.message || 'Failed to create SuperUser', 'error');
    }
  };

  // Open Edit SuperUser Modal
  const handleOpenEditSu = (su: AdminSuperUser) => {
    setEditingSu(su);
    const perms: Record<string, boolean> = {};
    spaces.forEach((s) => {
      perms[s.slug] = (su.allowed_spaces || []).includes(s.slug);
    });
    setEditSuForm({
      name: su.name,
      phone: su.phone,
      collegeYear: su.college_year || 'Not Applicable',
      clubSelection: su.club_name || '',
      customClub: '',
      spacePermissions: perms,
    });
  };

  // Update existing SuperUser details & facility space authority
  const handleUpdateSuperuser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSu) return;
    if (!editSuForm.name.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    const normPhone = normalizePhoneNumber(editSuForm.phone);
    if (!isValidPhoneNumber(normPhone)) {
      showToast('Please enter a valid 10-15 digit phone number', 'error');
      return;
    }
    const allowed = Object.entries(editSuForm.spacePermissions)
      .filter(([_, checked]) => checked)
      .map(([slug]) => slug);

    if (allowed.length === 0) {
      showToast('SuperUser must be granted authority over at least one facility space', 'error');
      return;
    }

    const effectiveClub =
      editSuForm.clubSelection === '__new__'
        ? editSuForm.customClub.trim()
        : editSuForm.clubSelection.trim();

    try {
      await api.updateSuperUser(editingSu.id, {
        name: editSuForm.name.trim(),
        phone: normPhone,
        college_year: editSuForm.collegeYear,
        club_name: effectiveClub || undefined,
        allowed_spaces: allowed,
      });

      showToast(`SuperUser ${editingSu.name} updated successfully`, 'success');
      setEditingSu(null);
      fetchSuperusers();
      fetchClubs();
    } catch (err: any) {
      showToast(err.message || 'Failed to update SuperUser', 'error');
    }
  };

  // Revoke SuperUser
  const handleRevokeSuperuser = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Revoke SuperUser privileges for ${name}? Their account will be deactivated and directed to fresh student registration on next login.`
      )
    ) {
      return;
    }

    try {
      await api.revokeSuperUser(id);
      showToast(`SuperUser ${name} revoked`, 'success');
      fetchSuperusers();
      fetchStats();
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke SuperUser', 'error');
    }
  };

  // Create Admin (Root or Standard)
  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createSecondaryAdmin({
        name: adminForm.name.trim().slice(0, 15),
        email: adminForm.email.trim(),
        is_root: currentUser?.is_root ? adminForm.is_root : false,
      });
      showToast(`Admin account created for ${adminForm.email}`, 'success');
      setShowAdminModal(false);
      setAdminForm({ name: '', email: '', is_root: false });
      fetchAdmins();
    } catch (err: any) {
      showToast(err.message || 'Failed to create admin', 'error');
    }
  };

  // Delete Admin (Mutual deletion supported for all non-source admins)
  const handleDeleteAdmin = async (id: string, email: string) => {
    if (!window.confirm(`Delete administrator account ${email}?`)) return;
    try {
      await api.deleteSecondaryAdmin(id);
      showToast(`Admin account ${email} deleted`, 'success');
      fetchAdmins();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete admin', 'error');
    }
  };

  // Register New Space / ESP32 Controller (Master Root Admin Only)
  const handleSaveSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.is_root) {
      showToast('Forbidden: Only the Master Root Administrator can register new spaces.', 'error');
      return;
    }

    if (!spaceForm.name.trim() || !spaceForm.slug.trim()) {
      showToast('Facility space name and slug identifier are required', 'error');
      return;
    }

    try {
      setSpaceSubmitting(true);
      await api.createSpace({
        name: spaceForm.name.trim(),
        slug: spaceForm.slug.trim().toLowerCase(),
        lock_name: spaceForm.lock_name.trim() || 'Main Door',
        esp32_device_id: spaceForm.esp32_device_id.trim() || undefined,
        is_active: spaceForm.is_active,
      });

      showToast(`Facility space '${spaceForm.name}' registered successfully!`, 'success');
      setShowSpaceModal(false);
      setSpaceForm({
        name: '',
        slug: '',
        lock_name: 'Main Door',
        esp32_device_id: '',
        is_active: true,
      });
      await fetchSpaces();
      await fetchStats();
      await refreshStatuses();
    } catch (err: any) {
      showToast(err.message || 'Failed to register facility space', 'error');
    } finally {
      setSpaceSubmitting(false);
    }
  };

  // Add Additional Lock to Existing Space (Root Admin Only)
  const handleOpenAddLock = (spaceSlug: string, spaceName: string) => {
    setAddLockForm({
      space_id: spaceSlug,
      space_name: spaceName,
      device_id: `ESP32_${spaceSlug.toUpperCase()}_DOOR_2`,
      name: 'Secondary Door',
    });
    setShowAddLockModal(true);
  };

  const handleSaveAddLock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.is_root) {
      showToast('Forbidden: Only the Master Root Administrator can add locks.', 'error');
      return;
    }
    if (!addLockForm.device_id.trim() || !addLockForm.name.trim()) {
      showToast('Lock Name and Device ID are required.', 'error');
      return;
    }
    try {
      setAddLockSubmitting(true);
      await api.createLockDevice({
        space_id: addLockForm.space_id,
        device_id: addLockForm.device_id.trim(),
        name: addLockForm.name.trim(),
      });
      showToast(`Door lock '${addLockForm.name}' added to ${addLockForm.space_name}!`, 'success');
      setShowAddLockModal(false);
      await fetchSpaces();
      await fetchStats();
    } catch (err: any) {
      showToast(err.message || 'Failed to add door lock', 'error');
    } finally {
      setAddLockSubmitting(false);
    }
  };

  // Delete Hardware Lock (Root Admin Only)
  const handleDeleteLock = async (deviceId: string, lockName: string, spaceSlug?: string) => {
    if (!currentUser?.is_root) {
      showToast('Forbidden: Only the Master Root Administrator can remove hardware door locks.', 'error');
      return;
    }

    const parentSpace = spaceSlug
      ? spaces.find((s) => s.slug === spaceSlug)
      : spaces.find((s) => s.assigned_devices?.some((d) => d.device_id === deviceId) || s.esp32_device_id === deviceId);
    const lockCount = parentSpace?.assigned_devices?.length ?? 1;
    const isLastLock = Boolean(parentSpace && lockCount <= 1);

    const confirmMessage = isLastLock
      ? `⚠️ WARNING: '${lockName}' (${deviceId}) is the ONLY lock for Facility Space '${parentSpace?.name}'.\n\nDeleting this lock will permanently DELETE Facility Space '${parentSpace?.name}' and cascade reset its zone:\n• SuperUsers who ONLY govern this space will have their accounts deleted.\n• Users registered to this space will lose this space tab so they can register elsewhere.\n• Active PINs and pending requests for this space will be purged.\n• Immutable audit logs will remain preserved.\n\nProceed with deletion?`
      : `Are you sure you want to permanently remove door lock '${lockName}' (${deviceId})?\n\nThis will terminate its active connections while keeping remaining locks for '${parentSpace?.name || 'this space'}' active.`;

    if (!window.confirm(confirmMessage)) return;

    // Optimistically remove lock from local spaces immediately
    setSpaces((prev) =>
      prev.map((s) => ({
        ...s,
        assigned_devices: s.assigned_devices?.filter((d) => d.device_id !== deviceId),
      }))
    );

    try {
      const res = await api.deleteLockDevice(deviceId);
      showToast(
        res.space_deleted
          ? `Last lock '${lockName}' and Facility Space '${parentSpace?.name || res.space_slug}' deleted.`
          : `Door lock '${lockName}' (${deviceId}) removed successfully.`,
        'success'
      );
    } catch (err: any) {
      if (err.message && (err.message.includes('not found') || err.message.includes('404'))) {
        showToast(`Door lock '${lockName}' was already removed from the system.`, 'info');
      } else {
        showToast(err.message || 'Failed to remove door lock', 'error');
      }
    } finally {
      await fetchSpaces();
      await fetchStats();
      await fetchSuperusers();
      await fetchActiveKeys();
      await refreshStatuses();
    }
  };

  // Delete Facility Space (Root Admin only)
  const handleDeleteSpace = async (slug: string, name: string) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to permanently remove Facility Space '${name}' (${slug})?\n\nThis will also remove its associated ESP32 controllers, active PINs, and pending requests.`
    );
    if (!confirmDelete) return;

    try {
      await api.deleteFacilitySpace(slug);
      showToast(`Facility Space '${name}' and its ESP32 controllers removed.`, 'success');
      await fetchSpaces();
      await fetchStats();
      await fetchSuperusers();
      await fetchActiveKeys();
      await refreshStatuses();
    } catch (err: any) {
      showToast(err.message || 'Failed to remove facility space', 'error');
    }
  };

  // Edit Facility Space Details (Root Admin only)
  const handleOpenEditSpace = (sp: any) => {
    setEditingSpace(sp);
    setEditSpaceForm({
      name: sp.name,
      is_active: sp.is_active !== false,
      esp32_device_id: sp.esp32_device_id || '',
    });
  };

  const handleSaveSpaceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.is_root) {
      showToast('Forbidden: Only the Master Root Administrator can edit spaces.', 'error');
      return;
    }
    if (!editingSpace) return;
    if (!editSpaceForm.name.trim()) {
      showToast('Facility space name is required.', 'error');
      return;
    }
    try {
      setEditSpaceSubmitting(true);
      await api.updateFacilitySpace(editingSpace.slug, {
        name: editSpaceForm.name.trim(),
        is_active: editSpaceForm.is_active,
        esp32_device_id: editSpaceForm.esp32_device_id.trim() || undefined,
      });
      showToast(`Facility space '${editSpaceForm.name}' updated successfully!`, 'success');
      setEditingSpace(null);
      await fetchSpaces();
      await fetchStats();
      await refreshStatuses();
    } catch (err: any) {
      showToast(err.message || 'Failed to update facility space', 'error');
    } finally {
      setEditSpaceSubmitting(false);
    }
  };

  // Edit Door Lock Details (Root Admin only)
  const handleOpenEditLock = (
    deviceId: string,
    name: string,
    spaceId: string,
    isDisabled: boolean = false,
    disabledReason: string = ''
  ) => {
    setEditingLock({
      device_id: deviceId,
      name: name || 'Door Lock',
      space_id: spaceId || (spaces[0]?.slug || ''),
      is_disabled: Boolean(isDisabled),
      disabled_reason: disabledReason || '',
    });
  };

  const handleSaveLockEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.is_root) {
      showToast('Forbidden: Only the Master Root Administrator can edit locks.', 'error');
      return;
    }
    if (!editingLock) return;
    if (!editingLock.name.trim()) {
      showToast('Lock Name cannot be empty.', 'error');
      return;
    }
    try {
      setEditLockSubmitting(true);
      await api.updateLockDevice(editingLock.device_id, {
        name: editingLock.name.trim(),
        space_id: editingLock.space_id,
        is_disabled: editingLock.is_disabled,
        disabled_reason: editingLock.is_disabled ? editingLock.disabled_reason : undefined,
      });
      showToast(`Door lock '${editingLock.name}' updated successfully!`, 'success');
      setEditingLock(null);
      await fetchSpaces();
      await fetchStats();
    } catch (err: any) {
      showToast(err.message || 'Failed to update lock details', 'error');
    } finally {
      setEditLockSubmitting(false);
    }
  };

  // Revoke Key
  const handleRevokeKey = async (keyId: string, entrantName: string, spaceName: string) => {
    if (!window.confirm(`Revoke active access pass for ${entrantName} in ${spaceName}?`)) return;

    try {
      setRevokingKeyId(keyId);
      await api.revokePin(keyId);
      showToast('Access pass revoked immediately', 'success');
      fetchActiveKeys();
      fetchStats();
      fetchLogs();
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke key', 'error');
    } finally {
      setRevokingKeyId(null);
    }
  };

  // System Reset (Wipe test data / Reset system)
  const handleExecuteReset = async () => {
    try {
      setResetLoading(true);
      const res = await fetch('/api/v1/admin/system-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('panda_token')}`,
        },
      });
      if (!res.ok) {
        // Fallback to logs reset endpoint if needed
        const fallbackRes = await fetch('/api/v1/logs/annual-reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('panda_token')}`,
          },
        });
        if (!fallbackRes.ok) throw new Error('System reset execution failed');
      }
      showToast('System reset executed successfully. All users, superusers, and clubs purged; logs archived.', 'success');
      setShowResetModal(false);
      fetchStats();
      fetchSuperusers();
      fetchActiveKeys();
      fetchLogs();
      fetchSpaces();
      fetchAdmins();
    } catch (err: any) {
      showToast(err.message || 'Failed to execute system reset', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  // Factory Reset (Zero-State: wipes ALL spaces, locks, non-root admins, superusers, users) — Root Admin Exclusive
  const handleExecuteFactoryReset = async () => {
    if (!currentUser?.is_root) {
      showToast('Forbidden: Factory Reset is strictly restricted to the Root Administrator.', 'error');
      return;
    }
    try {
      setFactoryResetLoading(true);
      await api.executeFactoryReset();
      showToast('Factory Reset complete. System restored to 0 Facility Spaces and 0 Door Locks.', 'success');
      setShowFactoryResetModal(false);
      await fetchStats();
      await fetchSuperusers();
      await fetchAdmins();
      await fetchActiveKeys();
      await fetchLogs();
      await fetchSpaces();
      await refreshStatuses();
    } catch (err: any) {
      showToast(err.message || 'Failed to execute factory reset', 'error');
    } finally {
      setFactoryResetLoading(false);
    }
  };

  const filteredLogs = logs.filter((l) => {
    // Club Filter
    if (logClub !== 'all') {
      if (logClub === '__independent__') {
        if (l.club_name && l.club_name.trim()) return false;
      } else if (l.club_name !== logClub) {
        return false;
      }
    }

    // Event Filter
    if (logEvent !== 'all') {
      if (l.event_type !== logEvent) return false;
    }

    // Space Filter
    if (logSpace !== 'all') {
      if (l.space_id !== logSpace && l.space_name !== logSpace) return false;
    }

    // Search Query
    if (!logSearch.trim()) return true;
    const q = logSearch.toLowerCase().trim();
    return (
      (l.actor_name && l.actor_name.toLowerCase().includes(q)) ||
      (l.actor_email && l.actor_email.toLowerCase().includes(q)) ||
      (l.authority_name && l.authority_name.toLowerCase().includes(q)) ||
      (l.space_name && l.space_name.toLowerCase().includes(q)) ||
      (l.club_name && l.club_name.toLowerCase().includes(q)) ||
      (l.event_type && l.event_type.toLowerCase().includes(q)) ||
      (l.justification_snapshot && l.justification_snapshot.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Title & Top Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Admin Master Console</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Facility overview, superuser governance, live key management, and audit tracking.
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto flex-wrap">
          <button
            onClick={() => setShowRosterModal(true)}
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 text-xs font-semibold transition active:scale-95 shadow-sm"
          >
            <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate">User Directory & Clusters</span>
          </button>

          <button
            onClick={() => setShowResetModal(true)}
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60 text-xs font-semibold transition active:scale-95"
            title="Operational reset (clears users/superusers/clubs; preserves spaces & locks)"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>System Reset</span>
          </button>
        </div>
      </div>

      {/* Zero-Space Onboarding Banner (clean setup from Root Admin account) */}
      {spaces.length === 0 && (
        <div className="bg-indigo-950/40 border border-indigo-700/60 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-indigo-200 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Zero Facility Spaces Registered</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {currentUser?.is_root
                ? 'Welcome to PANDA. No Facility Spaces or Door Locks are configured yet. Create your first Facility Space and primary ESP32 lock controller to start onboarding users.'
                : 'No Facility Spaces or Door Locks are configured yet. Please contact the Root Administrator to set up spaces and hardware locks.'}
            </p>
          </div>
          {currentUser?.is_root && (
            <button
              onClick={() => {
                setActiveTab('spaces');
                setShowSpaceModal(true);
              }}
              className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>+ Register First Space</span>
            </button>
          )}
        </div>
      )}

      {/* Analytics KPI Cards - Registered Users & Daily Request Average (calculated over the week) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Registered Users</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {stats.total_registered_users}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Total student & staff profiles</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Daily Request Avg</span>
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {stats.avg_access_requests_per_day}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Calculated over the week</div>
        </div>
      </div>

      {/* Tabs (Order: Users, Logs, SuperUsers, Admins, Active Keys, then Spaces & ESP32) */}
      <div className="flex border-b border-slate-800 overflow-x-auto scrollbar-none gap-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'users'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Users</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Audit Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('superusers')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'superusers'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>SuperUsers ({superusers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('admins')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'admins'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Admins ({admins.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('active-keys')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'active-keys'
              ? 'border-rose-500 text-rose-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5 text-rose-400" />
          <span>Active Keys ({activeKeys.length})</span>
        </button>

        {currentUser?.is_root && (
          <button
            onClick={() => setActiveTab('spaces')}
            className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'spaces'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>Facility Spaces & ESPs ({spaces.length})</span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('esp32_hardware')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'esp32_hardware'
              ? 'border-cyan-500 text-cyan-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>{currentUser?.is_root ? 'ESP32 Hardware & OTA' : 'ESP32 Hardware'}</span>
        </button>
      </div>

      {/* TAB: USERS (QR Onboarding & Directory Access) */}
      {activeTab === 'users' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">User Onboarding & Directory</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                  {stats.total_registered_users} Registered
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Onboard new facility users via QR code or inspect the interactive affiliation directory.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowRosterModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition active:scale-95"
              >
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                <span>Open User Directory</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setQrUrl(window.location.origin);
                  setShowQrModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Create New Users</span>
              </button>
            </div>
          </div>
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="font-semibold text-white flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-400" />
                <span>Self-Service QR Registration</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Click <strong className="text-slate-200">Create New Users</strong> to display a scannable QR code pointing to this portal&apos;s live URL (<code className="text-indigo-300">{typeof window !== 'undefined' ? window.location.origin : ''}</code>). New users scan it, sign in, and enter the SuperUser waiting room for approval.
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Directory &amp; Log Inspection</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Use <strong className="text-slate-200">Open User Directory</strong> to view club clusters, inspect individual access history via <strong className="text-slate-200">Check Logs</strong>, or remove user accounts.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: SUPERUSERS */}
      {activeTab === 'superusers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">SuperUsers</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                  {filteredSuperusers.length} {filteredSuperusers.length === 1 ? 'SuperUser' : 'SuperUsers'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Club leads granted PIN approval authority</p>
            </div>
            <button
              onClick={handleOpenAddSu}
              className="w-full sm:w-auto justify-center flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add SuperUser</span>
            </button>
          </div>

          {/* SuperUsers Filter Toolbar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search SuperUsers by name, email, phone..."
                value={suSearch}
                onChange={(e) => setSuSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Club Filter */}
              <select
                value={suClubFilter}
                onChange={(e) => setSuClubFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Clubs</option>
                {availableClubs.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="__independent__">Unaffiliated / General</option>
              </select>

              {/* Space Filter */}
              <select
                value={suSpaceFilter}
                onChange={(e) => setSuSpaceFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Facility Spaces</option>
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </select>

              {/* Year Filter */}
              <select
                value={suYearFilter}
                onChange={(e) => setSuYearFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All College Years</option>
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>

              {(suSearch || suClubFilter !== 'all' || suSpaceFilter !== 'all' || suYearFilter !== 'all') && (
                <button
                  onClick={() => {
                    setSuSearch('');
                    setSuClubFilter('all');
                    setSuSpaceFilter('all');
                    setSuYearFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Year</th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Club</th>
                  <th className="py-2.5 px-4">Authorized Spaces</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredSuperusers.map((su) => (
                  <tr key={su.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-semibold text-white max-w-[130px] truncate" title={su.name}>{su.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-indigo-300 border border-indigo-900/50 whitespace-nowrap">
                        {su.college_year || 'Not Applicable'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px] max-w-[150px] truncate" title={su.email}>{su.email}</td>
                    <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                      {su.phone ? (
                        <button
                          onClick={() => handleCopyPhone(su.phone, su.id)}
                          className="hover:text-indigo-300 flex items-center gap-1"
                        >
                          <span>{su.phone}</span>
                          {copiedPhoneId === su.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-indigo-300 max-w-[130px] truncate" title={su.club_name || 'General'}>{su.club_name || 'General'}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {(su.allowed_spaces || []).map((sp) => (
                          <span
                            key={sp}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-slate-950 border border-slate-800 text-slate-300"
                          >
                            {sp}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEditSu(su)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 text-[11px] font-semibold transition active:scale-95 shadow-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRevokeSuperuser(su.id, su.name)}
                          className="px-2 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-[11px] font-semibold transition active:scale-95 shadow-sm"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSuperusers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No SuperUsers match the filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
          <div className="block md:hidden divide-y divide-slate-800/80">
            {filteredSuperusers.map((su) => {
              const isExpanded = expandedSuId === su.id;
              return (
                <div key={su.id} className="p-3.5 bg-slate-900 transition">
                  <div
                    onClick={() => setExpandedSuId(isExpanded ? null : su.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-xs truncate max-w-[150px]">
                          {su.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-indigo-300 border border-indigo-900/50">
                          {su.college_year || 'N/A'}
                        </span>
                      </div>
                      <div className="text-[11px] text-indigo-300 font-medium mt-1 truncate">
                        {su.club_name || 'Independent / General Body'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditSu(su)}
                        className="px-2 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 text-xs font-semibold active:scale-95"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRevokeSuperuser(su.id, su.name)}
                        className="px-2 py-1 rounded-lg bg-rose-950/70 text-rose-300 border border-rose-800/60 text-xs font-semibold active:scale-95"
                      >
                        Revoke
                      </button>
                      <button
                        onClick={() => setExpandedSuId(isExpanded ? null : su.id)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Dropdown Expansion */}
                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2 text-xs animate-in fade-in duration-100">
                      <div>
                        <span className="text-slate-500">Email:</span>{' '}
                        <span className="font-mono text-slate-200">{su.email}</span>
                      </div>
                      {su.phone && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500">Phone:</span>
                          <span className="font-mono text-slate-200">{su.phone}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(su.phone, su.id)}
                            className="text-indigo-400 p-0.5"
                          >
                            {copiedPhoneId === su.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-500 block mb-1">Authorized Facility Spaces:</span>
                        <div className="flex gap-1 flex-wrap">
                          {(su.allowed_spaces || []).map((sp) => (
                            <span
                              key={sp}
                              className="px-2 py-0.5 rounded text-[10px] bg-slate-950 border border-slate-800 text-indigo-300 font-mono"
                            >
                              {sp}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredSpaces.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-xs">
                No facility spaces match the filter criteria.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE KEYS */}
      {activeTab === 'active-keys' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Facility-Wide Active Passes</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
                  {filteredActiveKeys.length} {filteredActiveKeys.length === 1 ? 'Active Key' : 'Active Keys'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">All current valid door entry credentials across spaces</p>
            </div>
            {activeKeys.length > 0 && (
              <button
                type="button"
                disabled={revokingAllPins}
                onClick={async () => {
                  const scopeLabel = keySpaceFilter !== 'all' ? keySpaceFilter : 'ALL facility spaces';
                  if (!window.confirm(`Revoke ALL active PINs for ${scopeLabel}? This immediately disables all active passes on the door locks.`)) {
                    return;
                  }
                  setRevokingAllPins(true);
                  try {
                    const res = await api.revokeAllPins(keySpaceFilter !== 'all' ? keySpaceFilter : undefined);
                    showToast(res.message || 'All active PINs revoked.', 'success');
                    fetchActiveKeys();
                  } catch (err: any) {
                    showToast(err.message || 'Failed to revoke all PINs', 'error');
                  } finally {
                    setRevokingAllPins(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-xs font-semibold inline-flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{revokingAllPins ? 'Revoking...' : 'Revoke All Pins'}</span>
              </button>
            )}
          </div>

          {/* Active Keys Filter Toolbar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search active passes by entrant name, email..."
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={keySpaceFilter}
                onChange={(e) => setKeySpaceFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Facility Spaces</option>
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </select>

              {(keySearch || keySpaceFilter !== 'all') && (
                <button
                  onClick={() => {
                    setKeySearch('');
                    setKeySpaceFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Entrant</th>
                  <th className="py-2.5 px-4">Facility Space</th>
                  <th className="py-2.5 px-4">Valid Till</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredActiveKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white max-w-[160px] truncate" title={k.holder_name}>{k.holder_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono max-w-[180px] truncate" title={k.holder_email}>{k.holder_email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-indigo-300">
                        {k.space_name}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-400 font-medium">
                      {formatValidTill(k.expires_at) || k.valid_till || 'Active'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleRevokeKey(k.id, k.holder_name, k.space_name)}
                        disabled={revokingKeyId === k.id}
                        className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-xs transition active:scale-95 disabled:opacity-50"
                      >
                        {revokingKeyId === k.id ? 'Revoking...' : 'Revoke Pass'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredActiveKeys.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      {activeKeys.length === 0
                        ? 'Zero active access passes in the facility.'
                        : 'No active keys match the filter criteria.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
          <div className="block md:hidden divide-y divide-slate-800/80">
            {filteredActiveKeys.map((k) => {
              const isExpanded = expandedActiveKeyId === k.id;
              return (
                <div key={k.id} className="p-3.5 bg-slate-900 transition">
                  <div
                    onClick={() => setExpandedActiveKeyId(isExpanded ? null : k.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-xs truncate max-w-[150px]">
                          {k.holder_name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-indigo-300">
                          {k.space_name}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-emerald-400 mt-1">
                        {formatValidTill(k.expires_at) || k.valid_till || 'Active'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleRevokeKey(k.id, k.holder_name, k.space_name)}
                        disabled={revokingKeyId === k.id}
                        className="px-2 py-1 rounded-lg bg-rose-950/90 text-rose-300 border border-rose-800 text-xs font-semibold active:scale-95"
                      >
                        {revokingKeyId === k.id ? 'Revoking...' : 'Revoke'}
                      </button>
                      <button
                        onClick={() => setExpandedActiveKeyId(isExpanded ? null : k.id)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-1.5 text-xs text-slate-300 animate-in fade-in duration-100">
                      <div>
                        <span className="text-slate-500">Holder Email:</span>{' '}
                        <span className="font-mono text-slate-200">{k.holder_email}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Space Slug:</span>{' '}
                        <span className="font-mono text-slate-200">{k.space_id}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Expires At:</span>{' '}
                        <span className="font-mono text-slate-400">{new Date(k.expires_at).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {activeKeys.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-xs">
                Zero active access passes in the facility.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ADMINS */}
      {activeTab === 'admins' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">System Administrators</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                  {filteredAdmins.length} {filteredAdmins.length === 1 ? 'Admin' : 'Admins'}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setCreationWarningAck(false);
                setCreationWarningTarget('admin');
              }}
              className="w-full sm:w-auto justify-center flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Administrator</span>
            </button>
          </div>

          {/* Admins Filter Toolbar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search administrators by name, email..."
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={adminRoleFilter}
                onChange={(e) => setAdminRoleFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Admin Roles</option>
                <option value="root">Root Administrators Only</option>
                <option value="standard">Standard Administrators Only</option>
              </select>

              {(adminSearch || adminRoleFilter !== 'all') && (
                <button
                  onClick={() => {
                    setAdminSearch('');
                    setAdminRoleFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Created</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredAdmins.map((adm) => (
                  <tr key={adm.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-semibold text-white max-w-[140px] truncate" title={adm.name}>{adm.name}</td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px] max-w-[170px] truncate" title={adm.email}>{adm.email}</td>
                    <td className="py-3 px-4">
                      {adm.is_root ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700/80">
                          <Crown className="w-3 h-3 text-amber-400" />
                          <span>ROOT ADMIN</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
                          <ShieldCheck className="w-3 h-3 text-cyan-400" />
                          <span>ADMIN</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">{formatTimeAgo(adm.created_at)}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDeleteAdmin(adm.id, adm.email)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 transition"
                        title="Delete administrator"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredAdmins.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      {admins.length === 0
                        ? 'No additional administrators registered.'
                        : 'No administrators match the filter criteria.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
          <div className="block md:hidden divide-y divide-slate-800/80">
            {filteredAdmins.map((adm) => {
              const isExpanded = expandedAdminId === adm.id;
              return (
                <div key={adm.id} className="p-3.5 bg-slate-900 transition">
                  <div
                    onClick={() => setExpandedAdminId(isExpanded ? null : adm.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-xs truncate max-w-[150px]">
                          {adm.name}
                        </span>
                        {adm.is_root ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                            <Crown className="w-2.5 h-2.5 text-amber-400" />
                            <span>ROOT</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                            <ShieldCheck className="w-2.5 h-2.5 text-cyan-400" />
                            <span>ADMIN</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1 truncate">
                        {adm.email}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDeleteAdmin(adm.id, adm.email)}
                        className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 hover:text-rose-300 border border-rose-800/60 active:scale-95"
                        title="Delete administrator"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setExpandedAdminId(isExpanded ? null : adm.id)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-1.5 text-xs text-slate-300 animate-in fade-in duration-100">
                      <div>
                        <span className="text-slate-500">Email:</span>{' '}
                        <span className="font-mono text-slate-200">{adm.email}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Role Privilege:</span>{' '}
                        <span className="text-slate-200">
                          {adm.is_root ? 'Root Administrator' : 'Standard Administrator'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Registered:</span>{' '}
                        <span className="font-mono text-slate-400">{new Date(adm.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredAdmins.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-xs">
                {admins.length === 0
                  ? 'No additional administrators registered.'
                  : 'No administrators match the filter criteria.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT LOGS */}
      {activeTab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Facility Master Audit Logs</h3>
              <p className="text-[11px] text-slate-400">Cryptographically verifiable and immutable event log</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-xs">
                {['24h', '7d', '30d', 'all'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setLogRange(r)}
                    className={`px-2.5 py-1 rounded-md font-medium uppercase text-[10px] transition ${
                      logRange === r
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Space Filter */}
              <select
                value={logSpace}
                onChange={(e) => setLogSpace(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="all">All Spaces</option>
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </select>

              {/* Club Filter */}
              <select
                value={logClub}
                onChange={(e) => setLogClub(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="all">All Clubs</option>
                {availableClubs.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="__independent__">Independent / Unaffiliated</option>
              </select>

              {/* Event Type Filter */}
              <select
                value={logEvent}
                onChange={(e) => setLogEvent(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="all">All Event Types</option>
                <option value="ACCESS_GRANTED">Access Granted</option>
                <option value="DOOR_UNLOCKED">Door Unlocked</option>
                <option value="REQUEST_REJECTED">Request Rejected</option>
                <option value="REG_ACCEPTED">Registration Accepted</option>
                <option value="PIN_REVOKED">PIN Revoked</option>
              </select>

              <button
                onClick={() => api.downloadAuditLogsCsv()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="Search by entrant name, email, club, space, approver, or justification..."
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          {/* Day Color Strip Legend - Starts Monday, compact on mobile without wrapping */}
          <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] text-slate-400 font-mono px-1 overflow-x-auto scrollbar-none py-0.5">
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px] shrink-0 mr-0.5">Day Bar:</span>
            {WEEK_DAYS.map((d) => (
              <span key={d.name} className="flex items-center gap-1 shrink-0">
                <span className={`w-1.5 h-3 rounded-full ${d.bg} inline-block`} />
                <span>{d.name}</span>
              </span>
            ))}
          </div>

          {/* Desktop Table View (hidden on mobile to prevent sideways scroll) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3 whitespace-nowrap">Timestamp</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Event</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Facility Space</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Entrant</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Club</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Authority</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Details / Purpose</th>
                  <th className="py-2.5 px-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const justificationText = log.justification_snapshot || log.justification;
                  const dayInfo = getDayColor(log.created_at);
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className={`cursor-pointer transition select-none ${
                          isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-1.5 h-4 rounded-full ${dayInfo.bg} shrink-0 inline-block`}
                              title={`${dayInfo.name} (${new Date(log.created_at).toLocaleDateString()})`}
                            />
                            <span>{formatTimeAgo(log.created_at)}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              log.event_type === 'ACCESS_GRANTED'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                                : log.event_type === 'DOOR_UNLOCKED'
                                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                                : log.event_type === 'REQUEST_REJECTED'
                                ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                                : log.event_type === 'REG_ACCEPTED'
                                ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                                : log.event_type === 'PIN_REVOKED'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {log.event_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-[150px]">
                          <div className="text-indigo-300 font-medium whitespace-nowrap truncate" title={log.space_name}>
                            {log.space_name}
                          </div>
                          {log.door_name && (
                            <div className="text-[10px] text-cyan-300 font-mono truncate" title={`Door: ${log.door_name} (${log.device_id || ''})`}>
                              🚪 {log.door_name}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 max-w-[140px]">
                          <div className="font-semibold text-white truncate" title={log.actor_name}>{log.actor_name}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate" title={log.actor_email}>{log.actor_email}</div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[130px]">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 truncate inline-block max-w-[120px]" title={log.club_name || 'Independent'}>
                            {log.club_name || 'Independent'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-[140px]">
                          <div className="font-medium text-white truncate" title={log.authority_name || 'System / Direct'}>{log.authority_name || 'System / Direct'}</div>
                          {log.authority_email && (
                            <div className="text-[10px] text-slate-500 font-mono truncate" title={log.authority_email}>{log.authority_email}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 max-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-slate-300 italic truncate text-[11px] block max-w-[150px]"
                              title={justificationText || 'Direct/system entry'}
                            >
                              {justificationText ? `"${justificationText}"` : '—'}
                            </span>
                            {justificationText && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedLogId(isExpanded ? null : log.id);
                                }}
                                className="text-slate-400 hover:text-indigo-300 p-0.5 rounded hover:bg-slate-800 transition shrink-0"
                                title="Click to view full un-truncated details"
                              >
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedLogId(isExpanded ? null : log.id);
                            }}
                            className="p-1 text-slate-400 hover:text-white"
                            title={isExpanded ? 'Collapse row' : 'Expand full details'}
                          >
                            <ChevronDown
                              className={`w-4 h-4 transition-transform inline-block ${
                                isExpanded ? 'rotate-180 text-white' : ''
                              }`}
                            />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-950/90 border-t border-slate-800/80 animate-in fade-in duration-100">
                          <td colSpan={8} className="p-3.5 text-xs text-slate-300">
                            <div className="space-y-2 bg-slate-900/80 border border-slate-800 rounded-xl p-3 shadow-inner">
                              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
                                <span>Audit Event Details & Stated Purpose</span>
                                <span className="font-mono text-slate-400">
                                  {new Date(log.created_at).toLocaleString()}
                                </span>
                              </div>
                              <div className="bg-slate-950 border border-slate-800/90 p-2.5 rounded-lg text-slate-200">
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-0.5">
                                  Access Justification / Purpose:
                                </div>
                                <div className="text-xs italic text-indigo-200 font-medium">
                                  {justificationText
                                    ? `"${justificationText}"`
                                    : 'No justification submitted (direct/system entry)'}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5 text-[11px] text-slate-400">
                                <div><span className="text-slate-500 font-medium">Facility Space:</span> <span className="text-slate-200">{log.space_name}</span> <span className="font-mono text-[10px] text-slate-500">({log.space_id})</span>{log.door_name && <span className="text-cyan-300 font-mono text-[11px] ml-1.5">• 🚪 {log.door_name}</span>}</div>
                                <div><span className="text-slate-500 font-medium">Entrant Club:</span> <span className="text-slate-200">{log.club_name || 'Independent'}</span></div>
                                <div><span className="text-slate-500 font-medium">Authority:</span> <span className="text-slate-200">{log.authority_name || 'System'}</span> {log.authority_email && <span className="font-mono text-[10px] text-slate-500">({log.authority_email})</span>}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No matching audit log entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
          <div className="block md:hidden divide-y divide-slate-800/80">
            {filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const justificationText = log.justification_snapshot || log.justification;
              const dayInfo = getDayColor(log.created_at);
              return (
                <div key={log.id} className="p-3.5 bg-slate-900 transition">
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase ${
                            log.event_type === 'ACCESS_GRANTED'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                              : log.event_type === 'DOOR_UNLOCKED'
                              ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                              : log.event_type === 'REQUEST_REJECTED'
                              ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                              : log.event_type === 'REG_ACCEPTED'
                              ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                              : log.event_type === 'PIN_REVOKED'
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {log.event_type.replace(/_/g, ' ')}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono">
                          {log.space_name}{log.door_name ? ` • 🚪 ${log.door_name}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="truncate text-xs text-white font-medium flex-1 min-w-0" title={log.actor_name}>
                          {log.actor_name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          <span
                            className={`w-1.5 h-3.5 rounded-full ${dayInfo.bg} inline-block shrink-0`}
                            title={`${dayInfo.name} (${new Date(log.created_at).toLocaleDateString()})`}
                          />
                          <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">
                            {formatTimeOnly(log.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedLogId(isExpanded ? null : log.id);
                      }}
                      className="p-1 text-slate-400 hover:text-white shrink-0"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                      />
                    </button>
                  </div>

                  {/* Dropdown Expansion */}
                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2 text-xs animate-in fade-in duration-100">
                      <div className="bg-slate-950 border border-slate-800/90 p-2.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-0.5">
                          Access Justification / Purpose:
                        </span>
                        <p className="italic text-indigo-200 text-xs">
                          {justificationText
                            ? `"${justificationText}"`
                            : 'No justification submitted (direct/system entry)'}
                        </p>
                      </div>

                      <div className="space-y-1.5 text-[11px] text-slate-400">
                        <div>
                          <span className="text-slate-500">Entrant Email:</span>{' '}
                          <span className="font-mono text-slate-200">{log.actor_email}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Club:</span>{' '}
                          <span className="text-indigo-300">{log.club_name || 'Independent'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">
                            {log.event_type === 'REQUEST_REJECTED' || log.event_type === 'REG_REJECTED'
                              ? 'Rejected By:'
                              : log.event_type === 'PIN_REVOKED'
                              ? 'Revoked By:'
                              : 'Authority:'}
                          </span>{' '}
                          <span className="text-slate-200">{log.authority_name || 'System / Direct'}</span>{' '}
                          {log.authority_email && (
                            <span className="font-mono text-[10px] text-slate-500">({log.authority_email})</span>
                          )}
                        </div>
                        <div>
                          <span className="text-slate-500">Timestamp:</span>{' '}
                          <span className="font-mono text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Facility Space:</span>{' '}
                          <span className="text-slate-200">{log.space_name}</span>{' '}
                          <span className="font-mono text-[10px] text-slate-500">({log.space_id})</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredLogs.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-xs">
                No matching audit log entries found.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: FACILITY SPACES & ESPS (Root Administrator Only) */}
      {activeTab === 'spaces' && currentUser?.is_root && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">Facility Spaces & ESP32 Hardware</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                  {filteredSpaces.length} {filteredSpaces.length === 1 ? 'Space' : 'Spaces'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                  Root Admin Exclusive
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Register hardware ESP32 microcontrollers and physical access zones
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleManualRefreshSpaces}
                disabled={isRefreshingSpaces}
                className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium border border-slate-700/80 transition active:scale-95 disabled:opacity-50"
                title="Reload facility spaces and door locks from server"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSpaces ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
                <span>Refresh</span>
              </button>
              <button
                onClick={() => setShowSpaceModal(true)}
                className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>+ Register Space</span>
              </button>
            </div>
          </div>

          {/* Spaces Filter Toolbar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search facility spaces by name, slug, hardware ID..."
                value={spaceSearch}
                onChange={(e) => setSpaceSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={spaceStatusFilter}
                onChange={(e) => setSpaceStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>

              {(spaceSearch || spaceStatusFilter !== 'all') && (
                <button
                  onClick={() => {
                    setSpaceSearch('');
                    setSpaceStatusFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Facility Space Name</th>
                  <th className="py-2.5 px-4">System Slug</th>
                  <th className="py-2.5 px-4">Door Locks (Hardware)</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">WebSocket Channel</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredSpaces.map((sp) => (
                  <tr key={sp.slug} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-semibold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                      <span>{sp.name}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-indigo-300">{sp.slug}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1.5 min-w-[220px]">
                        {sp.assigned_devices && sp.assigned_devices.length > 0 ? (
                          sp.assigned_devices.map((dev) => (
                            <div
                              key={dev.device_id}
                              className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800/90 rounded-lg px-2.5 py-1 text-xs"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    dev.is_online ? 'bg-emerald-400' : 'bg-slate-500'
                                  }`}
                                />
                                <span className="font-semibold text-slate-200 truncate">{dev.name}</span>
                                <span className="font-mono text-[10px] text-cyan-300">({dev.device_id})</span>
                              </div>
                              {currentUser?.is_root && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => handleOpenEditLock(dev.device_id, dev.name, sp.slug, dev.is_disabled)}
                                    className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/40 rounded transition"
                                    title={`Edit ${dev.name} (${dev.device_id})`}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteLock(dev.device_id, dev.name, sp.slug)}
                                    className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition"
                                    title={`Remove ${dev.name} (${dev.device_id})`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <span className="font-mono text-[11px] text-emerald-300 font-semibold">
                            {sp.esp32_device_id || `ESP32_${sp.slug.toUpperCase()}_DOOR`}
                          </span>
                        )}
                        {currentUser?.is_root && (
                          <button
                            type="button"
                            onClick={() => handleOpenAddLock(sp.slug, sp.name)}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 mt-0.5 hover:underline w-fit"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Lock to Space</span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                        {sp.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                      /api/v1/ws/{sp.slug}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {currentUser?.is_root && (
                          <button
                            onClick={() => handleOpenEditSpace(sp)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/40 border border-transparent hover:border-indigo-900/60 transition"
                            title={`Edit Facility Space ${sp.name}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {currentUser?.is_root && (
                          <button
                            onClick={() => handleDeleteSpace(sp.slug, sp.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/60 transition"
                            title={`Delete Facility Space ${sp.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSpaces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No facility spaces match the filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
          <div className="block md:hidden divide-y divide-slate-800/80">
            {filteredSpaces.map((sp) => {
              const isExpanded = expandedSpaceSlug === sp.slug;
              return (
                <div key={sp.slug} className="p-3.5 bg-slate-900 transition">
                  <div
                    onClick={() => setExpandedSpaceSlug(isExpanded ? null : sp.slug)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        <span className="font-bold text-white text-xs truncate">
                          {sp.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                          {sp.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-indigo-300 mt-1">
                        slug: {sp.slug}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedSpaceSlug(isExpanded ? null : sp.slug)}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                      />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2.5 text-xs text-slate-300 animate-in fade-in duration-100">
                      <div>
                        <div className="text-slate-400 font-medium mb-1.5 flex items-center justify-between">
                          <span>Door Locks ({sp.assigned_devices?.length || 1}):</span>
                          {currentUser?.is_root && (
                            <button
                              type="button"
                              onClick={() => handleOpenAddLock(sp.slug, sp.name)}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 hover:underline"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Lock</span>
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {sp.assigned_devices && sp.assigned_devices.length > 0 ? (
                            sp.assigned_devices.map((dev) => (
                              <div
                                key={dev.device_id}
                                className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1 text-xs"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      dev.is_online ? 'bg-emerald-400' : 'bg-slate-500'
                                    }`}
                                  />
                                  <span className="font-semibold text-slate-200 truncate">{dev.name}</span>
                                  <span className="font-mono text-[10px] text-cyan-300 truncate">({dev.device_id})</span>
                                </div>
                                {currentUser?.is_root && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => handleOpenEditLock(dev.device_id, dev.name, sp.slug, dev.is_disabled)}
                                      className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/40 rounded transition"
                                      title={`Edit ${dev.name}`}
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteLock(dev.device_id, dev.name, sp.slug)}
                                      className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition"
                                      title={`Remove ${dev.name}`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="font-mono text-emerald-300 font-semibold text-[11px]">
                              {sp.esp32_device_id || `ESP32_${sp.slug.toUpperCase()}_DOOR`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500">WebSocket Channel:</span>{' '}
                        <span className="font-mono text-slate-400">/api/v1/ws/{sp.slug}</span>
                      </div>
                      {currentUser?.is_root && (
                        <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2">
                          <button
                            onClick={() => handleOpenEditSpace(sp)}
                            className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/80 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit Space</span>
                          </button>
                          <button
                            onClick={() => handleDeleteSpace(sp.slug, sp.name)}
                            className="flex-1 py-1.5 px-3 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove Space</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredSpaces.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-xs">
                No facility spaces match the filter criteria.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: ESP32 HARDWARE & OTA FIRMWARE */}
      {activeTab === 'esp32_hardware' && (
        <div className="space-y-6">
          {/* Live Hardware Telemetry Status & Ping */}
          <ESP32StatusBar
            showToast={showToast}
            isRootAdmin={currentUser?.is_root}
            canViewMac={true}
            onDeleteLock={handleDeleteLock}
            onEditLock={(dev) => handleOpenEditLock(dev.device_id || '', dev.name || 'Door Lock', dev.space_id || '', dev.is_disabled, dev.disabled_reason || '')}
          />

          {/* Master Root Admin Exclusive: Keys, Secrets & OTA Management */}
          {currentUser?.is_root ? (
            <ESP32HardwareManager
              spaces={spaces}
              showToast={showToast}
              onSpacesUpdated={fetchSpaces}
            />
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl">
              <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Cpu className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">
                Hardware Telemetry Monitor
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Real-time node telemetry, heartbeat ping latency, and connection states are shown above.
                Cryptographic hardware secrets, token rotation, and Over-The-Air (OTA) firmware deployments are restricted to the Master Root Administrator.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Facility Space & ESP32 Controller */}
      {showSpaceModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Register Facility Space</h3>
                  <p className="text-[11px] text-slate-400">Provision a physical access space with its primary door lock</p>
                </div>
              </div>
              <button
                onClick={() => setShowSpaceModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSpace} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Facility Space Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SandBoxx 2"
                  value={spaceForm.name}
                  onChange={(e) => {
                    const nameVal = e.target.value;
                    const autoSlug = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                    setSpaceForm((prev) => ({
                      ...prev,
                      name: nameVal,
                      slug: prev.slug === '' || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ? autoSlug : prev.slug,
                    }));
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  System Slug Identifier <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. sandboxx_2"
                  value={spaceForm.slug}
                  onChange={(e) => setSpaceForm({ ...spaceForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">Unique alphanumeric key used in database relations and routes</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Initial Door Lock Friendly Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Main Door / Front Entrance"
                  value={spaceForm.lock_name}
                  onChange={(e) => setSpaceForm({ ...spaceForm, lock_name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">Friendly display name for this space's initial door lock controller</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    ESP32 Hardware ID <span className="text-slate-500 text-[10px]">(Optional)</span>
                  </label>
                </div>
                <input
                  type="text"
                  placeholder={spaceForm.slug ? `e.g. ESP32_${spaceForm.slug.toUpperCase()}_DOOR` : 'e.g. ESP32_SANDBOXX_2_DOOR'}
                  value={spaceForm.esp32_device_id}
                  onChange={(e) => setSpaceForm({ ...spaceForm, esp32_device_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">Unique hardware controller identifier (auto-generated if left blank)</p>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={spaceForm.is_active}
                    onChange={(e) => setSpaceForm({ ...spaceForm, is_active: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                  />
                  <span>Immediately enable facility space for access requests</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSpaceModal(false)}
                  disabled={spaceSubmitting}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={spaceSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow flex items-center gap-1.5"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>{spaceSubmitting ? 'Registering...' : 'Register Facility Space'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Additional Lock to Space */}
      {showAddLockModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Lock to Space</h3>
                  <p className="text-[11px] text-slate-400">
                    Space: <span className="text-indigo-300 font-semibold">{addLockForm.space_name}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddLockModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAddLock} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Door Lock Friendly Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Back Door / Lab 2 Side Door"
                  value={addLockForm.name}
                  onChange={(e) => setAddLockForm({ ...addLockForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ESP32 Hardware Device ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESP32_SANDBOXX_0_BACK_DOOR"
                  value={addLockForm.device_id}
                  onChange={(e) => setAddLockForm({ ...addLockForm, device_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">Unique hardware controller identifier</p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddLockModal(false)}
                  disabled={addLockSubmitting}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLockSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
                >
                  {addLockSubmitting ? 'Registering Lock...' : 'Add Door Lock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Facility Space */}
      {editingSpace && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Facility Space</h3>
                  <p className="text-[11px] text-slate-400 font-mono">{editingSpace.slug}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingSpace(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSpaceEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Facility Space Display Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SandBoxx 0"
                  value={editSpaceForm.name}
                  onChange={(e) => setEditSpaceForm({ ...editSpaceForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Primary ESP32 Controller Device ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. ESP32_SANDBOXX_0_DOOR"
                  value={editSpaceForm.esp32_device_id}
                  onChange={(e) => setEditSpaceForm({ ...editSpaceForm, esp32_device_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSpaceForm.is_active}
                    onChange={(e) => setEditSpaceForm({ ...editSpaceForm, is_active: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-slate-200">Space is Operational & Active</span>
                </label>
                <p className="text-[10px] text-slate-400">
                  When inactive, student registration and access pass requests for this facility space are suspended.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingSpace(null)}
                  disabled={editSpaceSubmitting}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSpaceSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
                >
                  {editSpaceSubmitting ? 'Saving Changes...' : 'Save Space Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Door Lock */}
      {editingLock && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Door Controller Lock</h3>
                  <p className="text-[11px] text-slate-400 font-mono">{editingLock.device_id}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingLock(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLockEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Door Lock Friendly Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Main Glass Door"
                  value={editingLock.name}
                  onChange={(e) => setEditingLock({ ...editingLock, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Assign to Facility Space
                </label>
                <select
                  value={editingLock.space_id}
                  onChange={(e) => setEditingLock({ ...editingLock, space_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {spaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name} ({sp.slug})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Reassigning shifts this physical lock hardware to control access for the selected space.
                </p>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingLock.is_disabled}
                    onChange={(e) => setEditingLock({ ...editingLock, is_disabled: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-slate-200">Disable Door Lock</span>
                </label>
                <p className="text-[10px] text-slate-400">
                  When disabled, ordinary PINs are rejected at this door (Emergency TOTP remains active).
                </p>

                {editingLock.is_disabled && (
                  <div className="pt-2">
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                      Reason for Lockout
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Lock hardware maintenance"
                      value={editingLock.disabled_reason}
                      onChange={(e) => setEditingLock({ ...editingLock, disabled_reason: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingLock(null)}
                  disabled={editLockSubmitting}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLockSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
                >
                  {editLockSubmitting ? 'Saving Lock...' : 'Save Lock Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add SuperUser */}
      {showSuModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm font-bold text-white">Appoint SuperUser</h3>
              <button
                onClick={() => {
                  setShowSuModal(false);
                  setSuAutofilledUser(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 mb-4">
              <strong>Account Governance Policy:</strong> Clubs, associations, and societies are not to be registered as SuperUser accounts. Only register individuals.
            </div>

            <form onSubmit={handleSaveSuperuser} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">Campus Email</label>
                  {isLookingUpSu && (
                    <span className="flex items-center gap-1 text-[10px] text-indigo-400">
                      <Loader2 className="w-3 h-3 animate-spin" /> Looking up student...
                    </span>
                  )}
                  {suAutofilledUser && !isLookingUpSu && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                      <CheckSquare className="w-3 h-3" /> Linked: {suAutofilledUser}
                    </span>
                  )}
                </div>
                <input
                  type="email"
                  required
                  placeholder="name@hyderabad.bits-pilani.ac.in"
                  value={suForm.email}
                  onChange={(e) => {
                    const completed = autoCompleteInstitutionalEmail(suForm.email, e.target.value, allowedDomain, e.target);
                    setSuForm({ ...suForm, email: completed });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">Name</label>
                  <span className="text-[10px] text-slate-500">{suForm.name.length}/25</span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={25}
                  placeholder="fill in what people call you"
                  value={suForm.name}
                  onChange={(e) => setSuForm({ ...suForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Mobile Phone</label>
                <input
                  type="tel"
                  required
                  placeholder="+919876543210"
                  value={suForm.phone}
                  onChange={(e) => setSuForm({ ...suForm, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">College Year</label>
                <select
                  value={suForm.collegeYear}
                  onChange={(e) => setSuForm({ ...suForm, collegeYear: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                  <option value="Postgraduate">Postgraduate</option>
                  <option value="Not Applicable">Not Applicable</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Club</label>
                <select
                  value={suForm.clubSelection}
                  onChange={(e) => setSuForm({ ...suForm, clubSelection: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {availableClubs.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value="">No Club (Independent SuperUser)</option>
                  <option value="__new__">+ Register New Club...</option>
                </select>
              </div>

              {suForm.clubSelection === '__new__' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">New Club Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter club name"
                    value={suForm.customClub}
                    onChange={(e) => setSuForm({ ...suForm, customClub: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Authorized Facility Spaces</label>
                <div className="space-y-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  {spaces.map((sp) => (
                    <label key={sp.slug} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(suForm.spacePermissions[sp.slug])}
                        onChange={(e) =>
                          setSuForm({
                            ...suForm,
                            spacePermissions: {
                              ...suForm.spacePermissions,
                              [sp.slug]: e.target.checked,
                            },
                          })
                        }
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                      />
                      <span>{sp.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800 sticky bottom-0 bg-slate-900/95 backdrop-blur-sm -mx-5 -mb-5 p-3.5 sm:-mx-6 sm:-mb-6 sm:p-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowSuModal(false);
                    setSuAutofilledUser(null);
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition active:scale-95 shadow"
                >
                  Create SuperUser
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Existing SuperUser */}
      {editingSu && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white">Edit SuperUser Details & Authority</h3>
                <p className="text-[11px] text-slate-400 font-mono">{editingSu.email}</p>
              </div>
              <button onClick={() => setEditingSu(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 mb-4">
              <strong>Account Governance Policy:</strong> Clubs, associations, and societies are not to be registered as SuperUser accounts. Only register individuals.
            </div>

            <form onSubmit={handleUpdateSuperuser} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Name <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-500">{editSuForm.name.length}/25</span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={25}
                  placeholder="fill in what people call you"
                  value={editSuForm.name}
                  onChange={(e) => setEditSuForm({ ...editSuForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  College Year <span className="text-rose-500">*</span>
                </label>
                <select
                  value={editSuForm.collegeYear}
                  onChange={(e) => setEditSuForm({ ...editSuForm, collegeYear: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                  <option value="Postgraduate">Postgraduate</option>
                  <option value="Not Applicable">Not Applicable</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mobile Phone <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+919876543210"
                  value={editSuForm.phone}
                  onChange={(e) => setEditSuForm({ ...editSuForm, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Club</label>
                <select
                  value={editSuForm.clubSelection}
                  onChange={(e) => setEditSuForm({ ...editSuForm, clubSelection: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {availableClubs.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value="">No Club (Independent SuperUser)</option>
                  <option value="__new__">+ Register New Club...</option>
                </select>
              </div>

              {editSuForm.clubSelection === '__new__' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">New Club Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter club name"
                    value={editSuForm.customClub}
                    onChange={(e) => setEditSuForm({ ...editSuForm, customClub: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Designated Space Authority <span className="text-rose-500">*</span>
                </label>
                {(() => {
                  const checkedCount = Object.values(editSuForm.spacePermissions).filter(Boolean).length;
                  return (
                    <>
                      <div className="space-y-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        {spaces.map((sp) => {
                          const isChecked = Boolean(editSuForm.spacePermissions[sp.slug]);
                          const isLastChecked = isChecked && checkedCount <= 1;
                          return (
                            <label
                              key={sp.slug}
                              className={`flex items-center gap-2 text-xs ${
                                isLastChecked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-300 cursor-pointer'
                              }`}
                              title={isLastChecked ? 'At least 1 Facility Space must remain selected' : ''}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isLastChecked}
                                onChange={(e) => {
                                  if (!e.target.checked && checkedCount <= 1) return;
                                  setEditSuForm({
                                    ...editSuForm,
                                    spacePermissions: {
                                      ...editSuForm.spacePermissions,
                                      [sp.slug]: e.target.checked,
                                    },
                                  });
                                }}
                                className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 disabled:opacity-60"
                              />
                              <span>{sp.name}</span>
                              {isLastChecked && (
                                <span className="text-[9px] font-mono text-amber-400 ml-auto">(Min 1 required)</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        At least one Facility Space must stay checked. Use Revoke to remove all privileges.
                      </p>
                    </>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800 sticky bottom-0 bg-slate-900/95 backdrop-blur-sm -mx-5 -mb-5 p-3.5 sm:-mx-6 sm:-mb-6 sm:p-4">
                <button
                  type="button"
                  onClick={() => setEditingSu(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition active:scale-95 shadow"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Secondary Admin */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm font-bold text-white">Add Administrator</h3>
              <button onClick={() => setShowAdminModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 mb-4">
              <strong>Security Policy:</strong> Never grant administrator access to students. Admins possess facility-wide oversight, audit log viewing, and key revocation privileges.
            </div>

            <form onSubmit={handleSaveAdmin} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">Staff Name</label>
                  <span className="text-[10px] text-slate-500">{adminForm.name.length}/25</span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={25}
                  placeholder="fill in what people call you"
                  value={adminForm.name}
                  onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Staff / Faculty Email</label>
                <input
                  type="email"
                  required
                  placeholder="faculty@hyderabad.bits-pilani.ac.in"
                  value={adminForm.email}
                  onChange={(e) => {
                    const completed = autoCompleteInstitutionalEmail(adminForm.email, e.target.value, allowedDomain, e.target);
                    setAdminForm({ ...adminForm, email: completed });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              {/* Root Admin Checkbox (Visible when creator is Root Admin) */}
              {currentUser?.is_root && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 cursor-pointer hover:border-amber-700 transition select-none">
                  <input
                    type="checkbox"
                    checked={adminForm.is_root}
                    onChange={(e) => setAdminForm({ ...adminForm, is_root: e.target.checked })}
                    className="mt-0.5 rounded border-amber-700 text-amber-500 focus:ring-amber-500 bg-slate-950"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-amber-200">Grant Root Administrator Status</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Grants full authority over Facility Space registration, ESP32 hardware secrets, and OTA firmware deployments.
                    </p>
                  </div>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition active:scale-95 shadow"
                >
                  Confirm & Create Admin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: System Reset */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-rose-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <h3 className="text-sm font-bold text-rose-300 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-rose-400" />
                <span>Administrator Full System Reset</span>
              </h3>
              <button onClick={() => setShowResetModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              <strong>Warning:</strong> This will execute an administrative system reset:
              <br />• Deletes <strong>ALL SuperUsers</strong> and student/user accounts.
              <br />• Revokes all active PINs, pass requests, and space assignments.
              <br />• Clears entry logs from the active portal view (offline audit archive exported; internal 3-year audit log preserved).
              <br />• Removes all registered clubs from the system.
              <br />• <strong>Strictly preserves</strong> current Facility Spaces, Admin accounts, and ESP door locks.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
              {currentUser?.is_root ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowResetModal(false);
                    setShowFactoryResetModal(true);
                  }}
                  disabled={resetLoading}
                  className="px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-700/70 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Factory Reset...</span>
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  disabled={resetLoading}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteReset}
                  disabled={resetLoading}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white transition active:scale-95 shadow"
                >
                  {resetLoading ? 'Executing Purge...' : 'Confirm System Reset'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Factory Reset (Zero-State — Root Admin Exclusive) */}
      {showFactoryResetModal && currentUser?.is_root && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-rose-600 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <h3 className="text-sm font-bold text-rose-300 flex items-center gap-1.5">
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span>Root Admin Factory Reset (Zero-State)</span>
              </h3>
              <button onClick={() => setShowFactoryResetModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-rose-950/50 border border-rose-700/70 rounded-xl p-3 text-xs text-rose-200 leading-relaxed mb-4 space-y-1.5">
              <p className="font-bold text-rose-100">⚠️ DANGER: Executing Factory Reset wipes the entire setup to 0 spaces & 0 locks:</p>
              <p>• Permanently removes <strong>ALL Facility Spaces</strong> and <strong>ALL ESP32 Door Locks</strong>.</p>
              <p>• Deletes <strong>ALL SuperUsers</strong>, student/user accounts, and <strong>ALL other Admin accounts</strong>.</p>
              <p>• Revokes all active PINs, pass requests, assignments, and clubs.</p>
              <p>• Exports an offline CSV archive and clears active UI logs (3-year immutable audit archive preserved).</p>
              <p>• Leaves <strong>ONLY</strong> your initiating Root Admin account active so you can reconfigure spaces and locks from scratch.</p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowFactoryResetModal(false)}
                disabled={factoryResetLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteFactoryReset}
                disabled={factoryResetLoading}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition active:scale-95 shadow"
              >
                {factoryResetLoading ? 'Resetting Everything...' : 'Confirm Factory Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal for Creating New Users */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">New User Registration QR</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center justify-center bg-white rounded-xl p-4">
              <QRCodeSVG value={qrUrl || window.location.origin} size={200} level="M" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Portal URL (Auto-detected from current host)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={qrUrl}
                  onChange={(e) => setQrUrl(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  placeholder="https://your-domain.com"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyToClipboard(qrUrl || window.location.origin);
                    if (ok) showToast('Registration URL copied!', 'success');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Automatically uses your current domain/IP. Edit above if sharing a different public domain.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Structured Authority Creation Warning Popup */}
      {creationWarningTarget && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-600/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {creationWarningTarget === 'admin'
                      ? 'Administrator Privilege Warning'
                      : 'SuperUser Authority Warning'}
                  </h3>
                  <p className="text-[11px] text-amber-300">Read carefully before proceeding</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreationWarningTarget(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 leading-relaxed">
              {creationWarningTarget === 'admin' ? (
                <p>
                  Admins have authority to create SuperUsers who have permanent access to registered spaces. This is not meant to be given to students.
                </p>
              ) : (
                <p>
                  SuperUsers authorize access requests of a large number of people. Clubs, associations, societies, or similar email IDs which are shared by multiple people are not to be registered as SuperUsers. This creates difficulty in tracking people who are to be held responsible.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer select-none bg-amber-950/20 border border-amber-800/40 rounded-xl p-3">
              <input
                type="checkbox"
                checked={creationWarningAck}
                onChange={(e) => setCreationWarningAck(e.target.checked)}
                className="mt-0.5 rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500"
              />
              <span>
                I have read and understood the {creationWarningTarget === 'admin' ? 'Administrator' : 'SuperUser'} responsibilities and security implications above.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreationWarningTarget(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!creationWarningAck}
                onClick={() => {
                  const target = creationWarningTarget;
                  setCreationWarningTarget(null);
                  setCreationWarningAck(false);
                  if (target === 'superuser') {
                    proceedToSuModal();
                  } else {
                    setShowAdminModal(true);
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white transition"
              >
                Proceed to Creation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Affiliation Cluster Modal */}
      <AffiliationClusterModal
        isOpen={showRosterModal}
        onClose={() => setShowRosterModal(false)}
        showToast={showToast}
        currentUserRole="admin"
        onCheckLogs={(member) => {
          setShowRosterModal(false);
          setLogSearch(member.email);
          setActiveTab('logs');
          fetchLogs();
        }}
      />
    </div>
  );
};

export default AdminDashboard;
