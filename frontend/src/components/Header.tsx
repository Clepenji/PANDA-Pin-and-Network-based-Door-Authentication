import React from 'react';
import { Shield, Cpu, Settings, LogOut } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  currentUser: UserProfile | null;
  onOpenSimulator: () => void;
  onFastLogin?: (email: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onOpenSimulator,
  onOpenSettings,
  onLogout,
}) => {

  const roleBadgeColors: Record<string, string> = {
    admin: 'bg-indigo-950/80 text-indigo-300 border-indigo-700/50',
    superuser: 'bg-purple-950/80 text-purple-300 border-purple-700/50',
    user: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50',
  };

  const roleLabel: Record<string, string> = {
    admin: 'Admin',
    superuser: 'SuperUser',
    user: 'Student',
  };

  return (
    <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-900/30">
            <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-sm sm:text-base text-white tracking-tight">PANDA</span>
              {currentUser && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] sm:text-xs font-semibold uppercase rounded border ${
                    roleBadgeColors[currentUser.role] || 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {roleLabel[currentUser.role] || currentUser.role}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 hidden md:block">Pin And Network-based Door Authentication</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Keypad Simulator trigger (toggleable via VITE_ENABLE_SIMULATOR) */}
          {import.meta.env.VITE_ENABLE_SIMULATOR === 'true' && (
            <button
              onClick={onOpenSimulator}
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition active:scale-95"
              title="ESP32 Door Keypad Simulator"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Keypad Simulator</span>
            </button>
          )}

          {/* User controls */}
          {currentUser && (
            <div className="flex items-center gap-1 sm:gap-2 pl-1.5 sm:pl-2 border-l border-slate-800">
              <div className="text-right hidden lg:block max-w-[140px] truncate">
                <div className="text-xs font-semibold text-white truncate">{currentUser.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{currentUser.email}</div>
              </div>

              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition active:scale-95"
                title="Account Settings"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 text-xs transition active:scale-95"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
