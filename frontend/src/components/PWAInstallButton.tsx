import React, { useState, useEffect } from 'react';
import { Download, Smartphone, X, Info } from 'lucide-react';
import { pushService } from '../services/pushNotification';

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const isIOS = pushService.isIOS();

  useEffect(() => {
    // Check if already running as installed PWA
    setIsStandalone(pushService.isStandalone());

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    window.addEventListener('appinstalled', () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  if (isStandalone) {
    return null; // Already running inside installed PWA
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      setShowIosGuide(true);
    } else {
      setShowIosGuide(true);
    }
  };

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-700/60 text-xs font-semibold text-purple-300 transition active:scale-95 shadow-sm"
        title="Install PANDA as a Web App on your phone or desktop"
      >
        <Smartphone className="w-3.5 h-3.5 text-purple-400" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>

      {/* iOS / Browser Install Instructions Modal */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 max-w-sm w-full shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowIosGuide(false)}
              className="absolute top-3.5 right-3.5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-700 flex items-center justify-center mb-3">
              <Download className="w-5 h-5 text-purple-400" />
            </div>

            <h3 className="text-sm font-bold text-white mb-1">Install PANDA Web App</h3>
            <p className="text-xs text-slate-300 mb-4">
              Add PANDA to your home screen for quick fullscreen access and background door alerts:
            </p>

            {isIOS ? (
              <div className="space-y-2 text-xs text-slate-300 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-start gap-2">
                  <span className="font-bold text-purple-400">1.</span>
                  <span>Tap the <strong>Share</strong> icon (square with arrow ⎋) at the bottom of Safari.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-purple-400">2.</span>
                  <span>Scroll down and select <strong>"Add to Home Screen" ⊞</strong>.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-purple-400">3.</span>
                  <span>Tap <strong>Add</strong> at top right. Launch PANDA from your home screen!</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-slate-300 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <span>
                    Tap your browser menu (<strong>⋮</strong> or <strong>⋯</strong>) and select <strong>"Install App"</strong> or <strong>"Add to Home screen"</strong>.
                  </span>
                </div>
                {!window.isSecureContext && (
                  <p className="text-[11px] text-amber-300/90 pt-1 border-t border-slate-800">
                    Note: If testing via HTTP IP on LAN, mobile browsers disable install banners and push notifications. Host via HTTPS or tunnel for full PWA features.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => setShowIosGuide(false)}
              className="mt-4 w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
