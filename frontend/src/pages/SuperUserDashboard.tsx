import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSpace } from '../context/SpaceContext';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import {
  AccessRequest,
  RequestStatus,
  ActiveKeySummary,
  UserSpaceCard,
} from '../types';
import { CopyButton } from '../components/CopyButton';
import { JustificationModal } from '../components/JustificationModal';
import { ResetWarningBanner } from '../components/ResetWarningBanner';
import { ExcelSpaceLogs } from '../components/ExcelSpaceLogs';
import { pushService } from '../services/pushNotification';
import {
  ShieldCheck,
  Check,
  X,
  Clock,
  KeyRound,
  Trash2,
  ChevronDown,
  ChevronUp,
  Shield,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Bell,
  BellRing,
  Smartphone,
} from 'lucide-react';

type SuperUserTab = 'pending' | 'my_access' | 'active_keys' | 'space_logs';

export const SuperUserDashboard: React.FC = () => {
  const { user } = useAuth();
  const { spaces, selectedSpaceSlug, refreshStatuses } = useSpace();

  // Active Tab
  const [activeTab, setActiveTab] = useState<SuperUserTab>('pending');

  // Tab 1: Pending Requests
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [adjudicatingIds, setAdjudicatingIds] = useState<Set<string>>(new Set());

  // Tab 2: My Access
  const [myCards, setMyCards] = useState<UserSpaceCard[]>([]);
  const [selectedCardForRequest, setSelectedCardForRequest] = useState<UserSpaceCard | null>(null);
  const [generatingSpace, setGeneratingSpace] = useState<string | null>(null);

  // Tab 3: Active Keys
  const [activeKeys, setActiveKeys] = useState<ActiveKeySummary[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Push Notifications State
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [pushLoading, setPushLoading] = useState<boolean>(false);

  useEffect(() => {
    if (pushService.isPushSupported()) {
      pushService.getExistingSubscription().then((sub) => {
        setIsPushSubscribed(!!sub);
      });
    }
  }, []);

  const handleEnablePush = async () => {
    setPushLoading(true);
    try {
      await pushService.subscribeUser();
      setIsPushSubscribed(true);
      setNotification({
        type: 'success',
        text: 'Mobile Web Push enabled! You will receive background alerts on your phone for incoming access requests.',
      });
    } catch (err: any) {
      setNotification({
        type: 'error',
        text: err.message || 'Failed to enable push notifications.',
      });
    } finally {
      setPushLoading(false);
    }
  };

  const handleSendTestAlert = async () => {
    setPushLoading(true);
    try {
      const res = await pushService.sendTestAlert();
      setNotification({
        type: 'success',
        text: res.message || 'Diagnostic push alert delivered to your device.',
      });
    } catch (err: any) {
      setNotification({
        type: 'error',
        text: err.message || 'Failed to dispatch test alert.',
      });
    } finally {
      setPushLoading(false);
    }
  };

  const authorizedSpaces = new Set(user?.authorized_spaces || []);

  const loadRequests = useCallback(async () => {
    try {
      const data = await api.fetchRequests(selectedSpaceSlug, 'PENDING');
      setRequests(data);
    } catch (e: any) {
      console.warn('Failed to load pending requests:', e);
    }
  }, [selectedSpaceSlug]);

  const loadMyCards = useCallback(async () => {
    try {
      const cards = await api.fetchUserSpaceCards();
      setMyCards(cards);
    } catch (e: any) {
      console.warn('Failed to load user space cards:', e);
    }
  }, []);

  const loadActiveKeys = useCallback(async () => {
    try {
      const keys = await api.fetchActiveKeys();
      setActiveKeys(keys);
    } catch (e: any) {
      console.warn('Failed to load active keys:', e);
    }
  }, []);

  useEffect(() => {
    loadRequests();
    loadMyCards();
    loadActiveKeys();

    // Real-time synchronization over WebSockets
    const unsubscribe = wsService.subscribe('global', (event) => {
      if (
        event.event_type === 'ACCESS_REQUEST_SUBMITTED' ||
        event.event_type === 'ACCESS_REQUEST_APPROVED' ||
        event.event_type === 'ACCESS_REQUEST_REJECTED' ||
        event.action === 'ADD_PIN' ||
        event.action === 'REVOKE_PIN' ||
        event.event_type === 'REVOKE_PIN' ||
        event.event_type === 'DOOR_UNLOCKED'
      ) {
        loadRequests();
        loadMyCards();
        loadActiveKeys();
        refreshStatuses();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadRequests, loadMyCards, loadActiveKeys, refreshStatuses]);

  // Tab 1 Action: One-Click Approve / Reject with instantaneous row removal
  const handleDecision = async (requestId: string, decision: RequestStatus) => {
    // Immediate visual feedback & instantaneous removal from list
    setAdjudicatingIds((prev) => new Set(prev).add(requestId));
    const targetReq = requests.find((r) => r.id === requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));

    try {
      await api.adjudicateRequest(requestId, decision);
      setNotification({
        type: 'success',
        text:
          decision === 'APPROVED'
            ? `Approved access for ${targetReq?.requester_name || 'Student'}. 6-digit PIN pushed to ESP32.`
            : `Rejected access request for ${targetReq?.requester_name || 'Student'}.`,
      });
      setTimeout(() => setNotification(null), 3500);
      loadActiveKeys();
      refreshStatuses();
    } catch (err: any) {
      // Revert optimistic removal on failure
      if (targetReq) setRequests((prev) => [targetReq, ...prev]);
      setNotification({ type: 'error', text: err.message || 'Adjudication failed.' });
    } finally {
      setAdjudicatingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  // Tab 2 Action: Generate immediate direct PIN for space under authority
  const handleGenerateImmediatePin = async (spaceId: string) => {
    setGeneratingSpace(spaceId);
    try {
      await api.directIssuePin(spaceId, user?.email || '', 'Self-authorized SuperUser direct entry');
      await loadMyCards();
      setNotification({ type: 'success', text: 'Immediate access PIN generated and unmasked!' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      setNotification({ type: 'error', text: err.message || 'Failed to generate PIN' });
    } finally {
      setGeneratingSpace(null);
    }
  };

  // Tab 2 Action: Submit petition for space outside authority
  const handleRequestSubmit = async (justification: string) => {
    if (!selectedCardForRequest) return;
    try {
      await api.createRequest(selectedCardForRequest.space_id, justification);
      await loadMyCards();
      setNotification({
        type: 'success',
        text: `Request submitted for ${selectedCardForRequest.space_name}. Awaiting assigned Lead approval.`,
      });
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      throw err;
    }
  };

  // Tab 3 Action: Revoke key early
  const handleRevokeKey = async (pinId: string, holderName: string) => {
    setRevokingId(pinId);
    try {
      await api.revokePin(pinId);
      // Remove from active keys view immediately
      setActiveKeys((prev) => prev.filter((k) => k.id !== pinId));
      setNotification({
        type: 'success',
        text: `Access key for ${holderName} revoked. Invalidation sent to ESP32 lock.`,
      });
      setTimeout(() => setNotification(null), 3500);
      loadMyCards();
      refreshStatuses();
    } catch (err: any) {
      setNotification({ type: 'error', text: err.message || 'Failed to revoke key.' });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800/60 shadow-lg">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              SuperUser Authority Portal
            </h2>
            <p className="text-xs text-slate-400">
              Authority: {user?.name} • Governs {Array.from(authorizedSpaces).join(', ') || 'Independent Spaces'}
            </p>
          </div>
        </div>

        {/* Mobile PWA Push Notification Settings */}
        <div className="flex items-center gap-2">
          {pushService.isPushSupported() && (
            <>
              {!isPushSubscribed ? (
                <button
                  onClick={handleEnablePush}
                  disabled={pushLoading}
                  className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition active:scale-95 disabled:opacity-50"
                  title="Enable browser & mobile push alerts for incoming requests"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{pushLoading ? 'Enabling...' : 'Enable Mobile Push'}</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-xl bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1.5 font-bold">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                    Push Active
                  </span>
                  <button
                    onClick={handleSendTestAlert}
                    disabled={pushLoading}
                    className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition active:scale-95 disabled:opacity-50"
                    title="Send a diagnostic test alert to your phone"
                  >
                    <BellRing className={`w-3.5 h-3.5 text-cyan-400 ${pushLoading ? 'animate-pulse' : ''}`} />
                    <span>Send Test Alert</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Annual Pre-Reset Warning Banner (Active August 25 - 31) */}
      <ResetWarningBanner />

      {/* Notifications */}
      {notification && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center gap-2 border animate-in fade-in ${
            notification.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/70 border-rose-800/60 text-rose-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Three Clean Tabs (No Pop-ups Policy) */}
      <div className="flex rounded-2xl bg-slate-950 border border-slate-800 p-1.5 gap-1 text-xs font-bold">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'pending'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Pending Requests</span>
          {requests.length > 0 && (
            <span className="px-1.5 py-0.2 bg-amber-400 text-slate-950 rounded-full text-[10px] font-black">
              {requests.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('my_access')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'my_access'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>My Access</span>
        </button>

        <button
          onClick={() => setActiveTab('active_keys')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'active_keys'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Active Keys</span>
          <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded-full text-[10px]">
            {activeKeys.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('space_logs')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'space_logs'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Space Logs</span>
        </button>
      </div>

      {/* TAB 1: Pending Requests (Table with instant ✓ / ✗ removal and inline row expansion) */}
      {activeTab === 'pending' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Incoming Student Requests
            </h3>
            <span className="text-[11px] text-slate-400">
              Click row to view phone & justification
            </span>
          </div>

          {requests.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No pending access requests awaiting review.
            </div>
          ) : (
            <div className="space-y-2.5">
              {requests.map((req) => {
                const isExpanded = expandedRequestId === req.id;
                const isAdjudicating = adjudicatingIds.has(req.id);

                return (
                  <div
                    key={req.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden transition-all hover:border-slate-700"
                  >
                    {/* Collapsed Main Row */}
                    <div
                      onClick={() => setExpandedRequestId(isExpanded ? null : req.id)}
                      className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-950 border border-indigo-700/60 flex items-center justify-center text-indigo-400 font-bold text-xs">
                          {req.requester_name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-xs sm:text-sm text-slate-100 flex items-center gap-2">
                            {req.requester_name}
                            <span className="text-[10px] text-slate-400 font-normal">
                              • {req.space_name}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[180px] sm:max-w-md">
                            {req.justification}
                          </div>
                        </div>
                      </div>

                      {/* One-Click Action Buttons */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleDecision(req.id, 'APPROVED')}
                          disabled={isAdjudicating}
                          className="w-8 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-950 transition active:scale-95 disabled:opacity-50"
                          title="Approve Petition"
                        >
                          <Check className="w-4 h-4 stroke-[3]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(req.id, 'REJECTED')}
                          disabled={isAdjudicating}
                          className="w-8 h-8 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 flex items-center justify-center transition active:scale-95 disabled:opacity-50"
                          title="Reject Petition"
                        >
                          <X className="w-4 h-4 stroke-[3]" />
                        </button>
                        <div className="text-slate-500 ml-1">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* Inline Row Expansion (NO pop-up policy) */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-slate-950/90 border-t border-slate-800/80 text-xs space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between text-slate-400 text-[11px]">
                          <span>Email: <strong className="text-slate-200">{req.requester_email}</strong></span>
                          <span>Submitted: {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {/* Phone Number with One-Click Copy Button (No Call button) */}
                        {req.requester_phone && (
                          <div className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                            <span className="text-slate-300 font-mono text-xs">
                              {req.requester_phone}
                            </span>
                            <CopyButton textToCopy={req.requester_phone} label="Copy Phone" />
                          </div>
                        )}

                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-slate-200 leading-relaxed">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                            Full Justification:
                          </span>
                          "{req.justification}"
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: My Access */}
      {activeTab === 'my_access' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-400">
            For spaces under your jurisdiction, click to immediately generate unmasked PINs. For spaces outside your authority, petition access like a regular entrant.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {spaces.map((sp) => {
              const isUnderAuthority = authorizedSpaces.has(sp.slug);
              const card = myCards.find((c) => c.space_id === sp.slug);
              const hasActivePin = !!card?.active_pin;
              const isPending = !!card?.pending_request;

              return (
                <div
                  key={sp.slug}
                  className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4 relative"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-base text-white">{sp.name}</h3>
                      <span className="text-[11px] font-semibold text-slate-400">
                        {isUnderAuthority ? (
                          <span className="text-indigo-400 font-bold">Under Your Authority</span>
                        ) : (
                          'Outside Your Authority'
                        )}
                      </span>
                    </div>

                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        hasActivePin
                          ? 'bg-emerald-400 animate-pulse'
                          : isPending
                          ? 'bg-amber-400 animate-ping'
                          : 'bg-slate-600'
                      }`}
                    />
                  </div>

                  {/* Spaces UNDER authority: Unmasks/generates immediate PIN */}
                  {isUnderAuthority ? (
                    <div className="space-y-2">
                      <button
                        onClick={() => handleGenerateImmediatePin(sp.slug)}
                        disabled={generatingSpace === sp.slug}
                        className={`w-full p-4 rounded-2xl border text-center transition-all ${
                          hasActivePin
                            ? 'bg-emerald-950/40 border-emerald-500/60'
                            : 'bg-slate-950 border-slate-750 hover:border-emerald-500/50 hover:bg-slate-900'
                        }`}
                      >
                        {hasActivePin && card?.active_pin?.pin_code ? (
                          <div className="space-y-1">
                            <div className="text-2xl font-mono font-black tracking-[0.35em] text-emerald-300">
                              {card.active_pin.pin_code.split('').join(' ')}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-400">
                              Valid till {card.active_pin.valid_till}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xl font-mono font-bold tracking-[0.5em] text-slate-400">
                              • • • • • •
                            </div>
                            <span className="text-[11px] text-indigo-400 font-bold block">
                              {generatingSpace === sp.slug ? 'Generating Key...' : 'Tap to Generate Instant PIN'}
                            </span>
                          </div>
                        )}
                      </button>
                    </div>
                  ) : (
                    /* Spaces OUTSIDE authority: regular user floating card */
                    <div className="space-y-3">
                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
                        <span className="text-slate-400">Assigned Lead:</span>
                        <span className="font-semibold text-slate-200">
                          {card?.assigned_superuser_name || 'No Lead Assigned'}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          if (!hasActivePin && !isPending && card) {
                            setSelectedCardForRequest(card);
                          }
                        }}
                        className={`w-full p-4 rounded-2xl border text-center transition-all ${
                          hasActivePin
                            ? 'bg-emerald-950/40 border-emerald-500/60'
                            : isPending
                            ? 'bg-amber-950/30 border-amber-500/50'
                            : 'bg-slate-950 border-slate-750 hover:border-emerald-500/50'
                        }`}
                      >
                        {hasActivePin && card?.active_pin?.pin_code ? (
                          <div className="space-y-1">
                            <div className="text-2xl font-mono font-black tracking-[0.35em] text-emerald-300">
                              {card.active_pin.pin_code.split('').join(' ')}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-400">
                              Valid till {card.active_pin.valid_till}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xl font-mono font-bold tracking-[0.5em] text-slate-400">
                              • • • • • •
                            </div>
                            <span className="text-[11px] text-slate-400 block">
                              {isPending ? 'Request Pending Lead Approval' : 'Tap to Request Entry PIN'}
                            </span>
                          </div>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Justification Modal for outside spaces */}
          {selectedCardForRequest && (
            <JustificationModal
              isOpen={true}
              spaceName={selectedCardForRequest.space_name}
              onClose={() => setSelectedCardForRequest(null)}
              onSubmit={handleRequestSubmit}
            />
          )}
        </div>
      )}

      {/* TAB 3: Active Keys (Privacy rule: raw 6-digit PIN omitted) */}
      {activeTab === 'active_keys' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Active Key Holders Across Spaces
              </h3>
              <p className="text-[11px] text-slate-400">
                Privacy policy enforced: PIN digits are hidden. Shows Valid till and early revocation.
              </p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-semibold">
              {activeKeys.length} Active
            </span>
          </div>

          {activeKeys.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No active PIN keys currently allocated across facility spaces.
            </div>
          ) : (
            <div className="space-y-2">
              {activeKeys.map((keyItem) => (
                <div
                  key={keyItem.id}
                  className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs">
                      {keyItem.holder_name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-200 flex items-center gap-2">
                        {keyItem.holder_name}
                        {/* New / Old cohort tag (only between July 15 and September 1) */}
                        {keyItem.account_tag && (
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                              keyItem.account_tag === 'New'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {keyItem.account_tag}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Space: <strong className="text-slate-300">{keyItem.space_name}</strong> • Valid till{' '}
                        <strong className="text-emerald-400 font-mono">{keyItem.valid_till}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Revoke button (only for spaces under this superuser's jurisdiction or admin) */}
                  {keyItem.can_revoke && (
                    <button
                      onClick={() => handleRevokeKey(keyItem.id, keyItem.holder_name)}
                      disabled={revokingId === keyItem.id}
                      className="px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 font-bold text-xs flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{revokingId === keyItem.id ? 'Revoking...' : 'Revoke'}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Shared Space Logs (Universal Visibility across all spaces) */}
      {activeTab === 'space_logs' && <ExcelSpaceLogs />}
    </div>
  );
};
