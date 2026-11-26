import React, { useState, useEffect, useMemo } from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  Clock,
  Send,
  Plus,
  X,
  ShieldCheck,
  Trash2,
  Search,
  UserPlus,
  RotateCcw,
} from 'lucide-react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { countWords, formatValidTill } from '../utils/format';
import { copyToClipboard } from '../utils/clipboard';
import { UserSpaceCard, AccessRequest, ActivePin, SuperUserInfo, UserProfile } from '../types';
import { RegistrationPendingView } from './RegistrationPendingView';

interface StudentDashboardProps {
  currentUser?: UserProfile | null;
  onReRegister?: (email: string) => void;
  onLogout?: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  currentUser,
  onReRegister,
  onLogout,
  showToast,
}) => {
  const [cards, setCards] = useState<UserSpaceCard[]>([]);
  const [allSpaces, setAllSpaces] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [superusers, setSuperusers] = useState<SuperUserInfo[]>([]);
  const [activePins, setActivePins] = useState<Record<string, ActivePin | null>>({});
  const [requests, setRequests] = useState<Record<string, AccessRequest | null>>({});
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalSpace, setModalSpace] = useState<UserSpaceCard | null>(null);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unmaskedPins, setUnmaskedPins] = useState<Record<string, boolean>>({});
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [pulseSpaceId, setPulseSpaceId] = useState<string | null>(null);

  // Add Space Modal
  const [showAddSpaceModal, setShowAddSpaceModal] = useState(false);
  const [selectedNewSpaceId, setSelectedNewSpaceId] = useState('');
  const [selectedNewLeadId, setSelectedNewLeadId] = useState('');
  const [registeringNewSpace, setRegisteringNewSpace] = useState(false);

  // Search & Filter State
  const [spaceSearch, setSpaceSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all');

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      const spaceId = card.space_id;
      const rawPin = activePins[spaceId] || card.active_pin;
      const isExpired = rawPin && new Date(rawPin.expires_at).getTime() <= Date.now();
      const hasActive = Boolean(rawPin && !isExpired);
      const isPending = Boolean(requests[spaceId]);

      if (statusFilter === 'active' && !hasActive) return false;
      if (statusFilter === 'pending' && (!isPending || hasActive)) return false;
      if (statusFilter === 'inactive' && (hasActive || isPending)) return false;

      if (spaceSearch.trim()) {
        const q = spaceSearch.toLowerCase().trim();
        const matchesName = card.space_name.toLowerCase().includes(q);
        const matchesSlug = card.space_id.toLowerCase().includes(q);
        const matchesLead = (card.assigned_superuser_name || '').toLowerCase().includes(q);
        if (!matchesName && !matchesSlug && !matchesLead) return false;
      }
      return true;
    });
  }, [cards, activePins, requests, spaceSearch, statusFilter]);

  const fetchDashboardData = async (isInitial: boolean = false) => {
    try {
      if (isInitial) setLoading(true);
      const [userCards, spacesList, suList] = await Promise.all([
        api.fetchUserSpaceCards().catch(() => []),
        api.fetchSpaces().catch(() => []),
        api.fetchSuperUsers().catch(() => []),
      ]);

      setCards(userCards);
      setAllSpaces(spacesList);
      setSuperusers(suList);

      // Use active_pin & pending_request already returned by fetchUserSpaceCards (avoids N*2 extra HTTP calls)
      const pinsMap: Record<string, ActivePin | null> = {};
      const reqMap: Record<string, AccessRequest | null> = {};

      for (const card of userCards) {
        if (card.active_pin && card.active_pin.pin_code) {
          pinsMap[card.space_id] = {
            id: card.active_pin.id,
            pin_code: card.active_pin.pin_code,
            space_slug: card.space_id,
            space_name: card.space_name,
            holder_name: currentUser?.name || '',
            holder_email: currentUser?.email || '',
            approver_name: card.assigned_superuser_name || '',
            issued_at: '',
            expires_at: card.active_pin.expires_at,
            is_revoked: false,
            remaining_seconds: Math.max(0, Math.floor((new Date(card.active_pin.expires_at).getTime() - Date.now()) / 1000)),
          };
        } else {
          pinsMap[card.space_id] = null;
        }

        if (card.pending_request) {
          reqMap[card.space_id] = {
            id: card.pending_request.id,
            requester_email: currentUser?.email || '',
            requester_name: currentUser?.name || '',
            space_id: card.space_id,
            justification: card.pending_request.justification,
            status: 'PENDING' as any,
            created_at: card.pending_request.created_at,
          };
        } else {
          reqMap[card.space_id] = null;
        }
      }

      setActivePins(pinsMap);
      setRequests(reqMap);
    } catch (err: any) {
      console.error('Failed to load student dashboard:', err);
      if (isInitial) showToast('Could not refresh dashboard data', 'error');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(true);

    // WebSocket listener for real-time instantaneous sync (no aggressive polling)
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
          evtType === 'REGISTRATION_APPROVED' ||
          evtType === 'REGISTRATION_REJECTED' ||
          evtType === 'FACILITY_SPACE_REMOVED' ||
          evtType === 'FACILITY_SPACE_CREATED' ||
          evtType === 'SPACE_UPDATED' ||
          evtType === 'FACTORY_RESET'
        ) {
          fetchDashboardData(false);
        }
      } catch {}
    });

    const onWsReconnect = () => fetchDashboardData(false);
    const onVisChange = () => {
      if (document.visibilityState === 'visible') fetchDashboardData(false);
    };
    window.addEventListener('panda:ws-reconnect', onWsReconnect);
    document.addEventListener('visibilitychange', onVisChange);

    // Lightweight 60s safety fallback for PIN expiration UI sync
    const interval = setInterval(() => {
      fetchDashboardData(false);
    }, 60000);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('panda:ws-reconnect', onWsReconnect);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  const registeredSpaceSlugs = cards.map((c) => c.space_id);
  const unregisteredSpaces = allSpaces.filter((s) => !registeredSpaceSlugs.includes(s.slug));

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
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update lead', 'error');
    }
  };

  const handleOpenRequestModal = (card: UserSpaceCard) => {
    setModalSpace(card);
    setJustification('');
  };

  const handlePlaceholderClick = (card: UserSpaceCard) => {
    if (card.status === 'PENDING') {
      showToast('Space registration is pending approval by your supervising lead.', 'info');
      return;
    }
    if (card.status === 'REJECTED') {
      showToast('Space registration was declined by the supervising lead.', 'error');
      return;
    }
    const spaceId = card.space_id;
    const isPending = Boolean(requests[spaceId]);
    const activePin = activePins[spaceId];

    if (activePin) {
      togglePinMask(spaceId);
    } else if (isPending) {
      setPulseSpaceId(spaceId);
      showToast('Request Pending Approval by Lead', 'info');
      setTimeout(() => {
        setPulseSpaceId(null);
      }, 2500);
    } else {
      handleOpenRequestModal(card);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalSpace) return;
    const text = justification.trim();

    if (!text) {
      showToast('Please enter an access justification', 'error');
      return;
    }
    if (text.length > 256) {
      showToast('Justification exceeds 256 characters', 'error');
      return;
    }

    const validLeads = superusers.filter((su) => (su.allowed_spaces || []).includes(modalSpace.space_id));
    const effectiveLeadId = validLeads.some((l) => l.id === modalSpace.assigned_superuser_id)
      ? modalSpace.assigned_superuser_id
      : validLeads[0]?.id;

    try {
      setSubmitting(true);
      await api.createRequest(modalSpace.space_id, text, effectiveLeadId || undefined);
      showToast('Access request submitted for approval', 'success');
      setModalSpace(null);
      setJustification('');
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRequest = async (requestId: string, spaceId: string) => {
    if (!window.confirm('Cancel and delete this pending access request?')) return;
    try {
      await api.deleteRequest(requestId);
      setRequests((prev) => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });
      setCards((prev) => prev.filter((c) => !(c.space_id === spaceId && c.status === 'PENDING')));
      showToast('Access request cancelled', 'info');
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel request', 'error');
    }
  };

  const handleOpenAddSpace = () => {
    if (unregisteredSpaces.length > 0) {
      setSelectedNewSpaceId(unregisteredSpaces[0].slug);
      const leads = superusers.filter((su) => (su.allowed_spaces || []).includes(unregisteredSpaces[0].slug));
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
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Failed to register space', 'error');
    } finally {
      setRegisteringNewSpace(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-indigo-500"></div>
        <p className="text-xs text-slate-400">Loading access passes...</p>
      </div>
    );
  }

  // If no approved space cards exist (all pending, rejected, or expired/cleaned up), enforce waiting room
  const allPendingOrBlocked = cards.length === 0 || cards.every((c) => c.status === 'PENDING' || c.status === 'REJECTED');
  if (allPendingOrBlocked) {
    return (
      <RegistrationPendingView
        currentUser={
          currentUser || {
            id: cards[0]?.assigned_superuser_name || 'user',
            email: '',
            name: '',
            role: 'user',
            is_root: false,
            authorized_spaces: [],
          }
        }
        cards={cards}
        spaces={allSpaces}
        superusers={superusers}
        onReRegister={(email) => {
          if (onReRegister) {
            onReRegister(email);
          } else {
            window.location.reload();
          }
        }}
        onLogout={() => {
          if (onLogout) {
            onLogout();
          } else {
            localStorage.removeItem('panda_token');
            localStorage.removeItem('panda_profile');
            window.location.reload();
          }
        }}
        onRefresh={() => fetchDashboardData(false)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Facility Access Passes</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Tap the 6-digit placeholders to request your space access code.
          </p>
        </div>

        {unregisteredSpaces.length > 0 && (
          <button
            onClick={handleOpenAddSpace}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-600 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Register for another Facility space</span>
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      {cards.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 p-3 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search space name or assigned lead..."
              value={spaceSearch}
              onChange={(e) => setSpaceSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Pass Active</option>
            <option value="pending">Pending Approval</option>
            <option value="inactive">No Active Pass</option>
          </select>

          {(spaceSearch || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setSpaceSearch('');
                setStatusFilter('all');
              }}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded border border-slate-700 transition"
            >
              Clear
            </button>
          )}

          <span className="text-[11px] font-mono text-slate-400 px-2 py-1 bg-slate-950 rounded border border-slate-800">
            {filteredCards.length} of {cards.length} spaces
          </span>
        </div>
      )}

      {/* Facility Spaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {filteredCards.map((card) => {
          const spaceId = card.space_id;
          const rawPin = activePins[spaceId] || (card.active_pin ? {
            id: card.active_pin.id,
            pin_code: card.active_pin.pin_code,
            space_id: spaceId,
            holder_user_id: '',
            holder_name: '',
            holder_email: '',
            issued_by_name: '',
            issued_by_email: '',
            issued_at: new Date().toISOString(),
            expires_at: card.active_pin.expires_at,
            is_revoked: false,
            remaining_seconds: 180,
          } : null);

          const isExpired = rawPin && new Date(rawPin.expires_at).getTime() <= Date.now();
          const activePin = isExpired ? null : rawPin;
          const latestRequest = requests[spaceId];
          const isPending = Boolean(latestRequest);
          const isUnmasked = activePin ? (unmaskedPins[spaceId] ?? true) : false;
          const isPulsing = pulseSpaceId === spaceId;
          const pinDigits = activePin
            ? String(activePin.pin_code).padStart(6, '0').split('')
            : ['·', '·', '·', '·', '·', '·'];
          const validTillStr = activePin ? formatValidTill(activePin.expires_at) : null;
          const availableLeads = superusers.filter((su) => (su.allowed_spaces || []).includes(spaceId));

          return (
            <div
              key={spaceId}
              className={`bg-slate-900 border ${
                activePin
                  ? 'border-indigo-500/40 ring-1 ring-indigo-500/20'
                  : 'border-slate-800'
              } rounded-2xl p-4 sm:p-6 flex flex-col justify-between shadow-xl relative overflow-hidden transition-all duration-200`}
            >
              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                      {card.space_name}
                    </h2>
                  </div>
                  {card.status === 'PENDING' ? (
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-400" />
                      Registration Pending
                    </span>
                  ) : activePin ? (
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Pass Active
                    </span>
                  ) : isPending ? (
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-950/90 text-amber-300 border border-amber-700/60 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-400" />
                      Pending Approval
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                      No Active Pass
                    </span>
                  )}
                </div>

                {/* Supervising Lead Selector */}
                <div className="bg-slate-950/70 rounded-xl p-3 sm:p-3.5 border border-slate-800/80 mb-4">
                  <div className="block text-[11px] font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                    <span>SuperUser (Single Authority)</span>
                    {card.assigned_superuser_phone && (
                      <button
                        onClick={() => handleCopyPhone(card.assigned_superuser_phone, `lead-${spaceId}`)}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                        title="Copy Lead's phone number"
                      >
                        {copiedPhoneId === `lead-${spaceId}` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Phone</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {(() => {
                    const effectiveLeadId = availableLeads.some((l) => l.id === card.assigned_superuser_id)
                      ? card.assigned_superuser_id || ''
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
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinMask(spaceId);
                          }}
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
                    onClick={() => handlePlaceholderClick(card)}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer select-none rounded-xl p-3 border transition-all duration-300 ${
                      activePin
                        ? 'bg-indigo-950/30 border-indigo-500/50 hover:border-indigo-400'
                        : isPending
                        ? isPulsing
                          ? 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/40 scale-102 animate-pulse'
                          : 'bg-slate-950/80 border-slate-800 hover:border-amber-600/50'
                        : 'bg-slate-950/80 border-slate-800 hover:border-indigo-500/60 hover:bg-slate-950 group'
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
                                  ? 'bg-indigo-600/20 border-indigo-400 text-white shadow-indigo-900/40'
                                  : 'bg-slate-900 border-slate-700 text-indigo-300'
                                : isPending
                                ? 'bg-slate-900/80 border-slate-700 text-amber-400'
                                : 'bg-slate-900/60 border-slate-800 text-slate-600 group-hover:text-indigo-400 group-hover:border-slate-700'
                            }`}
                          >
                            {displayChar}
                          </div>
                        );
                      })}
                    </div>

                    {/* Subtext info */}
                    <div className="mt-2 text-center">
                      {card.status === 'PENDING' ? (
                        <p className="text-[11px] text-amber-300 font-medium flex items-center justify-center gap-1">
                          <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                          Registration submitted. Waiting for lead to accept registration.
                        </p>
                      ) : card.status === 'REJECTED' ? (
                        <p className="text-[11px] text-red-400 font-medium">
                          Registration declined by supervising lead.
                        </p>
                      ) : activePin ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-300">
                            {isUnmasked ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                            <span>{isUnmasked ? 'Tap to mask PIN' : 'Tap to unmask digits'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenRequestModal(card);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-amber-600/20 text-amber-300 border border-slate-700 hover:border-amber-500/40 text-[11px] font-semibold transition"
                            title="Send a new request to regenerate your PIN (immediately disables your current PIN)"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Regenerate PIN</span>
                          </button>
                        </div>
                      ) : isPending ? (
                        <p className={`text-[11px] font-medium transition-colors ${
                          isPulsing ? 'text-amber-300 font-bold' : 'text-amber-400/90'
                        }`}>
                          {isPulsing ? 'Request Pending Approval by Lead' : 'Awaiting SuperUser Approval... Tap for status'}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400 group-hover:text-indigo-300 transition-colors">
                          Tap masked placeholders to request an access pass
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pending Request Details Box */}
                {isPending && latestRequest && (
                  <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3 my-2 text-left text-xs">
                    <div className="flex items-center justify-between gap-1.5 text-amber-300 font-medium mb-1">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Request under review by {card.assigned_superuser_name || 'Lead'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRequest(latestRequest.id, card.space_id);
                        }}
                        className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1 transition shrink-0"
                        title="Cancel this request made by mistake"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-300 italic">
                      "{latestRequest.justification}"
                    </p>
                  </div>
                )}
              </div>

              {/* Action Button Footer */}
              {!activePin && !isPending && (
                <div className="mt-3 pt-3 border-t border-slate-800/80">
                  <button
                    onClick={() => handleOpenRequestModal(card)}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-xl text-xs transition active:scale-98 shadow-md shadow-indigo-900/30"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Request Access Pass</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filteredCards.length === 0 && (
          <div className="col-span-full p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
            {cards.length === 0 && allSpaces.length === 0 ? (
              <>
                <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-slate-200">No Facility Spaces Currently Active</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  No Facility Spaces currently active. Please contact your facility administrator.
                </p>
              </>
            ) : cards.length === 0 && unregisteredSpaces.length > 0 ? (
              <>
                <Plus className="w-8 h-8 text-indigo-400 mx-auto" />
                <h3 className="text-sm font-bold text-slate-200">No Active Space Registrations</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  You are not currently registered for any Facility Space. Select a space to request access.
                </p>
                <button
                  onClick={handleOpenAddSpace}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Register for a Facility Space</span>
                </button>
              </>
            ) : (
              <p className="text-slate-500 text-xs">No facility passes match the filter criteria.</p>
            )}
          </div>
        )}
      </div>

      {/* Mandatory Justification Modal */}
      {modalSpace && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Request {modalSpace.space_name} Access
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Lead: {modalSpace.assigned_superuser_name || 'Authorized Supervisor'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalSpace(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>
                    Access Reasoning / Purpose <span className="text-rose-500 font-bold text-sm">*</span>
                  </span>
                  <span className={`text-[10px] font-mono ${
                    justification.length > 256 ? 'text-rose-400 font-bold' : 'text-slate-400'
                  }`}>
                    {justification.length} / 256 chars
                  </span>
                </label>

                <textarea
                  required
                  maxLength={256}
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="e.g. Soldering circuit boards for Robotics competition project"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none shadow-inner"
                  autoFocus
                />
                <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                  <span>Suggested length: ~20 words</span>
                  <span>{countWords(justification)} words</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalSpace(null)}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !justification.trim() || justification.length > 256}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Submit Request'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Registering for Additional Facility Space One-by-One */}
      {showAddSpaceModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm sm:text-base font-bold text-white">
                Register for Facility Space
              </h3>
              <button
                onClick={() => setShowAddSpaceModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterAdditionalSpace} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Choose Facility Space
                </label>
                <select
                  value={selectedNewSpaceId}
                  onChange={(e) => {
                    const sid = e.target.value;
                    setSelectedNewSpaceId(sid);
                    const leads = superusers.filter((su) => (su.allowed_spaces || []).includes(sid));
                    setSelectedNewLeadId(leads.length > 0 ? leads[0].id : '');
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {unregisteredSpaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  SuperUser
                </label>
                {(() => {
                  const leads = superusers.filter((su) => (su.allowed_spaces || []).includes(selectedNewSpaceId));
                  return (
                    <select
                      value={selectedNewLeadId}
                      onChange={(e) => setSelectedNewLeadId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      {leads.length === 0 ? (
                        <option value="">No leads available</option>
                      ) : (
                        leads.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} {l.club_name ? `(${l.club_name})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddSpaceModal(false)}
                  disabled={registeringNewSpace}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registeringNewSpace || !selectedNewSpaceId}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
                >
                  {registeringNewSpace ? 'Registering...' : 'Add Facility Space'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
