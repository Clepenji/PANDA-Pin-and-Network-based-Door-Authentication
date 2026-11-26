import React, { useState, useEffect } from 'react';
import { X, Trash2, User, Shield, ShieldCheck, GraduationCap, Volume2, VolumeX } from 'lucide-react';
import { api } from '../services/api';
import { pushService } from '../services/pushNotification';
import { playAlertChime } from '../utils/audio';
import { isValidPhoneNumber, normalizePhoneNumber } from '../utils/format';
import { UserProfile, Club } from '../types';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onProfileUpdated: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
  showToast,
}) => {
  const [name, setName] = useState(currentUser?.name || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [collegeYear, setCollegeYear] = useState(currentUser?.college_year || 'Not Applicable');
  const [clubSelection, setClubSelection] = useState(currentUser?.club_name || '');
  const [note, setNote] = useState(currentUser?.note || '');
  const [customClub, setCustomClub] = useState('');
  const [availableClubs, setAvailableClubs] = useState<Club[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('panda_su_sound_enabled');
    return saved === null ? true : saved === 'true';
  });
  const [alertBusy, setAlertBusy] = useState(false);

  useEffect(() => {
    const onSoundChanged = (e: Event) => {
      const val = (e as CustomEvent<boolean>).detail;
      if (typeof val === 'boolean') setSoundEnabled(val);
    };
    window.addEventListener('panda-su-sound-changed', onSoundChanged);
    return () => window.removeEventListener('panda-su-sound-changed', onSoundChanged);
  }, []);

  const handleToggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setAlertBusy(true);
    try {
      const res = await pushService.setAlertsEnabled(next);
      if (next && res.pushError) {
        showToast(`In-app alerts ON (${res.pushError})`, 'info');
      } else {
        showToast(next ? 'Alerts & notifications enabled' : 'Alerts & notifications muted', 'success');
      }
    } finally {
      setAlertBusy(false);
    }
  };

  const handleTestUnifiedAlert = async () => {
    playAlertChime();
    if (pushService.isPushSupported() && pushService.isSecureContext()) {
      try {
        const res = await pushService.sendTestAlert();
        if (res.delivered_count > 0) {
          showToast('Test alert & push notification sent!', 'success');
          return;
        }
      } catch {}
    }
    showToast('Test alert chime played', 'info');
  };

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    setName(currentUser.name || '');
    setPhone(currentUser.phone || '');
    setCollegeYear(currentUser.college_year || 'Not Applicable');
    setClubSelection(currentUser.club_name || '');
    setNote(currentUser.note || '');
    setCustomClub('');

    let active = true;
    const hydrateModal = async () => {
      try {
        const [freshProfile, clubs] = await Promise.all([
          api.fetchProfile().catch(() => null),
          api.fetchClubs().catch(() => [] as Club[]),
        ]);
        if (!active) return;

        setAvailableClubs(clubs);
        if (freshProfile) {
          setName(freshProfile.name || '');
          setPhone(freshProfile.phone || '');
          setCollegeYear(freshProfile.college_year || 'Not Applicable');
          setClubSelection(freshProfile.club_name || '');
          setNote(freshProfile.note || '');
          localStorage.setItem('panda_profile', JSON.stringify(freshProfile));
        }
      } catch (e) {
        console.warn('Failed to hydrate profile modal:', e);
      }
    };
    hydrateModal();

    return () => {
      active = false;
    };
  }, [isOpen, currentUser]);

  if (!isOpen || !currentUser) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone) {
      const normPhone = normalizePhoneNumber(phone);
      if (!isValidPhoneNumber(normPhone)) {
        showToast('Please enter a valid 10-15 digit phone number', 'error');
        return;
      }
    }

    let finalClubName: string | undefined = undefined;
    if (currentUser.role !== 'admin') {
      if (clubSelection === '__new__') {
        if (!customClub.trim()) {
          showToast('Please enter a name for the new club', 'error');
          return;
        }
        finalClubName = customClub.trim();
      } else {
        finalClubName = clubSelection.trim();
      }
    }

    try {
      setSubmitting(true);
      const updated = await api.updateProfile({
        name: name.trim() || undefined,
        phone: phone ? normalizePhoneNumber(phone) : undefined,
        college_year: currentUser.role !== 'admin' ? collegeYear : undefined,
        club_name: finalClubName,
        note: note !== undefined ? note.trim() : undefined,
      });
      localStorage.setItem('panda_profile', JSON.stringify(updated));
      showToast('Profile updated successfully', 'success');
      onProfileUpdated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    const roleLabel =
      currentUser.role === 'admin'
        ? 'Administrator'
        : currentUser.role === 'superuser'
        ? 'SuperUser'
        : 'User';
    if (
      !window.confirm(
        `Are you sure you want to permanently delete your ${roleLabel} account (${currentUser.email})?\n\nThis will remove your profile and access credentials.`
      )
    ) {
      return;
    }
    try {
      await api.deleteAccount();
      showToast('Account deleted successfully', 'info');
      localStorage.removeItem('panda_token');
      localStorage.removeItem('panda_profile');
      window.location.reload();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete account', 'error');
    }
  };

  const roleBadge = () => {
    if (currentUser.role === 'admin') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 flex items-center gap-1">
          <Shield className="w-3 h-3" />
          <span>Admin</span>
        </span>
      );
    }
    if (currentUser.role === 'superuser') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/60 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          <span>SuperUser</span>
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
        <GraduationCap className="w-3 h-3" />
        <span>Student</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Edit Profile Details</h3>
                {roleBadge()}
              </div>
              <p className="text-[11px] text-slate-400 font-mono">{currentUser.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleUpdate} className="space-y-3.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                Name <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-500">{name.length}/25</span>
            </div>
            <input
              type="text"
              required
              maxLength={25}
              placeholder="fill in what people call you"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {currentUser.role !== 'admin' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Contact Mobile Phone <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                placeholder="+919876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          )}

          {currentUser.role !== 'admin' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                College Year <span className="text-rose-500">*</span>
              </label>
              <select
                value={collegeYear}
                onChange={(e) => setCollegeYear(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
                <option value="Postgraduate">Postgraduate</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>
            </div>
          )}

          {currentUser.role !== 'admin' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Club Affiliation
              </label>
              <select
                value={clubSelection}
                onChange={(e) => setClubSelection(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Independent / No Club</option>
                {clubSelection &&
                  clubSelection !== '__new__' &&
                  !availableClubs.some((c) => c.name === clubSelection) && (
                    <option value={clubSelection}>{clubSelection}</option>
                  )}
                {availableClubs.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="__new__">+ Register New Club...</option>
              </select>
            </div>
          )}

          {clubSelection === '__new__' && currentUser.role !== 'admin' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">New Club Name</label>
                <span className="text-[10px] text-slate-500">{customClub.length}/25</span>
              </div>
              <input
                type="text"
                required
                maxLength={25}
                placeholder="Enter new club name (max 25 chars)"
                value={customClub}
                onChange={(e) => setCustomClub(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {currentUser.role === 'superuser' && currentUser.authorized_spaces && currentUser.authorized_spaces.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Designated Space Authority (Assigned by Admin)
              </label>
              <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg">
                {currentUser.authorized_spaces.map((slug) => (
                  <span
                    key={slug}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-950/60 text-purple-300 border border-purple-800/60"
                  >
                    {slug}
                  </span>
                ))}
              </div>
            </div>
          )}

          {currentUser.role !== 'admin' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">
                  Note <span className="text-slate-500 text-[10px]">(Optional)</span>
                </label>
                <span className="text-[10px] text-slate-500">{note.length}/255</span>
              </div>
              <textarea
                rows={2}
                maxLength={255}
                placeholder="If you have a title or are a representative, mention it here"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          )}

          {currentUser.role !== 'admin' && (
            <div className={`${currentUser.role === 'superuser' ? 'md:hidden ' : ''}p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Alerts &amp; Notifications
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={alertBusy}
                  onClick={handleToggleSound}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    soundEnabled
                      ? 'bg-purple-900/40 text-purple-200 border border-purple-700/50'
                      : 'bg-slate-900 text-slate-400 border border-slate-700'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{soundEnabled ? 'Alerts ON' : 'Alerts OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestUnifiedAlert}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                >
                  Test
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-2.5 pt-3 border-t border-slate-800">
            {currentUser.email?.toLowerCase().trim() !== 'rehankuriance@gmail.com' ? (
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="w-full sm:w-auto justify-center text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 transition px-3 py-2 sm:py-1.5 rounded-lg border border-rose-900/40 hover:bg-rose-950/40 active:scale-95 whitespace-nowrap"
                title="Permanently delete your account"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Delete Account</span>
              </button>
            ) : <div className="hidden sm:block" />}

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition whitespace-nowrap text-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-initial px-4 py-2 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition active:scale-95 shadow-md shadow-indigo-900/30 whitespace-nowrap text-center"
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;
