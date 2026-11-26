import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Key,
  ListFilter,
  Check,
  Copy,
  Volume2,
  VolumeX,
  Download,
  KeyRound,
  Users,
  TrendingUp,
  Send,
  Sparkles,
  Eye,
  EyeOff,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Trash2,
  Cpu,
  MoreHorizontal,
  Search,
  UserPlus,
} from 'lucide-react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { formatTimeAgo, formatTimeOnly, formatValidTill, getDayColor, WEEK_DAYS } from '../utils/format';
import { playAlertChime } from '../utils/audio';
import { pushService } from '../services/pushNotification';
import { copyToClipboard } from '../utils/clipboard';
import { AccessRequest, ActiveKeySummary, PortalLog, UserProfile, UserSpaceCard, SuperUserInfo, Club } from '../types';
import AffiliationClusterModal from './AffiliationClusterModal';
import ESP32StatusBar from './ESP32StatusBar';

interface SuperUserDashboardProps {
  currentUser?: UserProfile | null;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const SuperUserDashboard: React.FC<SuperUserDashboardProps> = ({
  currentUser,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'requests' | 'active-keys' | 'my-access' | 'logs' | 'esp32_hardware'>('requests');

  // Tab 1: Requests
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('panda_su_sound_enabled');
    return saved === null ? true : saved === 'true';
  });

