import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSpace } from '../context/SpaceContext';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { UserSpaceCard, SuperUserInfo } from '../types';
import { CopyButton } from '../components/CopyButton';
import { JustificationModal } from '../components/JustificationModal';
import { SettingsDrawer } from '../components/SettingsDrawer';
import { ResetWarningBanner } from '../components/ResetWarningBanner';
import {
  Menu,
  Shield,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

export const UserDashboard: React.FC = () => {
  const { user } = useAuth();
  const { spaces } = useSpace();

  const [cards, setCards] = useState<UserSpaceCard[]>([]);
  const [superusers, setSuperusers] = useState<SuperUserInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Mandatory justification popup state
  const [selectedCardForRequest, setSelectedCardForRequest] = useState<UserSpaceCard | null>(null);

  // Pulse tooltip state when clicking masked PIN while request is pending
  const [pendingTooltipSpace, setPendingTooltipSpace] = useState<string | null>(null);

  // Additional space registration state
  const [showAddSpaceModal, setShowAddSpaceModal] = useState<boolean>(false);
  const [newSpaceId, setNewSpaceId] = useState<string>('');
  const [newSuperUserId, setNewSuperUserId] = useState<string>('');
  const [isAddingSpace, setIsAddingSpace] = useState<boolean>(false);

  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      const [cardsData, suData] = await Promise.all([
        api.fetchUserSpaceCards(),
        api.fetchSuperUsers(),
      ]);
      setCards(cardsData);
      setSuperusers(suData);
    } catch (e: any) {
      console.warn('Failed to load user space cards:', e);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();

    // Listen on WebSocket for real-time approvals, rejections, and room syncs
    const unsubscribe = wsService.subscribe('global', (event) => {
      if (
        event.event_type === 'ACCESS_REQUEST_APPROVED' ||
        event.event_type === 'ACCESS_REQUEST_REJECTED' ||
        event.event_type === 'DOOR_UNLOCKED' ||
        event.action === 'ADD_PIN' ||
        event.action === 'REVOKE_PIN' ||
        event.event_type === 'REVOKE_PIN'
      ) {
        loadDashboardData();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadDashboardData]);

  // Periodic expiration watcher: automatically masks PINs once expired without countdown timers
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCards((prev) =>
        prev.map((card) => {
          if (card.active_pin) {
            const exp = new Date(card.active_pin.expires_at);
            if (exp <= now) {
              return { ...card, active_pin: null };
            }
          }
          return card;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handle switching assigned SuperUser inline from card dropdown
  const handleSwitchSuperUser = async (spaceId: string, superUserId: string) => {
    try {
      await api.updateUserSpaceCard(spaceId, superUserId || undefined);
      await loadDashboardData();
      setActionMessage({ type: 'success', text: 'Assigned Lead updated.' });
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to update Lead' });
    }
  };

  // Submit formal PIN petition via mandatory JustificationModal
  const handleRequestSubmit = async (justification: string) => {
    if (!selectedCardForRequest) return;
    try {
      await api.createRequest(selectedCardForRequest.space_id, justification);
      await loadDashboardData();
      setActionMessage({
        type: 'success',
        text: `Access request submitted for ${selectedCardForRequest.space_name}. Awaiting Lead approval.`,
      });
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      throw err;
    }
  };

  // Click on 6-digit PIN box
  const handlePinBoxClick = (card: UserSpaceCard) => {
    if (card.active_pin) {
      // PIN is active and already unmasked
      return;
    }

    if (card.pending_request) {
      // Trigger smooth pulse animation and show tooltip
      setPendingTooltipSpace(card.space_id);
      setTimeout(() => setPendingTooltipSpace(null), 3500);
      return;
    }

    // Unallocated/expired: open mandatory justification pop-up
    setSelectedCardForRequest(card);
  };

  // Register an additional Facility Space
  const handleRegisterAdditionalSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpaceId) return;

    setIsAddingSpace(true);
    try {
      await api.createUserSpaceCard({
        space_id: newSpaceId,
        assigned_superuser_id: newSuperUserId || undefined,
      });
      setShowAddSpaceModal(false);
      setNewSpaceId('');
      setNewSuperUserId('');
      await loadDashboardData();
      setActionMessage({ type: 'success', text: 'Facility Space registered successfully.' });
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to register space' });
    } finally {
      setIsAddingSpace(false);
    }
  };

  // Compute spaces the user hasn't registered for yet
  const registeredSpaceIds = new Set(cards.map((c) => c.space_id));
  const unregisteredSpaces = spaces.filter((s) => !registeredSpaceIds.has(s.slug));

  return (
    <div className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Header Bar with Hamburger Menu */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white">Facility Access</h2>
          <p className="text-xs text-slate-400">
            Welcome, {user?.name || user?.email}
          </p>
        </div>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/80 shadow-md transition active:scale-95"
          title="Account Settings & Profile"
          aria-label="Open Account Settings"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Pre-Reset Warning Banner (Active August 25 - 31) */}
      <ResetWarningBanner />

      {/* Action Feedback Alerts */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center gap-2 border animate-in fade-in ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/70 border-rose-800/60 text-rose-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Facility Space Floating Cards */}
      <div className="space-y-4">
        {cards.length === 0 ? (
          <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-3xl p-6 text-slate-400 text-xs space-y-3">
            <p>You have not registered for any Facility Spaces yet.</p>
            {spaces.length > 0 && (
              <button
                onClick={() => {
                  setNewSpaceId(spaces[0].slug);
                  setShowAddSpaceModal(true);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-lg transition"
              >
                Register Initial Space
              </button>
            )}
          </div>
        ) : (
          cards.map((card) => {
            const hasActivePin = !!card.active_pin;
            const isPending = !!card.pending_request;
            const isPulsing = pendingTooltipSpace === card.space_id;

            return (
              <div
                key={card.space_id}
                className="p-5 rounded-3xl bg-slate-850/90 border border-slate-750/90 shadow-xl backdrop-blur-md space-y-4 relative overflow-hidden transition-all hover:border-slate-700"
              >
                {/* Space Card Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        hasActivePin
                          ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse'
                          : isPending
                          ? 'bg-amber-400 shadow-sm shadow-amber-400 animate-ping'
                          : 'bg-slate-600'
                      }`}
                    />
                    <h3 className="font-extrabold text-base text-white tracking-wide">
                      {card.space_name}
                    </h3>
                  </div>

                  <span className="text-[11px] font-semibold text-slate-400">
                    {hasActivePin ? (
                      <span className="text-emerald-400 font-bold">Access Granted</span>
                    ) : isPending ? (
                      <span className="text-amber-400 font-bold">Pending Review</span>
                    ) : (
                      'Secured Lock'
                    )}
                  </span>
                </div>

                {/* Assigned SuperUser Row with Inline Switching Dropdown */}
                <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-indigo-400" />
                      Assigned Lead:
                    </span>
                    <span className="font-semibold text-slate-200">
                      {card.assigned_superuser_name || 'No Lead Assigned'}
                    </span>
                  </div>

                  {/* SuperUser Phone with One-Click Copy Button */}
                  {card.assigned_superuser_phone && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                      <span className="font-mono text-slate-400 text-[11px]">
                        {card.assigned_superuser_phone}
                      </span>
                      <CopyButton textToCopy={card.assigned_superuser_phone} label="Copy Phone" />
                    </div>
                  )}

                  {/* Inline Dropdown to switch assigned SuperUser for this space */}
                  <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider shrink-0">
                      Switch Lead:
                    </label>
                    <select
                      value={card.assigned_superuser_id || ''}
                      onChange={(e) => handleSwitchSuperUser(card.space_id, e.target.value)}
                      aria-label="Switch Assigned Lead"
                      className="bg-slate-950 border border-slate-750 text-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500 cursor-pointer max-w-[200px] truncate"
                    >
                      <option value="">-- No Lead Assigned --</option>
                      {superusers.map((su) => (
                        <option key={su.id} value={su.id} className="bg-slate-900 text-slate-100">
                          {su.name} ({su.club_name || 'Lead'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Always-Visible 6-Digit PIN Box */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => handlePinBoxClick(card)}
                    className={`w-full p-4 rounded-2xl border text-center transition-all ${
                      hasActivePin
                        ? 'bg-emerald-950/40 border-emerald-500/60 shadow-lg shadow-emerald-950/40'
                        : isPending
                        ? `bg-amber-950/30 border-amber-500/50 ${
                            isPulsing ? 'animate-pulse ring-2 ring-amber-400 scale-[1.01]' : ''
                          }`
                        : 'bg-slate-900 border-slate-750 hover:border-emerald-500/50 hover:bg-slate-850 active:scale-[0.99] cursor-pointer'
                    }`}
                  >
                    {/* Active PIN unmasked with Valid till timestamp beside it (NO copy button!) */}
                    {hasActivePin && card.active_pin?.pin_code ? (
                      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <div className="text-2xl sm:text-3xl font-mono font-black tracking-[0.35em] text-emerald-300">
                          {card.active_pin.pin_code.split('').join(' ')}
                        </div>
                        <div className="text-[11px] font-mono text-emerald-400/90 px-2.5 py-1 bg-emerald-950 border border-emerald-800 rounded-lg font-semibold">
                          Valid till {card.active_pin.valid_till}
                        </div>
                      </div>
                    ) : (
                      /* Masked 6-digit placeholder • • • • • • */
                      <div className="space-y-1">
                        <div className="text-xl sm:text-2xl font-mono font-bold tracking-[0.5em] text-slate-400">
                          • • • • • •
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium block">
                          {isPending ? 'Request Pending Approval by Lead' : 'Tap to request access PIN'}
                        </span>
                      </div>
                    )}
                  </button>

                  {/* Pulsing Tooltip for Pending State */}
                  {isPulsing && (
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-amber-950 border border-amber-600 text-amber-200 text-xs font-bold rounded-xl shadow-xl animate-in fade-in duration-150 pointer-events-none whitespace-nowrap z-10">
                      Request Pending Approval by Lead
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Register Additional Facility Space Button */}
        {unregisteredSpaces.length > 0 && (
          <button
            onClick={() => {
              setNewSpaceId(unregisteredSpaces[0].slug);
              setShowAddSpaceModal(true);
            }}
            className="w-full py-3.5 px-4 rounded-3xl border-2 border-dashed border-slate-750 hover:border-emerald-500/60 bg-slate-900/40 hover:bg-slate-900/80 text-slate-300 hover:text-white font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95"
          >
            <PlusCircle className="w-4 h-4 text-emerald-400" />
            <span>Register for Another Facility Space</span>
          </button>
        )}
      </div>

      {/* Mandatory Justification Pop-Up */}
      {selectedCardForRequest && (
        <JustificationModal
          isOpen={true}
          spaceName={selectedCardForRequest.space_name}
          onClose={() => setSelectedCardForRequest(null)}
          onSubmit={handleRequestSubmit}
        />
      )}

      {/* Modal: Register Additional Facility Space */}
      {showAddSpaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 text-slate-100 relative shadow-2xl space-y-4">
            <h3 className="font-bold text-base text-white">Register Additional Facility Space</h3>
            <p className="text-xs text-slate-400">
              Select an additional facility space to add to your personal access dashboard.
            </p>

            <form onSubmit={handleRegisterAdditionalSpace} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Facility Space
                </label>
                <select
                  value={newSpaceId}
                  onChange={(e) => setNewSpaceId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {unregisteredSpaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug} className="bg-slate-900 text-slate-100">
                      {sp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Designated SuperUser (Optional)
                </label>
                <select
                  value={newSuperUserId}
                  onChange={(e) => setNewSuperUserId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Choose Lead --</option>
                  {superusers.map((su) => (
                    <option key={su.id} value={su.id} className="bg-slate-900 text-slate-100">
                      {su.name} ({su.club_name || 'Lead'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSpaceModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingSpace || !newSpaceId}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950 disabled:opacity-50"
                >
                  {isAddingSpace ? 'Registering...' : 'Add Space'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hamburger / Settings Drawer */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
