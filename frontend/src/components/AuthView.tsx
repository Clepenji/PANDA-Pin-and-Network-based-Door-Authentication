import React, { useState, useEffect } from 'react';
import { Shield, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { UserProfile, UserRole } from '../types';

interface AuthViewProps {
  onLoginSubmit?: (email: string) => Promise<void>;
  onLoginSuccess?: (profile: UserProfile, token: string) => void;
  onRequireRegistration?: (email: string, oauthToken?: string, name?: string) => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  onLoginSuccess,
  onRequireRegistration,
  showToast,
}) => {
  const [authConfig, setAuthConfig] = useState<{
    auth_mode: string;
    allowed_email_domain: string;
    google_client_id: string;
    root_admin_email: string;
  } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isVerifyingOAuth, setIsVerifyingOAuth] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // 1. Load Auth Configuration and Check for Google OAuth Callback (?code=...)
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const config = await api.fetchAuthConfig();
        if (!isMounted) return;
        setAuthConfig(config);

        // Check if returning from Google OAuth redirect with ?code=...
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const errorParam = urlParams.get('error');

        if (errorParam) {
          setOauthError(`Google sign-in was cancelled or denied: ${errorParam}`);
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }

        if (code) {
          setIsVerifyingOAuth(true);
          setOauthError(null);
          try {
            const redirectUri = window.location.origin;
            const res = await api.loginWithGoogleOAuth({ code, redirect_uri: redirectUri });
            window.history.replaceState({}, document.title, window.location.pathname);

            if (res.status === 'NEEDS_REGISTRATION') {
              if (res.oauth_registration_token) {
                sessionStorage.setItem('panda_oauth_reg_token', res.oauth_registration_token);
              }
              if (res.email) {
                sessionStorage.setItem('panda_reg_email', res.email);
              }
              sessionStorage.removeItem('panda_reg_name');
              if (onRequireRegistration) {
                onRequireRegistration(res.email, res.oauth_registration_token, '');
              }
              showToast(res.message || 'Google account verified. Complete registration below.', 'info');
            } else {
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

              if (onLoginSuccess) {
                onLoginSuccess(profile, res.access_token);
              } else {
                localStorage.setItem('panda_token', res.access_token);
                localStorage.setItem('panda_profile', JSON.stringify(profile));
                window.location.reload();
              }
            }
          } catch (err: any) {
            window.history.replaceState({}, document.title, window.location.pathname);
            const errMsg = String(err.message || 'Google authentication failed');
            setOauthError(errMsg);
            showToast(errMsg, 'error');
          } finally {
            if (isMounted) setIsVerifyingOAuth(false);
          }
        }
      } catch (err) {
        console.warn('Failed to load auth config:', err);
      } finally {
        if (isMounted) setLoadingConfig(false);
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, [onLoginSuccess, onRequireRegistration, showToast]);

  // Handle Google Identity Services (GIS) Credential
  const handleCredentialLogin = async (credential: string) => {
    setIsVerifyingOAuth(true);
    setOauthError(null);
    try {
      const res = await api.loginWithGoogleOAuth({ credential });
      if (res.status === 'NEEDS_REGISTRATION') {
        if (res.oauth_registration_token) {
          sessionStorage.setItem('panda_oauth_reg_token', res.oauth_registration_token);
        }
        if (res.email) {
          sessionStorage.setItem('panda_reg_email', res.email);
        }
        sessionStorage.removeItem('panda_reg_name');
        if (onRequireRegistration) {
          onRequireRegistration(res.email, res.oauth_registration_token, '');
        }
        showToast(res.message || 'Google account verified. Complete registration below.', 'info');
      } else {
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

        if (onLoginSuccess) {
          onLoginSuccess(profile, res.access_token);
        } else {
          localStorage.setItem('panda_token', res.access_token);
          localStorage.setItem('panda_profile', JSON.stringify(profile));
          window.location.reload();
        }
      }
    } catch (err: any) {
      const errMsg = String(err.message || 'Google authentication failed');
      setOauthError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setIsVerifyingOAuth(false);
    }
  };

  // Initialize Google Identity Services (GIS) Script for Popup Sign-in
  useEffect(() => {
    if (!authConfig?.google_client_id) return;

    let isMounted = true;
    let retryTimer: any = null;
    const scriptId = 'google-gsi-client';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const renderButton = () => {
      if (!isMounted) return false;
      const btnDiv = document.getElementById('gsi-btn-wrapper');
      if (btnDiv && (window as any).google?.accounts?.id) {
        btnDiv.innerHTML = '';
        const parentWidth = btnDiv.parentElement?.clientWidth || btnDiv.clientWidth || (window.innerWidth - 64);
        const btnWidth = Math.min(320, Math.max(220, Math.floor(parentWidth)));
        (window as any).google.accounts.id.renderButton(btnDiv, {
          theme: 'filled_blue',
          size: 'large',
          type: 'standard',
          text: 'continue_with',
          shape: 'rectangular',
          width: btnWidth,
          logo_alignment: 'left',
        });
        return true;
      }
      return false;
    };

    const setupGsi = () => {
      if (!isMounted || !(window as any).google?.accounts?.id || !authConfig?.google_client_id) return;
      try {
        (window as any).google.accounts.id.initialize({
          client_id: authConfig.google_client_id,
          callback: async (response: any) => {
            if (response?.credential) {
              await handleCredentialLogin(response.credential);
            }
          },
          auto_select: true,
          cancel_on_tap_outside: false,
        });

        if (!renderButton()) {
          retryTimer = setTimeout(renderButton, 80);
        }

        window.addEventListener('resize', renderButton);

        // Activate Google One Tap prompt for instant 1-click login
        (window as any).google.accounts.id.prompt();
      } catch (err) {
        console.warn('GIS initialization error:', err);
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = setupGsi;
      document.body.appendChild(script);
    } else {
      setupGsi();
    }

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('resize', renderButton);
    };
  }, [authConfig?.google_client_id, loadingConfig]);

  const allowedDomain = authConfig?.allowed_email_domain || 'hyderabad.bits-pilani.ac.in';

  return (
    <div className="max-w-md mx-auto my-6 sm:my-16 px-3.5 sm:px-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-950/60 shrink-0">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">PANDA</h2>
            <p className="text-xs text-slate-400">Pin And Network-based Door Authentication</p>
          </div>
        </div>

        {/* OAuth Error Banner */}
        {oauthError && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-950/80 border border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{oauthError}</div>
          </div>
        )}

        {/* Loading Spinner for Initial Config or OAuth Verification */}
        {loadingConfig || isVerifyingOAuth ? (
          <div className="py-12 text-center space-y-3">
            <Loader2 className="w-9 h-9 text-indigo-500 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-white">
              {isVerifyingOAuth ? 'Verifying Google Account...' : 'Connecting to Access System...'}
            </p>
            <p className="text-xs text-slate-400">
              {isVerifyingOAuth
                ? 'Authenticating institutional credentials with Google Workspace.'
                : 'Initializing security and authentication settings...'}
            </p>
          </div>
        ) : (
          /* Official Google Sign-In */
          <div className="space-y-5">
            <div className="text-center pb-1">
              <h3 className="text-lg font-bold text-white tracking-tight">Log in</h3>
              <p className="text-xs text-slate-400 mt-1">
                Access restricted to{' '}
                <span className="font-mono text-slate-200 font-semibold">@{allowedDomain}</span>
              </p>
            </div>

            {/* GIS One-Click / Popup Container (Uses Authorized JavaScript Origin) */}
            <div className="flex flex-col items-center justify-center min-h-[44px] w-full overflow-hidden">
              <div id="gsi-btn-wrapper" className="w-full flex justify-center max-w-full overflow-hidden"></div>
            </div>

            <div className="pt-2 text-center">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Sign in using your campus Google Workspace account. Google securely verifies your credentials before granting facility access.
              </p>
              {/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(window.location.hostname) && (
                <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300/90 leading-relaxed text-left">
                  <p className="font-medium text-amber-200 mb-1">Google OAuth on Local IP:</p>
                  Google requires <span className="font-mono text-white">localhost:8000</span> or an HTTPS domain. For direct sign-in from your laptop, connect via SSH tunnel:
                  <code className="block mt-1 p-1.5 bg-black/40 rounded text-amber-100 font-mono text-[10px] select-all">
                    ssh -L 8000:localhost:8000 pi@{window.location.hostname}
                  </code>
                  and visit <span className="font-mono text-white">http://localhost:8000</span>.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthView;
