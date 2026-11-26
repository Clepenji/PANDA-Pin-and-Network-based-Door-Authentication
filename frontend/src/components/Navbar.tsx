import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { KeypadModal } from './KeypadModal';
import { Key, LogOut, Radio } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const [keypadOpen, setKeypadOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950">
              <Key className="w-5 h-5 text-slate-950 font-black" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-base tracking-tight text-white">PANDA</span>
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  Access
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono -mt-0.5">Facility Security System</p>
            </div>
          </div>

          {/* Actions & Profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            <PWAInstallButton />

            {/* Keypad Quick Trigger */}
            <button
              onClick={() => setKeypadOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-400 transition active:scale-95 shadow-sm"
              title="Open Keypad Simulation"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Door Keypad</span>
            </button>

            {user && (
              <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
                <div className="hidden sm:block text-right">
                  <div className="text-xs font-semibold text-slate-200 leading-tight">{user.name}</div>
                  <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span
                      className={`font-semibold capitalize px-1 rounded ${
                        user.role === 'admin'
                          ? 'bg-rose-950/80 text-rose-300 border border-rose-800/50'
                          : user.role === 'superuser'
                          ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/50'
                          : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                      }`}
                    >
                      {user.is_root ? 'Root Admin' : user.role}
                    </span>
                  </div>
                </div>

                <button
                  onClick={logout}
                  className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-slate-800 border border-transparent hover:border-slate-700 transition"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <KeypadModal isOpen={keypadOpen} onClose={() => setKeypadOpen(false)} />
    </>
  );
};