  useEffect(() => {
    const onSoundChanged = (e: Event) => {
      const val = (e as CustomEvent<boolean>).detail;
      if (typeof val === 'boolean') setSoundEnabled(val);
    };
    window.addEventListener('panda-su-sound-changed', onSoundChanged);
    return () => window.removeEventListener('panda-su-sound-changed', onSoundChanged);
  }, []);

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    const res = await pushService.setAlertsEnabled(next);
    if (next && res.pushError) {
      showToast(`In-app alerts ON (${res.pushError})`, 'info');
    } else {
      showToast(next ? 'Alerts & notifications enabled' : 'Alerts & notifications muted', 'info');
    }
  };

  // Tab 2: Active Keys
  const [activeKeys, setActiveKeys] = useState<ActiveKeySummary[]>([]);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [revokingAllPins, setRevokingAllPins] = useState(false);
  const [expandedActiveKeyId, setExpandedActiveKeyId] = useState<string | null>(null);

  // Tab 3: My Access
  const [myCards, setMyCards] = useState<UserSpaceCard[]>([]);
  const [allSpaces, setAllSpaces] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [allSuperusers, setAllSuperusers] = useState<SuperUserInfo[]>([]);
  const [activePins, setActivePins] = useState<Record<string, { pin_code: string; expires_at: string } | null>>({});
  const [myRequests, setMyRequests] = useState<Record<string, AccessRequest | null>>({});
  const [unmaskedPins, setUnmaskedPins] = useState<Record<string, boolean>>({});

  // Modals for My Access
  const [showAddSpaceModal, setShowAddSpaceModal] = useState(false);
  const [selectedNewSpaceId, setSelectedNewSpaceId] = useState('');
  const [selectedNewLeadId, setSelectedNewLeadId] = useState('');
  const [registeringNewSpace, setRegisteringNewSpace] = useState(false);

  const [requestModalSpace, setRequestModalSpace] = useState<UserSpaceCard | null>(null);
  const [requestJustification, setRequestJustification] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Tab 4: Logs
  const [logs, setLogs] = useState<PortalLog[]>([]);
  const [logSpace, setLogSpace] = useState<string>('all');
  const [logClub, setLogClub] = useState<string>('all');
  const [logEvent, setLogEvent] = useState<string>('all');
  const [logRange, setLogRange] = useState<string>('7d');
  const [logSearch, setLogSearch] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [availableClubs, setAvailableClubs] = useState<Club[]>([]);

  // Modal
  const [showRosterModal, setShowRosterModal] = useState(false);

  // Filters for Tab 1: Requests
  const [reqSearch, setReqSearch] = useState('');
  const [reqSpaceFilter, setReqSpaceFilter] = useState('all');
  const [reqYearFilter, setReqYearFilter] = useState('all');
  const [reqTypeFilter, setReqTypeFilter] = useState<'all' | 'ACCESS' | 'REGISTRATION'>('all');

  // Filters for Tab 2: Active Keys
  const [keySearch, setKeySearch] = useState('');
  const [keySpaceFilter, setKeySpaceFilter] = useState('all');

  // Filters for Tab 3: My Access
  const [myAccessSearch, setMyAccessSearch] = useState('');
  const [myAccessSpaceFilter, setMyAccessSpaceFilter] = useState('all');

  // Stats: Registered Users & Daily Request Average (calculated over the week)
  const [stats, setStats] = useState<{ total_registered_users: number; avg_access_requests_per_day: number }>({
    total_registered_users: 0,
    avg_access_requests_per_day: 0,
  });

  const fetchStats = async () => {
    try {
      const res = await api.fetchAdminMetrics();
      setStats({
        total_registered_users: res.total_registered_users,
        avg_access_requests_per_day: res.avg_access_requests_per_day,
      });
    } catch (err) {
      console.warn('Fetch SU stats error:', err);
    }
  };

  // Filtered Requests
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      // Space filter
      if (reqSpaceFilter !== 'all') {
        const space = req.space_slug || req.space_id;
        if (space !== reqSpaceFilter) return false;
      }

      // Year filter
      if (reqYearFilter !== 'all') {
        if ((req.requester_college_year || 'Not Applicable') !== reqYearFilter) return false;
      }

      // Request type filter (Pass requests vs Registrations)
      if (reqTypeFilter !== 'all') {
        const type = req.request_type || 'ACCESS';
        if (type !== reqTypeFilter) return false;
      }

      // Search query
      if (reqSearch.trim()) {
        const q = reqSearch.toLowerCase().trim();
        const match =
          req.requester_name.toLowerCase().includes(q) ||
          (req.requester_email && req.requester_email.toLowerCase().includes(q)) ||
          (req.requester_phone && req.requester_phone.includes(q)) ||
          (req.justification && req.justification.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [requests, reqSearch, reqSpaceFilter, reqYearFilter, reqTypeFilter]);

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

  // Filtered My Access Cards
  const filteredMyCards = useMemo(() => {
    return myCards.filter((card) => {
      // Space filter
      if (myAccessSpaceFilter !== 'all' && card.space_id !== myAccessSpaceFilter) return false;

      // Search query
      if (myAccessSearch.trim()) {
        const q = myAccessSearch.toLowerCase().trim();
        const match =
          card.space_name.toLowerCase().includes(q) ||
          card.space_id.toLowerCase().includes(q) ||
          (card.assigned_superuser_name && card.assigned_superuser_name.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [myCards, myAccessSearch, myAccessSpaceFilter]);

  // Fetch Requests
  const fetchRequests = async () => {
    try {
      const data = await api.fetchRequests(undefined, 'PENDING' as any);
      setRequests(data || []);
    } catch (err) {
      console.error('Fetch requests error:', err);
    }
  };

  // Fetch Active Keys
  const fetchActiveKeys = async () => {
    try {
      const keys = await api.fetchActiveKeys();
      setActiveKeys(keys || []);
    } catch (err) {
      console.error('Fetch active keys error:', err);
    }
  };

  // Fetch My Access
  const fetchMyAccess = async () => {
    try {
      const [cards, spacesList, suList] = await Promise.all([
        api.fetchUserSpaceCards().catch(() => []),
        api.fetchSpaces().catch(() => []),
        api.fetchSuperUsers().catch(() => []),
      ]);
      setMyCards(cards || []);
      setAllSpaces(spacesList || []);
      setAllSuperusers(suList || []);

      const pinsMap: Record<string, { pin_code: string; expires_at: string } | null> = {};
      const reqMap: Record<string, AccessRequest | null> = {};

      for (const c of cards) {
        pinsMap[c.space_id] = c.active_pin && c.active_pin.pin_code
          ? { pin_code: c.active_pin.pin_code, expires_at: c.active_pin.expires_at }
          : null;
        reqMap[c.space_id] = c.pending_request
          ? {
              id: c.pending_request.id,
              requester_email: currentUser?.email || '',
              requester_name: currentUser?.name || '',
              space_id: c.space_id,
              justification: c.pending_request.justification,
              status: 'PENDING' as any,
              created_at: c.pending_request.created_at,
            }
          : null;
      }
      setActivePins(pinsMap);
      setMyRequests(reqMap);
    } catch (err) {
      console.error('Fetch my-access error:', err);
    }
  };

  // Fetch Logs
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

      const data = await api.fetchPortalLogs(
        logSpace === 'all' ? undefined : logSpace,
        startDate,
        undefined,
        500,
        logClub === 'all' ? undefined : logClub === '__independent__' ? 'Independent' : logClub,
        logEvent === 'all' ? undefined : logEvent
      );
      setLogs(data || []);
    } catch (err) {
      console.error('Fetch logs error:', err);
    }
  };

  useEffect(() => {
    api.fetchClubs().then((c) => setAvailableClubs(c || [])).catch(() => {});
    fetchRequests();
    fetchActiveKeys();
    fetchMyAccess();
    fetchLogs();
    fetchStats();

    // WebSocket real-time subscription via auto-reconnecting wsService (no 4s polling flood)
    const unsub = wsService.subscribe('global', (payload: any) => {
      try {
        const evtType = payload.event_type || payload.type || payload.action;
        if (
          evtType === 'ADD_PIN' ||
          evtType === 'REVOKE_PIN' ||
          evtType === 'PIN_ISSUED' ||
          evtType === 'PIN_REVOKED' ||
          evtType === 'PIN_REVOKED_UI' ||
          evtType === 'PIN_LIST_UPDATED' ||
          evtType === 'ACCESS_REQUEST_APPROVED' ||
          evtType === 'ACCESS_REQUEST_REJECTED' ||
          evtType === 'ACCESS_REQUEST_DELETED' ||
          evtType === 'NEW_REQUEST' ||
          evtType === 'ACCESS_REQUEST_SUBMITTED' ||
          evtType === 'REGISTRATION_APPROVED' ||
          evtType === 'REGISTRATION_REJECTED' ||
          evtType === 'USER_DIRECTORY_UPDATED' ||
          evtType === 'FACILITY_SPACE_REMOVED' ||
          evtType === 'FACILITY_SPACE_CREATED' ||
          evtType === 'SPACE_UPDATED' ||
          evtType === 'FACTORY_RESET'
        ) {
          fetchRequests();
          fetchActiveKeys();
          fetchMyAccess();
          fetchStats();
        }
      } catch {}
    });

    const onWsReconnect = () => {
      fetchRequests();
      fetchActiveKeys();
      fetchMyAccess();
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        fetchRequests();
        fetchActiveKeys();
        fetchMyAccess();
      }
    };
    window.addEventListener('panda:ws-reconnect', onWsReconnect);
    document.addEventListener('visibilitychange', onVisChange);

    // Lightweight 60s safety fallback
    const interval = setInterval(() => {
      fetchRequests();
      fetchActiveKeys();
      fetchMyAccess();
    }, 60000);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('panda:ws-reconnect', onWsReconnect);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [logSpace, logClub, logEvent, logRange]);

  useEffect(() => {
    if (activeTab === 'requests') fetchRequests();
    if (activeTab === 'active-keys') fetchActiveKeys();
    if (activeTab === 'my-access') fetchMyAccess();
    if (activeTab === 'logs') fetchLogs();
  }, [activeTab]);

  // Synchronize Push Notification status on mount
  useEffect(() => {
    if (pushService.isPushSupported()) {
      pushService.getExistingSubscription().then(async (sub) => {
        if (sub) {
          try {
            const subJson = sub.toJSON();
            if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
              await api.subscribePush({
                endpoint: subJson.endpoint,
                keys: {
                  p256dh: subJson.keys.p256dh,
                  auth: subJson.keys.auth,
                },
              });
            }
          } catch (e) {
            console.warn('Silent push sync error:', e);
          }
        }
      });
    }
  }, []);

  const registeredSpaceSlugs = myCards.map((c) => c.space_id);
  const unregisteredSpaces = allSpaces.filter((s) => !registeredSpaceSlugs.includes(s.slug));

  const togglePinMask = (spaceId: string) => {
    setUnmaskedPins((prev) => ({
      ...prev,
      [spaceId]: prev[spaceId] === undefined ? false : !prev[spaceId],
    }));
  };

  const handleLeadChange = async (spaceId: string, superuserId: string) => {
    try {
      await api.updateUserSpaceCard(spaceId, superuserId);
      showToast('SuperUser updated. Active PIN cleared; please submit a new request.', 'info');
      fetchMyAccess();
    } catch (err: any) {
      showToast(err.message || 'Failed to update lead', 'error');
    }
  };

  const handleOpenAddSpace = () => {
    if (unregisteredSpaces.length > 0) {
      setSelectedNewSpaceId(unregisteredSpaces[0].slug);
      const leads = allSuperusers.filter((su) => (su.allowed_spaces || []).includes(unregisteredSpaces[0].slug));
      setSelectedNewLeadId(leads.length > 0 ? leads[0].id : '');
      setShowAddSpaceModal(true);
    }
  };

  const handleRegisterAdditionalSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNewSpaceId) {
      showToast('Please select space', 'error');
      return;
    }
    try {
      setRegisteringNewSpace(true);
      await api.createUserSpaceCard({
        space_id: selectedNewSpaceId,
        assigned_superuser_id: selectedNewLeadId || undefined,
      });
      showToast('Successfully registered for facility space', 'success');
      setShowAddSpaceModal(false);
      fetchMyAccess();
    } catch (err: any) {
      showToast(err.message || 'Failed to register space', 'error');
    } finally {
      setRegisteringNewSpace(false);
    }
  };

  const handleOpenRequestModal = (card: UserSpaceCard) => {
    const validLeads = allSuperusers.filter(
      (su) => (su.allowed_spaces || []).includes(card.space_id) && su.email !== currentUser?.email
    );
    const hasValidLead = validLeads.some((l) => l.id === card.assigned_superuser_id);
    const safeLeadId = hasValidLead ? card.assigned_superuser_id : (validLeads[0]?.id || undefined);
    setRequestModalSpace({
      ...card,
      assigned_superuser_id: safeLeadId,
      assigned_superuser_name: validLeads.find((l) => l.id === safeLeadId)?.name || card.assigned_superuser_name,
    });
    setRequestJustification('');
  };

  const handleSubmitExternalRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestModalSpace) return;
    const text = requestJustification.trim();
    if (!text) {
      showToast('Please enter an access justification', 'error');
      return;
    }
    const validLeads = allSuperusers.filter(
      (su) => (su.allowed_spaces || []).includes(requestModalSpace.space_id) && su.email !== currentUser?.email
    );
    const effectiveLeadId = validLeads.some((l) => l.id === requestModalSpace.assigned_superuser_id)
      ? requestModalSpace.assigned_superuser_id
      : validLeads[0]?.id;
    try {
      setSubmittingRequest(true);
      await api.createRequest(requestModalSpace.space_id, text, effectiveLeadId || undefined);
      showToast('Access request submitted to space lead', 'success');
      setRequestModalSpace(null);
      setRequestJustification('');
      fetchMyAccess();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit request', 'error');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleTestAudio = () => {
    const success = playAlertChime();
    if (success) {
      showToast('Sound alert test played + vibration triggered', 'success');
    } else {
      showToast('Audio test could not play. Interact with the screen first.', 'error');
    }
  };

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

  // Optimistic Approve
  const handleApprove = async (id: string, isReg = false) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.adjudicateRequest(id, 'APPROVED' as any);
      showToast(
        isReg
          ? 'Registration accepted. Student is now authorized for this space.'
          : 'Access request approved. Pass issued to student.',
        'success'
      );
      fetchActiveKeys();
      fetchLogs();
    } catch (err: any) {
      showToast(err.message || 'Approval failed', 'error');
      fetchRequests();
    }
  };

  // Optimistic Reject
  const handleReject = async (id: string, isReg = false) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.adjudicateRequest(id, 'REJECTED' as any);
      showToast(isReg ? 'Entrant registration rejected' : 'Access request rejected', 'info');
      fetchLogs();
    } catch (err: any) {
      showToast(err.message || 'Rejection failed', 'error');
      fetchRequests();
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!window.confirm('Delete this access request?')) return;
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.deleteRequest(id);
      showToast('Access request removed', 'info');
      fetchRequests();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete request', 'error');
      fetchRequests();
    }
  };

  const handleDeleteOwnRequest = async (requestId: string, spaceId: string) => {
    if (!window.confirm('Cancel and delete this pending access request?')) return;
    try {
      await api.deleteRequest(requestId);
      setMyRequests((prev) => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });
      showToast('Access request cancelled', 'info');
      fetchMyAccess();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel request', 'error');
    }
  };

  // Generate Self PIN for Authorized Spaces
  const handleGenerateSelfPin = async (spaceId: string) => {
    if (!currentUser?.email) return;
    try {
      const res = await api.directIssuePin(spaceId, currentUser.email, 'SuperUser self-entry pass');
      showToast(`Keypad PIN generated for ${spaceId}: ${res.pin_code}`, 'success');
      setActivePins((prev) => ({
        ...prev,
        [spaceId]: { pin_code: res.pin_code, expires_at: res.expires_at },
      }));
      fetchMyAccess();
      fetchActiveKeys();
    } catch (err: any) {
      showToast(err.message || 'Failed to issue self-pass', 'error');
    }
  };

  // Revoke Active Key
  const handleRevokeKey = async (keyId: string, entrantName: string, spaceName: string) => {
    if (!window.confirm(`Revoke active access pass for ${entrantName} in ${spaceName}?`)) {
      return;
    }
    try {
      setRevokingKeyId(keyId);
      await api.revokePin(keyId);
      showToast('Access pass revoked immediately', 'success');
      fetchActiveKeys();
      fetchLogs();
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke key', 'error');
    } finally {
      setRevokingKeyId(null);
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
      {/* SuperUser Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">SuperUser Space Portal</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Supervise facility access passes, manage active keys, and inspect space audit logs.
          </p>
        </div>

        {/* Controls: Sound Alert & User Directory Button */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setShowRosterModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 text-xs font-semibold transition active:scale-95 shadow-sm"
          >
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span>User Directory & Clusters</span>
          </button>

          <div className="hidden md:flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={toggleSound}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${
                soundEnabled
                  ? 'bg-purple-900/40 text-purple-200 border border-purple-700/50'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Toggle notification chime on new requests"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{soundEnabled ? 'Alerts ON' : 'Alerts OFF'}</span>
            </button>

            <button
              onClick={handleTestAudio}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition active:scale-95"
              title="Play test audio chime"
            >
              Test
            </button>
          </div>
        </div>
      </div>

      {/* Analytics KPI Cards - Registered Users & Daily Request Average (desktop only) */}
      <div className="hidden md:grid grid-cols-2 gap-3 sm:gap-4">
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

      {/* Tabs */}
      <div className="flex border-b border-slate-800 overflow-x-auto scrollbar-none gap-2">
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'requests'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending Requests</span>
          {requests.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-purple-600 text-white text-[10px] font-mono">
              {requests.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('my-access')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'my-access'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>My Access</span>
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

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ListFilter className="w-3.5 h-3.5" />
          <span>Space Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('esp32_hardware')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === 'esp32_hardware'
              ? 'border-cyan-500 text-cyan-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>ESP32 Hardware</span>
        </button>
      </div>

      {/* TAB 1: PENDING REQUESTS */}
      {activeTab === 'requests' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Pending Access Requests</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-300 border border-purple-800/60 font-mono">
                  {filteredRequests.length} of {requests.length} Pending
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Student access requests awaiting your adjudication</p>
            </div>
          </div>

          {/* Requests Filter Toolbar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search requests by student name, email, justification..."
                value={reqSearch}
                onChange={(e) => setReqSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={reqSpaceFilter}
                onChange={(e) => setReqSpaceFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Facility Spaces</option>
                {allSpaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </select>

              <select
                value={reqYearFilter}
                onChange={(e) => setReqYearFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All College Years</option>
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>

              <select
                value={reqTypeFilter}
                onChange={(e) => setReqTypeFilter(e.target.value as any)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Request Types</option>
                <option value="ACCESS">Pass Requests Only</option>
                <option value="REGISTRATION">Registrations Only</option>
              </select>

              {(reqSearch || reqSpaceFilter !== 'all' || reqYearFilter !== 'all' || reqTypeFilter !== 'all') && (
                <button
                  onClick={() => {
                    setReqSearch('');
                    setReqSpaceFilter('all');
                    setReqYearFilter('all');
                    setReqTypeFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {requests.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
              <p className="font-medium text-slate-300">All caught up!</p>
              <p className="text-[11px] text-slate-500 mt-1">No pending student access requests awaiting your approval.</p>
            </div>
          ) : (
            <>
              {/* Desktop View (md and up) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Name</th>
                      <th className="py-2.5 px-4">College Year</th>
                      <th className="py-2.5 px-4">Facility Space</th>
                      <th className="py-2.5 px-4">Contact Phone</th>
                      <th className="py-2.5 px-4">Submitted</th>
                      <th className="py-2.5 px-4 text-right">Adjudicate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {filteredRequests.map((req) => {
                      const isExpanded = expandedRequestId === req.id;
                      const spaceDisplayName =
                        req.space_name ||
                        allSpaces.find((s) => s.slug === (req.space_id || req.space_slug))?.name ||
                        req.space_id ||
                        req.space_slug;
                      return (
                        <React.Fragment key={req.id}>
                          <tr
                            onClick={() => setExpandedRequestId(isExpanded ? null : req.id)}
                            className={`cursor-pointer transition select-none ${
                              isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                            }`}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white max-w-[140px] truncate" title={req.requester_name}>
                                  {req.requester_name}
                                </span>
                                {req.request_type === 'REGISTRATION' ? (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 font-semibold whitespace-nowrap">
                                    <UserPlus className="w-3 h-3 text-amber-400" />
                                    New Registration
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono whitespace-nowrap">
                                    Pass Request
                                  </span>
                                )}
                                {(req.club_name || req.club_name_snapshot) && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono">
                                    {req.club_name || req.club_name_snapshot}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-indigo-300 border border-indigo-900/50">
                                {req.requester_college_year || 'Not Applicable'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-indigo-300">
                                {spaceDisplayName}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              {req.requester_phone ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyPhone(req.requester_phone, req.id);
                                  }}
                                  className="font-mono text-slate-300 hover:text-indigo-300 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition"
                                  title="Copy phone number"
                                >
                                  <span>{req.requester_phone}</span>
                                  {copiedPhoneId === req.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                              {formatTimeAgo(req.created_at)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => handleApprove(req.id, req.request_type === 'REGISTRATION')}
                                  className={`p-1.5 rounded-lg border transition active:scale-95 shadow-sm flex items-center gap-1 ${
                                    req.request_type === 'REGISTRATION'
                                      ? 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border-emerald-600 px-2.5'
                                      : 'bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border-emerald-700/70'
                                  }`}
                                  title={req.request_type === 'REGISTRATION' ? "Accept Student Registration" : "Approve Pass"}
                                >
                                  <Check className="w-4 h-4 text-emerald-400" />
                                  {req.request_type === 'REGISTRATION' && <span className="text-[11px] font-bold">Accept</span>}
                                </button>
                                <button
                                  onClick={() => handleReject(req.id, req.request_type === 'REGISTRATION')}
                                  className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900/90 text-rose-300 border border-rose-700/70 transition active:scale-95 shadow-sm"
                                  title={req.request_type === 'REGISTRATION' ? "Reject Registration" : "Reject Request"}
                                >
                                  <X className="w-4 h-4 text-rose-400" />
                                </button>
                                <button
                                  onClick={() => handleDeleteRequest(req.id)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/70 transition active:scale-95 shadow-sm"
                                  title="Delete request (if made by mistake)"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setExpandedRequestId(isExpanded ? null : req.id)}
                                  className="p-1 text-slate-400 hover:text-slate-200 transition ml-1"
                                  title={isExpanded ? 'Collapse justification' : 'Expand justification'}
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-950/90 border-t border-slate-800/80 animate-in fade-in duration-150">
                              <td colSpan={6} className="p-4">
                                <div className="space-y-2">
                                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
                                    <span>Access Justification & Details</span>
                                    <span className="text-slate-500 font-mono text-[10px]">
                                      Submitted: {new Date(req.created_at).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 italic leading-relaxed">
                                    "{req.justification}"
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-400">
                                    <div>
                                      <span className="text-slate-500">Email:</span>{' '}
                                      <span className="font-mono text-slate-300">{req.requester_email}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Club:</span>{' '}
                                      <span className="text-indigo-300">
                                        {req.club_name || req.club_name_snapshot || 'Independent / General Body'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Target Facility Space:</span>{' '}
                                      <span className="text-slate-300">{spaceDisplayName}</span>
                                    </div>
                                  </div>
                                  <div className="flex justify-end pt-2 border-t border-slate-800/60">
                                    <button
                                      onClick={() => handleDeleteRequest(req.id)}
                                      className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition px-2 py-1 rounded hover:bg-rose-950/40"
                                      title="Delete this access request if made by mistake"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>Delete Request (Made by mistake)</span>
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {filteredRequests.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No pending requests match the filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card / Dropdown View (under md, zero sideways scroll) */}
              <div className="block md:hidden divide-y divide-slate-800/80">
                {filteredRequests.map((req) => {
                  const isExpanded = expandedRequestId === req.id;
                  const spaceDisplayName =
                    req.space_name ||
                    allSpaces.find((s) => s.slug === (req.space_id || req.space_slug))?.name ||
                    req.space_id ||
                    req.space_slug;
                  return (
                    <div key={req.id} className="p-3.5 bg-slate-900 transition">
                      <div
                        onClick={() => setExpandedRequestId(isExpanded ? null : req.id)}
                        className="flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-white text-xs truncate max-w-[150px]">
                              {req.requester_name}
                            </span>
                            {req.request_type === 'REGISTRATION' ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 text-[10px] font-semibold flex items-center gap-1">
                                <UserPlus className="w-2.5 h-2.5" /> Registration
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono">
                                {spaceDisplayName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                            <span>{req.requester_college_year || 'N/A'}</span>
                            <span>•</span>
                            <span>{req.request_type === 'REGISTRATION' ? spaceDisplayName : formatTimeAgo(req.created_at)}</span>
                          </div>
                        </div>

                        {/* Action Icons */}
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleApprove(req.id, req.request_type === 'REGISTRATION')}
                            className={`p-1.5 rounded-lg border active:scale-95 flex items-center gap-1 ${
                              req.request_type === 'REGISTRATION'
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-600 px-2'
                                : 'bg-emerald-950/90 text-emerald-300 border-emerald-750'
                            }`}
                            title={req.request_type === 'REGISTRATION' ? "Accept Student" : "Approve"}
                          >
                            <Check className="w-4 h-4 text-emerald-400" />
                            {req.request_type === 'REGISTRATION' && <span className="text-[10px] font-bold">Accept</span>}
                          </button>
                          <button
                            onClick={() => handleReject(req.id, req.request_type === 'REGISTRATION')}
                            className="p-1.5 rounded-lg bg-rose-950/90 text-rose-300 border border-rose-750 active:scale-95"
                            title={req.request_type === 'REGISTRATION' ? "Reject Student" : "Reject"}
                          >
                            <X className="w-4 h-4 text-rose-400" />
                          </button>
                          <button
                            onClick={() => setExpandedRequestId(isExpanded ? null : req.id)}
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
                        <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5 text-xs animate-in fade-in duration-100">
                          <div className="bg-slate-950 border border-slate-800/90 p-2.5 rounded-xl">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-0.5">
                              Justification / Purpose:
                            </span>
                            <p className="italic text-indigo-200 text-xs">
                              "{req.justification || 'No justification provided'}"
                            </p>
                          </div>

                          <div className="space-y-1.5 text-[11px] text-slate-400">
                            <div>
                              <span className="text-slate-500">Email:</span>{' '}
                              <span className="font-mono text-slate-200">{req.requester_email}</span>
                            </div>
                            {req.requester_phone && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500">Phone:</span>
                                <span className="font-mono text-slate-200">{req.requester_phone}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyPhone(req.requester_phone, req.id)}
                                  className="text-indigo-400 p-0.5"
                                >
                                  {copiedPhoneId === req.id ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            )}
                            <div>
                              <span className="text-slate-500">Club:</span>{' '}
                              <span className="text-slate-200">
                                {req.club_name || req.club_name_snapshot || 'Independent'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">Submitted:</span>{' '}
                              <span className="text-slate-400">{new Date(req.created_at).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="flex justify-end pt-2 border-t border-slate-800/60">
                            <button
                              onClick={() => handleDeleteRequest(req.id)}
                              className="text-[11px] text-rose-400 flex items-center gap-1 px-2 py-1 rounded bg-rose-950/30 border border-rose-900/50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete Request</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredActiveKeys.length === 0 && (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    No active keys match the filter criteria.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: ACTIVE KEYS */}
      {activeTab === 'active-keys' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-wrap justify-between items-center gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Active Facility Keys</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
                  {filteredActiveKeys.length} of {activeKeys.length} Active Keys
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Currently valid passes in spaces under your authority</p>
            </div>
            {activeKeys.length > 0 && (
              <button
                type="button"
                disabled={revokingAllPins}
                onClick={async () => {
                  const scopeLabel = keySpaceFilter !== 'all' ? keySpaceFilter : 'all authorized spaces';
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
                {allSpaces.map((sp) => (
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

          {activeKeys.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No active access keys in your facility spaces right now.
            </div>
          ) : (
            <>
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
                            {revokingKeyId === k.id ? 'Revoking...' : 'Revoke Early'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredActiveKeys.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          No active keys match the filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Dropdown View (under md, zero sideways scroll) */}
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
                {filteredActiveKeys.length === 0 && (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    No active keys match the filter criteria.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: MY ACCESS */}
      {activeTab === 'my-access' && (
        <div className="space-y-6">
          {/* Top Banner / Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">SuperUser Facility Passes</h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Self-generate passes for spaces under your authority or request access to external spaces.
              </p>
            </div>

            {unregisteredSpaces.length > 0 && (
              <button
                onClick={handleOpenAddSpace}
                className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Register for another Facility space</span>
              </button>
            )}
          </div>

          {/* My Access Filter Toolbar */}
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2.5 text-xs shadow-md">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search spaces or assigned leads..."
                value={myAccessSearch}
                onChange={(e) => setMyAccessSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={myAccessSpaceFilter}
                onChange={(e) => setMyAccessSpaceFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All My Facility Spaces ({myCards.length})</option>
                {myCards.map((c) => (
                  <option key={c.space_id} value={c.space_id}>
                    {c.space_name}
                  </option>
                ))}
              </select>

              {(myAccessSearch || myAccessSpaceFilter !== 'all') && (
                <button
                  onClick={() => {
                    setMyAccessSearch('');
                    setMyAccessSpaceFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {filteredMyCards.map((c) => {
              const spaceId = c.space_id;
              const isAuthorized = currentUser?.authorized_spaces?.includes('all') || currentUser?.authorized_spaces?.includes(spaceId);

              const rawPin = activePins[spaceId] || (c.active_pin ? {
                pin_code: c.active_pin.pin_code || '',
                expires_at: c.active_pin.expires_at,
              } : null);

              const isExpired = rawPin && new Date(rawPin.expires_at).getTime() <= Date.now();
              const activePin = isExpired ? null : rawPin;
              const latestRequest = myRequests[spaceId];
              const isPending = Boolean(latestRequest);
              const isUnmasked = activePin ? (unmaskedPins[spaceId] ?? true) : false;

              const pinDigits = activePin && activePin.pin_code
                ? String(activePin.pin_code).padStart(6, '0').split('')
                : ['·', '·', '·', '·', '·', '·'];
              const validTillStr = activePin ? formatValidTill(activePin.expires_at) : null;
              const availableLeads = allSuperusers.filter((su) => (su.allowed_spaces || []).includes(spaceId) && su.email !== currentUser?.email);

              return (
                <div
                  key={spaceId}
                  className={`bg-slate-900 border ${
                    activePin
                      ? 'border-purple-500/40 ring-1 ring-purple-500/20'
                      : 'border-slate-800'
                  } rounded-2xl p-4 sm:p-6 flex flex-col justify-between shadow-xl relative overflow-hidden transition-all duration-200`}
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${isAuthorized ? 'bg-purple-500' : 'bg-indigo-500'}`}></span>
                        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{c.space_name}</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                          isAuthorized
                            ? 'bg-purple-950/90 text-purple-300 border-purple-700/60'
                            : 'bg-indigo-950/90 text-indigo-300 border-indigo-700/60'
                        }`}>
                          {isAuthorized ? 'Under Your Authority' : 'External Space'}
                        </span>
                        {activePin ? (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Pass Active
                          </span>
                        ) : isPending ? (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-950/90 text-amber-300 border border-amber-700/60 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            Pending
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* External Space Lead Selector */}
                    {!isAuthorized && (
                      <div className="bg-slate-950/70 rounded-xl p-3 sm:p-3.5 border border-slate-800/80 mb-4">
                        <div className="block text-[11px] font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                          <span>SuperUser (Single Authority)</span>
                          {c.assigned_superuser_phone && (
                            <button
                              onClick={() => handleCopyPhone(c.assigned_superuser_phone, `lead-${spaceId}`)}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                            >
                              {copiedPhoneId === `lead-${spaceId}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Copy Phone</span>
                            </button>
                          )}
                        </div>

                        {(() => {
                          const effectiveLeadId = availableLeads.some((l) => l.id === c.assigned_superuser_id)
                            ? c.assigned_superuser_id || ''
                            : (availableLeads[0]?.id || '');
                          return (
                            <select
                              value={effectiveLeadId}
                              onChange={(e) => handleLeadChange(spaceId, e.target.value)}
                              disabled={isPending || availableLeads.length === 0}
                              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                            >
                              {availableLeads.length === 0 ? (
                                <option value="">No authorized lead available</option>
                              ) : (
                                availableLeads.map((lead) => (
                                  <option key={lead.id} value={lead.id}>
                                    {lead.name}{lead.club_name ? ` (${lead.club_name})` : ''}
                                  </option>
                                ))
                              )}
                            </select>
                          );
                        })()}
                      </div>
                    )}

                    {/* 6-PIN Digit Placeholders */}
                    <div className="my-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            6-Digit Access PIN
                          </p>
                          {activePin && (
                            <button
                              type="button"
                              onClick={() => togglePinMask(spaceId)}
                              className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] text-indigo-300 flex items-center gap-1 transition"
                              title={isUnmasked ? "Mask PIN" : "Show PIN"}
                            >
                              {isUnmasked ? <EyeOff className="w-3 h-3 text-slate-400" /> : <Eye className="w-3 h-3 text-slate-400" />}
                              <span>{isUnmasked ? "Hide" : "Show"}</span>
                            </button>
                          )}
                        </div>
                        {activePin && validTillStr && (
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-medium text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded-md">
                            <Clock className="w-3 h-3 text-emerald-400" />
                            <span>Valid Till: {validTillStr}</span>
                          </div>
                        )}
                      </div>

                      {/* 6 Digit Cells Container */}
                      <div
                        onClick={() => {
                          if (activePin) {
                            togglePinMask(spaceId);
                          } else if (!isAuthorized && !isPending) {
                            handleOpenRequestModal(c);
                          }
                        }}
                        className={`rounded-xl p-3 border transition-all duration-300 select-none ${
                          activePin
                            ? 'bg-purple-950/30 border-purple-500/50 cursor-pointer hover:border-purple-400'
                            : isPending
                            ? 'bg-amber-950/20 border-amber-800/50'
                            : isAuthorized
                            ? 'bg-slate-950/80 border-slate-800'
                            : 'bg-slate-950/80 border-slate-800 cursor-pointer hover:border-indigo-500/60'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                          {pinDigits.map((char, idx) => {
                            const displayChar = activePin ? (isUnmasked ? char : '•') : '·';
                            return (
                              <div
                                key={idx}
                                className={`w-9 h-11 sm:w-11 sm:h-13 rounded-lg border flex items-center justify-center text-xl sm:text-2xl font-mono font-bold transition-all shadow-inner ${
                                  activePin
                                    ? isUnmasked
                                      ? 'bg-purple-600/20 border-purple-400 text-white shadow-purple-900/40'
                                      : 'bg-slate-900 border-slate-700 text-purple-300'
                                    : isPending
                                    ? 'bg-slate-900/80 border-slate-700 text-amber-400'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-600'
                                }`}
                              >
                                {displayChar}
                              </div>
                            );
                          })}
                        </div>

                        {/* Subtext info */}
                        <div className="mt-2 text-center">
                          {activePin ? (
                            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-300">
                              {isUnmasked ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                              <span>{isUnmasked ? 'Tap to mask PIN' : 'Tap to unmask digits'}</span>
                            </div>
                          ) : isPending ? (
                            <p className="text-[11px] font-medium text-amber-400">
                              Awaiting supervising lead approval...
                            </p>
                          ) : isAuthorized ? (
                            <p className="text-[11px] text-slate-400">
                              Direct access granted by your leadership authority
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-400 hover:text-indigo-300 transition-colors">
                              Tap to request access pass from space lead
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Pending Request Details Box */}
                    {isPending && latestRequest && (
                      <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3 my-2 text-left text-xs">
                        <div className="flex items-center justify-between text-amber-300 font-medium mb-1">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Request under review by {c.assigned_superuser_name || 'Lead'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteOwnRequest(latestRequest.id, c.space_id);
                            }}
                            className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1 transition shrink-0"
                            title="Cancel request made by mistake"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                        <p className="text-slate-300 italic text-[11px]">"{latestRequest.justification}"</p>
                      </div>
                    )}
                  </div>

                  {/* Card Action Footer */}
                  <div className="pt-3 border-t border-slate-800 mt-2">
                    {isAuthorized ? (
                      <button
                        onClick={() => handleGenerateSelfPin(spaceId)}
                        className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition active:scale-95 shadow-md shadow-purple-900/30 flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{activePin ? 'Re-generate Keypad Pass' : 'Generate Self Pass'}</span>
                      </button>
                    ) : (
                      <div>
                        {activePin ? (
                          <div className="text-center py-2 text-xs text-emerald-400 font-medium flex items-center justify-center gap-1.5">
                            <Check className="w-3.5 h-3.5" />
                            <span>Pass active on door keypad</span>
                          </div>
                        ) : isPending ? (
                          <div className="text-center py-2 text-xs text-amber-400 font-medium flex items-center justify-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Pending lead review</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleOpenRequestModal(c)}
                            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition active:scale-95 shadow-md flex items-center justify-center gap-1.5"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Request Access Pass</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredMyCards.length === 0 && (
              <div className="col-span-full p-8 text-center text-slate-500 text-xs bg-slate-900/60 border border-slate-800 rounded-2xl">
                No facility passes match the filter criteria.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SPACE LOGS */}
      {activeTab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Space Access Audit Logs</h3>
              <p className="text-[11px] text-slate-400">Verifiable tamper-evident access activity</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Range Filters */}
              <div className="flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-xs">
                {['24h', '7d', '30d', 'all'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setLogRange(r)}
                    className={`px-2.5 py-1 rounded-md font-medium uppercase text-[10px] transition ${
                      logRange === r
                        ? 'bg-purple-600 text-white'
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
                <option value="all">All Facility Spaces</option>
                {allSpaces.map((sp) => (
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

              {/* CSV Export */}
              <button
                onClick={() => api.downloadAuditLogsCsv()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Search Box */}
          <input
            type="text"
            placeholder="Search by entrant name, email, club, space, approver, or justification..."
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
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

      {/* TAB 5: ESP32 HARDWARE */}
      {activeTab === 'esp32_hardware' && (
        <div className="space-y-4">
          <ESP32StatusBar
            allowedSpaces={currentUser?.authorized_spaces}
            showToast={showToast}
          />
        </div>
      )}

      {/* Affiliation Cluster Modal */}
      <AffiliationClusterModal
        isOpen={showRosterModal}
        onClose={() => setShowRosterModal(false)}
        showToast={showToast}
        currentUserRole="superuser"
        onCheckLogs={(member) => {
          setShowRosterModal(false);
          setLogSearch(member.email);
          setActiveTab('logs');
          fetchLogs();
        }}
      />

      {/* Add External Space Modal */}
      {showAddSpaceModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Register for Facility Space</h3>
                  <p className="text-[11px] text-slate-400">Request access outside your authority</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddSpaceModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterAdditionalSpace} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Select Facility Space
                </label>
                <select
                  value={selectedNewSpaceId}
                  onChange={(e) => {
                    const slug = e.target.value;
                    setSelectedNewSpaceId(slug);
                    const leads = allSuperusers.filter((su) => (su.allowed_spaces || []).includes(slug) && su.email !== currentUser?.email);
                    setSelectedNewLeadId(leads.length > 0 ? leads[0].id : '');
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {unregisteredSpaces.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  SuperUser (Single Authority)
                </label>
                <select
                  value={selectedNewLeadId}
                  onChange={(e) => setSelectedNewLeadId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {allSuperusers
                    .filter((su) => (su.allowed_spaces || []).includes(selectedNewSpaceId) && su.email !== currentUser?.email)
                    .map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}{lead.club_name ? ` (${lead.club_name})` : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddSpaceModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registeringNewSpace}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition active:scale-95 disabled:opacity-50"
                >
                  {registeringNewSpace ? 'Registering...' : 'Confirm Registration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* External Request Justification Modal */}
      {requestModalSpace && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Access Justification</h3>
                  <p className="text-[11px] text-slate-400">{requestModalSpace.space_name}</p>
                </div>
              </div>
              <button
                onClick={() => setRequestModalSpace(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitExternalRequest} className="space-y-4">
              {(() => {
                const modalLeads = allSuperusers.filter(
                  (su) => (su.allowed_spaces || []).includes(requestModalSpace.space_id) && su.email !== currentUser?.email
                );
                return (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Target SuperUser
                    </label>
                    <select
                      value={requestModalSpace.assigned_superuser_id || ''}
                      onChange={(e) =>
                        setRequestModalSpace({
                          ...requestModalSpace,
                          assigned_superuser_id: e.target.value,
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      {modalLeads.length === 0 ? (
                        <option value="">Any Authorized Lead (Space Queue)</option>
                      ) : (
                        modalLeads.map((lead) => (
                          <option key={lead.id} value={lead.id}>
                            {lead.name} {lead.club_name ? `(${lead.club_name})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Reason for access (max 256 characters) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={256}
                  placeholder="e.g. Need access for hardware debugging & project handoff"
                  value={requestJustification}
                  onChange={(e) => setRequestJustification(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <div className="text-right text-[10px] text-slate-500">
                  {requestJustification.length}/256 chars
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRequestModalSpace(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRequest}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition active:scale-95 disabled:opacity-50"
                >
                  {submittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperUserDashboard;
