import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import ResetBanner from './components/ResetBanner';
import AuthView from './components/AuthView';
import StudentDashboard from './components/StudentDashboard';
import SuperUserDashboard from './components/SuperUserDashboard';
import AdminDashboard from './components/AdminDashboard';
import KeypadSimulator from './components/KeypadSimulator';
import RegistrationModal from './components/RegistrationModal';
import ProfileModal from './components/ProfileModal';
import { api } from './services/api';
import { wsService } from './services/websocket';
import { playAlertChime } from './utils/audio';
import { UserProfile, ResetWarningInfo, UserRole } from './types';

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetBanner, setResetBanner] = useState<ResetWarningInfo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Modals
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [registrationEmail, setRegistrationEmail] = useState<string | null>(() => {
    return sessionStorage.getItem('panda_reg_email') || null;
  });
  const [oauthRegistrationToken, setOauthRegistrationToken] = useState<string | null>(() => {
    return sessionStorage.getItem('panda_oauth_reg_token') || null;
  });
  const [prefilledName, setPrefilledName] = useState<string>('');

  const handleRequireRegistration = (email: string, oauthToken?: string) => {
    const token = oauthToken || sessionStorage.getItem('panda_oauth_reg_token') || null;
    setRegistrationEmail(email);
    setOauthRegistrationToken(token);
    setPrefilledName('');
    sessionStorage.setItem('panda_reg_email', email);
    if (token) sessionStorage.setItem('panda_oauth_reg_token', token);
    sessionStorage.removeItem('panda_reg_name');
  };

  const handleClearRegistration = () => {
    setRegistrationEmail(null);
    setOauthRegistrationToken(null);
    setPrefilledName('');
    sessionStorage.removeItem('panda_reg_email');
    sessionStorage.removeItem('panda_oauth_reg_token');
    sessionStorage.removeItem('panda_reg_name');
  };

  // Toast Helper (capped at maximum 3 simultaneous stacked notifications)
  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }].slice(-3));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Fetch Session from localStorage
  const fetchSession = useCallback(async () => {
    try {
      const savedToken = localStorage.getItem('panda_token');
      const savedProfile = localStorage.getItem('panda_profile');
      if (savedToken && savedProfile) {
        try {
          const profile = JSON.parse(savedProfile) as UserProfile;
          setCurrentUser(profile);
          setRegistrationEmail(null);
        } catch {
          localStorage.removeItem('panda_token');
          localStorage.removeItem('panda_profile');
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }

      if (savedToken) {
        api.fetchProfile()
          .then((fresh) => {
            setCurrentUser(fresh);
            localStorage.setItem('panda_profile', JSON.stringify(fresh));
          })
          .catch(() => {});
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Reset Banner
  const fetchResetBanner = useCallback(async () => {
    try {
      const data = await api.fetchResetWarning();
      setResetBanner(data);
    } catch (err) {
      console.warn('Fetch reset warning error:', err);
    }
  }, []);

  useEffect(() => {
    fetchSession();
    fetchResetBanner();
  }, [fetchSession, fetchResetBanner]);

  // Handle global unauthorized / session invalidation events
  useEffect(() => {
    const onUnauthorized = () => {
      const hadToken = Boolean(localStorage.getItem('panda_token'));
      localStorage.removeItem('panda_token');
      localStorage.removeItem('panda_profile');
      setCurrentUser(null);
      if (hadToken) {
        showToast('Your session was updated or ended. Please log in again.', 'info');
      }
    };
    window.addEventListener('panda:unauthorized', onUnauthorized);
    const onWsReconnect = () => {
      if (localStorage.getItem('panda_token')) {
        api.fetchProfile().catch(() => {});
      }
    };
    window.addEventListener('panda:ws-reconnect', onWsReconnect);
    return () => {
      window.removeEventListener('panda:unauthorized', onUnauthorized);
      window.removeEventListener('panda:ws-reconnect', onWsReconnect);
    };
  }, [showToast]);

  // WebSocket for Real-time alerts & live sync (via auto-reconnecting wsService)
  useEffect(() => {
    const unsub = wsService.subscribe('global', (payload: any) => {
      try {
        const myEmail = currentUser?.email?.toLowerCase().trim();
        const evtType = payload.event_type || payload.type || payload.action;
        const payloadData = payload.data || payload;
        const spaceSlug = payloadData.space_slug || payloadData.space_id || payloadData.spaceId;

        const soundEnabled = localStorage.getItem('panda_su_sound_enabled') !== 'false';

        if (evtType === 'NEW_REQUEST' || evtType === 'ACCESS_REQUEST_SUBMITTED') {
          const reqEmail = (payloadData.requester_email || '').toLowerCase().trim();
          const targetSuEmail = (payloadData.target_superuser_email || '').toLowerCase().trim();
          const targetSuId = payloadData.target_superuser_id;
          const hasSpecificTarget = Boolean(targetSuEmail || targetSuId);
          const isTargetedSuperUser =
            currentUser?.role === 'superuser' &&
            (hasSpecificTarget
              ? (Boolean(targetSuEmail && myEmail && targetSuEmail === myEmail) ||
                 Boolean(targetSuId && currentUser.id && targetSuId === currentUser.id))
              : (currentUser.authorized_spaces || []).includes(spaceSlug));
          if (isTargetedSuperUser && (!myEmail || reqEmail !== myEmail)) {
            if (soundEnabled) playAlertChime();
            showToast(`New access request received: ${spaceSlug || 'Facility Space'}`, 'info');
          }
        }

        if (evtType === 'ACCESS_REQUEST_APPROVED' || evtType === 'PIN_ISSUED') {
          const holderEmail = (payloadData.holder_email || '').toLowerCase().trim();
          if (myEmail && holderEmail && holderEmail === myEmail) {
            if (soundEnabled) playAlertChime();
            showToast(`Your Door PIN for ${spaceSlug || 'Facility Space'} is now active!`, 'success');
          }
        }

        if (evtType === 'ACCESS_REQUEST_REJECTED') {
          const holderEmail = (payloadData.holder_email || '').toLowerCase().trim();
          if (myEmail && holderEmail && holderEmail === myEmail) {
            if (soundEnabled) playAlertChime();
            showToast(`Your access request for ${spaceSlug || 'Facility Space'} was declined.`, 'error');
          }
        }

        if (evtType === 'REGISTRATION_APPROVED') {
          const holderEmail = (payloadData.holder_email || '').toLowerCase().trim();
          if (myEmail && holderEmail && holderEmail === myEmail) {
            if (soundEnabled) playAlertChime();
            showToast(`Your registration for ${spaceSlug || 'Facility Space'} was approved!`, 'success');
          }
        }

        if (evtType === 'REGISTRATION_REJECTED') {
          const holderEmail = (payloadData.holder_email || '').toLowerCase().trim();
          if (myEmail && holderEmail && holderEmail === myEmail) {
            if (soundEnabled) playAlertChime();
            showToast(`Your registration for ${spaceSlug || 'Facility Space'} was declined.`, 'error');
          }
        }

        if (evtType === 'PIN_REVOKED' || evtType === 'PIN_REVOKED_UI') {
          const holderEmail = (payloadData.holder_email || '').toLowerCase().trim();
          if (myEmail && holderEmail && holderEmail === myEmail) {
            if (soundEnabled) playAlertChime();
            showToast(`Your Door PIN for ${spaceSlug || 'Facility Space'} was revoked early.`, 'error');
          }
        }

        if (evtType === 'FORCE_LOGOUT' || evtType === 'ACCOUNT_DELETED') {
          const targetEmail = (payloadData.email || '').toLowerCase().trim();
          if (myEmail && targetEmail === myEmail) {
            // If re-registration excluded the newly created uid, verify our JWT uid
            const excludeUid = payloadData.exclude_uid;
            if (excludeUid) {
              try {
                const tok = localStorage.getItem('panda_token');
                if (tok) {
                  const claims = JSON.parse(atob(tok.split('.')[1]));
                  if (claims.uid === excludeUid) return;
                }
              } catch {}
            }
            localStorage.removeItem('panda_token');
            localStorage.removeItem('panda_profile');
            setCurrentUser(null);
            showToast(payloadData.reason || 'Your session was ended. Please log in again.', 'error');
          }
        }

        if (evtType === 'FACTORY_RESET' && currentUser && !currentUser.is_root) {
          localStorage.removeItem('panda_token');
          localStorage.removeItem('panda_profile');
          setCurrentUser(null);
          showToast('System Factory Reset initiated by Root Admin.', 'info');
        }
      } catch (err) {
        console.warn('WS message parse error:', err);
      }
    });

    return () => {
      unsub();
    };
  }, [currentUser, showToast]);

  // Fast Login / Switching
  const handleFastLogin = async (email: string) => {
    try {
      setLoading(true);
      const res = await api.loginWithEmail(email);

      const profile: UserProfile = {
        id: res.email,
        email: res.email,
        name: res.name,
        phone: res.phone,
        club_name: res.club_name,
        college_year: res.college_year,
        note: res.note,
        role: res.role as UserRole,
        is_root: res.is_root,
        authorized_spaces: res.authorized_spaces,
      };

      localStorage.setItem('panda_token', res.access_token);
      localStorage.setItem('panda_profile', JSON.stringify(profile));
      setCurrentUser(profile);
      setRegistrationEmail(null);
      showToast(`Logged in as ${res.name} (${res.role})`, 'success');
    } catch (err: any) {
      // If user does not exist or was revoked, route to registration modal
      const raw = String(err.message || '');
      const msg = raw.toUpperCase();
      if (
        msg.includes('NOT_FOUND') ||
        msg.includes('NOT FOUND') ||
        msg.includes('ACCOUNT_NOT_FOUND') ||
        msg.includes('REVOKED') ||
        msg.includes('REGISTER') ||
        msg.includes('REGISTRATION') ||
        msg.includes('404') ||
        msg.includes('403')
      ) {
        setRegistrationEmail(email);
        setCurrentUser(null);
        showToast('New or revoked entrant. Please complete your registration profile.', 'info');
      } else {
        showToast(err.message || 'Login failed', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (email: string) => {
    return handleFastLogin(email);
  };

  const handleLoginSuccess = (profile: UserProfile, token: string) => {
    localStorage.setItem('panda_token', token);
    localStorage.setItem('panda_profile', JSON.stringify(profile));
    setCurrentUser(profile);
    setRegistrationEmail(null);
    showToast(`Logged in as ${profile.name} (${profile.role})`, 'success');
  };

  const handleLogout = () => {
    localStorage.removeItem('panda_token');
    localStorage.removeItem('panda_profile');
    try {
      if ((window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.disableAutoSelect();
      }
    } catch (err) {
      console.warn('Failed to disable Google auto-select:', err);
    }
    setCurrentUser(null);
    showToast('Signed out successfully', 'info');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-indigo-600 selection:text-white">
      {/* Toast Notification Container */}
      <div className="fixed bottom-4 left-4 right-4 sm:left-4 sm:right-auto z-50 flex flex-col gap-2 pointer-events-none sm:max-w-sm sm:w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-3 rounded-xl border text-xs shadow-xl animate-in slide-in-from-bottom-2 duration-150 flex items-center justify-between gap-2 ${
              t.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200'
                : t.type === 'error'
                ? 'bg-rose-950/90 border-rose-700/60 text-rose-200'
                : 'bg-slate-900/90 border-slate-700 text-slate-200'
            }`}
          >
            <span>{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="text-slate-400 hover:text-white p-0.5"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Pre-Reset Warning Banner */}
      <ResetBanner bannerStatus={resetBanner} />

      {/* Header */}
      <Header
        currentUser={currentUser}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        onFastLogin={handleFastLogin}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3.5 sm:p-6 lg:p-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-indigo-500"></div>
            <p className="text-xs text-slate-400">Loading access system...</p>
          </div>
        ) : !currentUser ? (
          <AuthView
            onLoginSubmit={handleLoginSubmit}
            onLoginSuccess={handleLoginSuccess}
            onRequireRegistration={handleRequireRegistration}
            showToast={showToast}
          />
        ) : currentUser.role === 'admin' ? (
          <AdminDashboard currentUser={currentUser} showToast={showToast} />
        ) : currentUser.role === 'superuser' ? (
          <SuperUserDashboard currentUser={currentUser} showToast={showToast} />
        ) : (
          <StudentDashboard
            currentUser={currentUser}
            onReRegister={(email) => {
              const existingToken = localStorage.getItem('panda_token') || undefined;
              localStorage.removeItem('panda_token');
              localStorage.removeItem('panda_profile');
              setCurrentUser(null);
              handleRequireRegistration(email, existingToken);
            }}
            onLogout={handleLogout}
            showToast={showToast}
          />
        )}
      </main>

      {/* ESP32 Keypad Simulator Modal (toggleable via VITE_ENABLE_SIMULATOR) */}
      {import.meta.env.VITE_ENABLE_SIMULATOR === 'true' && (
        <KeypadSimulator
          isOpen={isSimulatorOpen}
          onClose={() => setIsSimulatorOpen(false)}
          showToast={showToast}
        />
      )}

      {/* Registration Modal */}
      <RegistrationModal
        isOpen={Boolean(registrationEmail)}
        pendingEmail={registrationEmail}
        oauthRegistrationToken={oauthRegistrationToken}
        initialName={prefilledName}
        onComplete={(newUser) => {
          handleClearRegistration();
          setCurrentUser(newUser);
        }}
        onCancel={handleClearRegistration}
        showToast={showToast}
      />

      {/* Profile Settings Modal */}
      <ProfileModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={currentUser}
        onProfileUpdated={fetchSession}
        showToast={showToast}
      />
    </div>
  );
};

export default App;
