import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone,
  Copy,
  Check,
  RotateCcw,
  LogOut,
  RefreshCw,
  AlertCircle,
  Building2,
  Send,
} from 'lucide-react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { copyToClipboard } from '../utils/clipboard';
import { UserSpaceCard, UserProfile, SuperUserInfo } from '../types';

interface RegistrationPendingViewProps {
  currentUser: UserProfile;
  cards: UserSpaceCard[];
  spaces?: Array<{ id: string; slug: string; name: string }>;
  superusers?: SuperUserInfo[];
  onReRegister: (email: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void> | void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const RegistrationPendingView: React.FC<RegistrationPendingViewProps> = ({
  currentUser,
  cards,
  spaces = [],
  superusers = [],
  onReRegister,
  onLogout,
  onRefresh,
  showToast,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Inline space registration state (when cards.length === 0 and spaces.length > 0)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [submittingSpace, setSubmittingSpace] = useState(false);

  const spaceLeads = useMemo(() => {
    if (!selectedSpaceId) return [];
    return superusers.filter((su) => (su.allowed_spaces || []).includes(selectedSpaceId));
  }, [superusers, selectedSpaceId]);

  useEffect(() => {
    if (spaces.length > 0 && (!selectedSpaceId || !spaces.some((s) => s.slug === selectedSpaceId))) {
      setSelectedSpaceId(spaces[0].slug);
    } else if (spaces.length === 0) {
      setSelectedSpaceId('');
    }
  }, [spaces, selectedSpaceId]);

  useEffect(() => {
    if (spaceLeads.length > 0 && (!selectedLeadId || !spaceLeads.some((l) => l.id === selectedLeadId))) {
      setSelectedLeadId(spaceLeads[0].id);
    } else if (spaceLeads.length === 0) {
      setSelectedLeadId('');
    }
  }, [spaceLeads, selectedLeadId]);

  // Listen to auto-reconnecting WebSocket + visibility/reconnect sync
  useEffect(() => {
    const unsub = wsService.subscribe('global', (payload: any) => {
      try {
        const evtType = payload.event_type || payload.type || payload.action;
        const userEmail = (
          payload.data?.requester_email ||
          payload.data?.holder_email ||
          payload.requester_email ||
          payload.holder_email ||
          ''
        ).toLowerCase();

        if (
          (evtType === 'REGISTRATION_APPROVED' ||
            evtType === 'ACCESS_REQUEST_APPROVED' ||
            evtType === 'USER_APPROVED') &&
          (!userEmail || userEmail === currentUser.email.toLowerCase())
        ) {
          showToast('Registration approved! Welcome to PANDA.', 'success');
          onRefresh();
        } else if (
          evtType === 'REGISTRATION_REJECTED' &&
          (!userEmail || userEmail === currentUser.email.toLowerCase())
        ) {
          showToast('Your registration request was declined by the SuperUser.', 'error');
          onRefresh();
        } else if (
          evtType === 'FACILITY_SPACE_CREATED' ||
          evtType === 'FACILITY_SPACE_REMOVED' ||
          evtType === 'USER_DIRECTORY_UPDATED' ||
          evtType === 'ACCESS_REQUEST_DELETED'
        ) {
          onRefresh();
        }
      } catch {}
    });

    const onWsReconnect = () => {
      onRefresh();
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') onRefresh();
    };
    window.addEventListener('panda:ws-reconnect', onWsReconnect);
    document.addEventListener('visibilitychange', onVisChange);

    // Lightweight 60s safety fallback
    const interval = setInterval(() => {
      onRefresh();
    }, 60000);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('panda:ws-reconnect', onWsReconnect);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [currentUser.email, onRefresh, showToast]);

  const handleCopyPhone = async (phone: string, id: string) => {
    if (!phone) return;
    const ok = await copyToClipboard(phone);
    setCopiedId(id);
    if (ok) {
      showToast('Phone number copied to clipboard', 'info');
    } else {
      showToast(`Phone: ${phone}`, 'info');
    }
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
      showToast('Checking approval status...', 'info');
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleConfirmReset = async () => {
    try {
      setIsDeleting(true);
      await api.deleteAccount();
      showToast('Current registration deleted. Please submit your updated details.', 'info');
      onReRegister(currentUser.email);
    } catch (err: any) {
      showToast(err.message || 'Failed to reset registration. Please try again.', 'error');
      setIsDeleting(false);
      setShowConfirmReset(false);
    }
  };

  const handleInlineRegisterSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpaceId) {
      showToast('Please select a Facility Space', 'error');
      return;
    }
    if (!selectedLeadId) {
      showToast('No supervising SuperUser available for this space', 'error');
      return;
    }
    try {
      setSubmittingSpace(true);
      await api.createUserSpaceCard({
        space_id: selectedSpaceId,
        assigned_superuser_id: selectedLeadId,
      });
      showToast('Space registration submitted for SuperUser approval.', 'success');
      await onRefresh();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit space registration', 'error');
    } finally {
      setSubmittingSpace(false);
    }
  };

  const pendingCards = cards.filter((c) => c.status === 'PENDING');
  const rejectedCards = cards.filter((c) => c.status === 'REJECTED');
  const hasNoCards = cards.length === 0;
  const noSpacesExist = hasNoCards && spaces.length === 0;
  const needsSpaceSelection = hasNoCards && spaces.length > 0;
  const isRejected = !hasNoCards && pendingCards.length === 0 && rejectedCards.length > 0;
  const displayCards = pendingCards.length > 0 ? pendingCards : cards;

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center py-6 px-3 sm:px-6">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden backdrop-blur-sm">
        {/* Ambient Top Glow */}
        <div
          className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 rounded-full blur-[1px] ${
            isRejected
              ? 'bg-red-500/80'
              : noSpacesExist
              ? 'bg-slate-500/80'
              : needsSpaceSelection
              ? 'bg-indigo-500/80'
              : 'bg-amber-500/80'
          }`}
        ></div>
        <div
          className={`absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full blur-3xl pointer-events-none ${
            isRejected
              ? 'bg-red-500/10'
              : noSpacesExist
              ? 'bg-slate-500/10'
              : needsSpaceSelection
              ? 'bg-indigo-500/10'
              : 'bg-amber-500/10'
          }`}
        ></div>

        {/* Status Header */}
        <div className="text-center mb-6 relative z-10">
          {noSpacesExist ? (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold mb-3">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>No Facility Spaces Available</span>
            </div>
          ) : needsSpaceSelection ? (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-3">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>No Active Space Registration</span>
            </div>
          ) : isRejected ? (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold mb-3">
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              <span>Registration Declined</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold mb-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Registration Pending Approval</span>
            </div>
          )}

          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Welcome, {currentUser.name || 'Entrant'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
            {noSpacesExist
              ? 'There are currently no Facility Spaces configured in PANDA. Please check back once an administrator registers a space.'
              : needsSpaceSelection
              ? 'You do not have any active or pending space registrations right now. Select a Facility Space and supervising SuperUser below to submit a request.'
              : isRejected
              ? 'Your facility registration was declined by the supervising SuperUser. You can re-register with updated details or select another space lead.'
              : 'Your facility registration has been submitted and is awaiting approval from your supervising SuperUser.'}
          </p>
        </div>

        {/* Main Body: No Spaces / Inline Space Selector / Pending Cards */}
        <div className="space-y-3.5 mb-6 relative z-10">
          {noSpacesExist ? (
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 text-center space-y-2">
              <Building2 className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm font-semibold text-white">No Facility Spaces Configured</p>
              <p className="text-xs text-slate-400">
                Once the administrator registers a space and assigns a SuperUser, you can request access here.
              </p>
            </div>
          ) : needsSpaceSelection ? (
            <form
              onSubmit={handleInlineRegisterSpace}
              className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Facility Space <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedSpaceId}
                  onChange={(e) => setSelectedSpaceId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {spaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  SuperUser <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  disabled={spaceLeads.length === 0}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  {spaceLeads.length === 0 ? (
                    <option value="">No SuperUsers available for this space yet</option>
                  ) : (
                    spaceLeads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}{lead.club_name ? ` (${lead.club_name})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <button
                type="submit"
                disabled={submittingSpace || !selectedSpaceId || !selectedLeadId}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submittingSpace ? 'Submitting...' : 'Submit Space Registration'}</span>
              </button>
            </form>
          ) : (
            displayCards.map((card) => {
              const suName = card.assigned_superuser_name || 'Assigned SuperUser';
              const suPhone = card.assigned_superuser_phone;
              const cardKey = card.space_id;
              const isCopied = copiedId === cardKey;

              return (
                <div
                  key={cardKey}
                  className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-inner"
                >
                  <div className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-800/70">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                      <span className="text-xs font-bold text-slate-200 tracking-wide">
                        {card.space_name || card.space_id}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-400">
                      Facility Space
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        SuperUser
                      </p>
                      <p className="text-base font-semibold text-white mt-0.5">{suName}</p>
                      {suPhone ? (
                        <p className="text-xs font-mono text-indigo-300 mt-0.5">{suPhone}</p>
                      ) : (
                        <p className="text-xs text-slate-400 mt-0.5 italic">No phone registered</p>
                      )}
                    </div>

                    {suPhone && (
                      <div className="flex items-center gap-2">
                        {/* Copy Phone Number */}
                        <button
                          type="button"
                          onClick={() => handleCopyPhone(suPhone, cardKey)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition active:scale-95 shadow-sm"
                          title="Copy SuperUser phone number"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Phone</span>
                            </>
                          )}
                        </button>

                        {/* Direct Dial Link */}
                        <a
                          href={`tel:${suPhone}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition active:scale-95 shadow-sm"
                          title="Call SuperUser directly"
                        >
                          <Phone className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Call</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Information Notice (only when waiting on a pending request) */}
        {!hasNoCards && !isRejected && (
          <div className="flex items-start gap-2.5 p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl mb-6 text-slate-400 text-xs leading-relaxed">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              You may contact your supervising SuperUser if you require expedited approval. This screen will
              update automatically as soon as your registration is approved.
            </span>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            <span>{hasNoCards ? 'Refresh' : 'Check Approval Status'}</span>
          </button>

          <div className="flex items-center gap-2">
            {!noSpacesExist && (
              <button
                type="button"
                onClick={() => setShowConfirmReset(true)}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-semibold transition active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{hasNoCards ? 'Reset & Re-Register' : 'Change Registration Details'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onLogout}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 text-xs font-medium transition"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Resetting Registration */}
      {showConfirmReset && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative">
            <div className="flex items-center gap-3 mb-3 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Change Registration Details?</h3>
                <p className="text-xs text-slate-400">Reset and re-submit your registration</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-5">
              Opting to change your details will delete your current pending request from the system so you can
              enter updated information or select a different supervising SuperUser.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowConfirmReset(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-rose-900/30"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting Entry...</span>
                  </>
                ) : (
                  <span>Yes, Delete & Change Details</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegistrationPendingView;
