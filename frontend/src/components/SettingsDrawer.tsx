import React, { useState, useEffect } from 'react';
import { X, Trash2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { PhoneInput } from './PhoneInput';
import { ClubSelector } from './ClubSelector';
import { ResetWarningBanner } from './ResetWarningBanner';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ isOpen, onClose }) => {
  const { user, refreshProfile, logout } = useAuth();

  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [isPhoneValid, setIsPhoneValid] = useState<boolean>(true);
  const [clubName, setClubName] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.email ? '' : ''); // loaded on mount
      setClubName(user.club_name || '');
      // Fetch full profile details
      api
        .fetchProfile()
        .then((profile: any) => {
          if (profile.name) setName(profile.name);
          if (profile.phone) setPhone(profile.phone);
          if (profile.club_name) setClubName(profile.club_name);
        })
        .catch((err) => console.warn('Could not load profile details:', err));
    }
  }, [user, isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }
    if (!isPhoneValid && phone) {
      setMessage({ type: 'error', text: 'Please enter a valid phone number.' });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      await api.updateProfile({
        name: name.trim(),
        phone: phone || undefined,
        club_name: clubName || undefined,
      });
      await refreshProfile();
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setMessage(null);
    try {
      await api.deleteAccount();
      logout();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to delete account.' });
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm sm:max-w-md bg-slate-900 border-l border-slate-800 h-full p-6 flex flex-col justify-between shadow-2xl text-slate-100 overflow-y-auto animate-in slide-in-from-right duration-200">
        <div className="space-y-6">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-lg text-white">Account Settings</h3>
              <p className="text-xs text-slate-400 font-mono truncate max-w-[240px]">{user?.email}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Reset Warning Notice */}
          <ResetWarningBanner />

          {/* Feedback Message */}
          {message && (
            <div
              className={`p-3.5 rounded-2xl text-xs flex items-center gap-2 border ${
                message.type === 'success'
                  ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/70 border-rose-800/60 text-rose-300'
              }`}
            >
              {message.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Profile Edit Form */}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300">Name</label>
                <span className="text-[10px] text-slate-500">{name.length}/25</span>
              </div>
              <div className="relative flex items-center">
                <input
                  type="text"
                  required
                  maxLength={25}
                  placeholder="fill in what people call you"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>

            <div>
              <PhoneInput
                value={phone}
                onChange={(p, valid) => {
                  setPhone(p);
                  setIsPhoneValid(valid);
                }}
                required={false}
              />
            </div>

            <div>
              <ClubSelector
                value={clubName}
                onChange={(c) => setClubName(c)}
                required={false}
              />
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950 transition active:scale-95 disabled:opacity-50"
            >
              {isSaving ? 'Saving Changes...' : 'Save Profile Changes'}
            </button>
          </form>

          {/* Danger Zone: Account Deletion */}
          <div className="border-t border-slate-800 pt-6 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400">
              Danger Zone
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Deleting your account purges your profile, room registrations, and active PINs from the PANDA system.
            </p>

            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-2.5 px-4 rounded-xl border border-rose-900/60 bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 text-xs font-bold transition flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Account</span>
              </button>
            ) : (
              <div className="p-3.5 bg-rose-950/40 border border-rose-800 rounded-2xl space-y-3 animate-in fade-in">
                <span className="text-xs font-bold text-rose-300 block">
                  Are you absolutely sure?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={isDeleting}
                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-950 disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-slate-800 pt-4 text-center text-[10px] text-slate-500">
          PANDA Door Authentication • Secure College Portal
        </div>
      </div>
    </div>
  );
};
