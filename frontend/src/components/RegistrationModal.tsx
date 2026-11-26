import React, { useState, useEffect } from 'react';
import { X, UserPlus } from 'lucide-react';
import { api } from '../services/api';
import { isValidPhoneNumber, normalizePhoneNumber } from '../utils/format';
import { Club, SuperUserInfo, UserProfile } from '../types';

interface RegistrationModalProps {
  isOpen: boolean;
  pendingEmail: string | null;
  oauthRegistrationToken?: string | null;
  initialName?: string;
  onComplete: (user: UserProfile) => void;
  onCancel: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const RegistrationModal: React.FC<RegistrationModalProps> = ({
  isOpen,
  pendingEmail,
  oauthRegistrationToken,
  onComplete,
  onCancel,
  showToast,
}) => {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [collegeYear, setCollegeYear] = useState('1st Year');
  const [spaces, setSpaces] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const [clubSelection, setClubSelection] = useState('');
  const [customClub, setCustomClub] = useState('');
  const [availableClubs, setAvailableClubs] = useState<Club[]>([]);
  const [superuserId, setSuperuserId] = useState('');
  const [superusers, setSuperusers] = useState<SuperUserInfo[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Do not auto-fill name from Google Sign-In; let users enter what people call them
      setName('');
      setPhoneNumber('');
      setCollegeYear('1st Year');
      setClubSelection('');
      setCustomClub('');
      setNote('');
      setSubmitting(false);

      // 1. Fetch spaces
      api.fetchSpaces()
        .then((sps) => {
          setSpaces(sps);
          if (sps.length > 0) setSelectedSpaceId(sps[0].slug);
        })
        .catch(() => {
          setSpaces([]);
        });

      // 2. Fetch clubs (default to first registered club instead of Independent)
      api.fetchClubs()
        .then((c) => {
          setAvailableClubs(c);
          if (c && c.length > 0) {
            setClubSelection((prev) => prev || c[0].name);
          }
        })
        .catch(console.error);

      // 3. Fetch superusers
      api.fetchSuperUsers()
        .then((list) => {
          setSuperusers(list);
          const valid = list.filter((su) => (su.allowed_spaces || []).includes(selectedSpaceId));
          if (valid.length > 0) setSuperuserId(valid[0].id);
        })
        .catch(console.error);
    }
  }, [isOpen, pendingEmail]);

  // Sync selected superuser whenever clubSelection or selectedSpaceId or superusers change
  useEffect(() => {
    if (!isOpen) return;
    const valid = superusers.filter((su) => (su.allowed_spaces || []).includes(selectedSpaceId));
    const effectiveClub = clubSelection === '__new__' ? customClub.trim() : (clubSelection || (availableClubs.length > 0 ? availableClubs[0].name : ''));
    if (effectiveClub && valid.length > 0) {
      const clubMatch = valid.find(
        (su) => su.club_name && su.club_name.toLowerCase() === effectiveClub.toLowerCase()
      );
      if (clubMatch) {
        setSuperuserId(clubMatch.id);
        return;
      }
    }
    if (valid.length > 0 && !valid.some((su) => su.id === superuserId)) {
      setSuperuserId(valid[0].id);
    }
  }, [isOpen, selectedSpaceId, clubSelection, customClub, superusers, availableClubs]);

  if (!isOpen || !pendingEmail) return null;

  // Filter superusers who manage the chosen space
  const filteredSuperusers = superusers.filter((su) =>
    (su.allowed_spaces || []).includes(selectedSpaceId)
  );

  const handleSpaceChange = (newSpaceSlug: string) => {
    setSelectedSpaceId(newSpaceSlug);
    const valid = superusers.filter((su) => (su.allowed_spaces || []).includes(newSpaceSlug));
    const effectiveClub = clubSelection === '__new__' ? customClub.trim() : clubSelection;
    const clubMatch = valid.find(
      (su) => su.club_name && effectiveClub && su.club_name.toLowerCase() === effectiveClub.toLowerCase()
    );

    if (clubMatch) {
      setSuperuserId(clubMatch.id);
    } else if (valid.length > 0) {
      setSuperuserId(valid[0].id);
    } else {
      setSuperuserId('');
    }
  };

  const handleClubChange = (val: string) => {
    setClubSelection(val);
    if (val !== '__new__' && val) {
      const match = filteredSuperusers.find(
        (su) => su.club_name && su.club_name.toLowerCase() === val.toLowerCase()
      );
      if (match) {
        setSuperuserId(match.id);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Please enter your full name', 'error');
      return;
    }

    const normPhone = normalizePhoneNumber(phoneNumber);
    if (!isValidPhoneNumber(normPhone)) {
      showToast('Please enter a valid 10-15 digit phone number', 'error');
      return;
    }

    const effectiveClub = clubSelection === '__new__' ? customClub.trim() : clubSelection.trim();
    const effOAuthToken = oauthRegistrationToken || sessionStorage.getItem('panda_oauth_reg_token') || undefined;

    try {
      setSubmitting(true);
      const res = await api.register({
        email: pendingEmail,
        name: name.trim(),
        phone: normPhone,
        college_year: collegeYear,
        club_name: effectiveClub || undefined,
        space_id: selectedSpaceId,
        assigned_superuser_id: superuserId || undefined,
        note: note.trim() || undefined,
        oauth_registration_token: effOAuthToken,
      });

      sessionStorage.removeItem('panda_reg_email');
      sessionStorage.removeItem('panda_oauth_reg_token');
      sessionStorage.removeItem('panda_reg_name');

      const newUser: UserProfile = {
        id: res.email,
        email: res.email,
        name: res.name,
        phone: res.phone || normPhone,
        club_name: res.club_name || effectiveClub || undefined,
        role: res.role as any,
        is_root: res.is_root,
        college_year: res.college_year || collegeYear,
        note: res.note ?? (note.trim() || undefined),
        authorized_spaces: res.authorized_spaces,
      };

      if (res.access_token) {
        localStorage.setItem('panda_token', res.access_token);
        localStorage.setItem('panda_profile', JSON.stringify(newUser));
      }

      showToast(`Welcome, ${newUser.name}! Registration complete.`, 'success');
      onComplete(newUser);
    } catch (err: any) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">Student Registration</h3>
              <p className="text-[11px] text-slate-400">{pendingEmail}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
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

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Mobile Phone Number <span className="text-rose-500">*</span>
            </label>
            <input
              type="tel"
              required
              maxLength={20}
              placeholder="e.g. 9876543210"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">Country code +91 will be added automatically if omitted</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Primary Facility Space {spaces.length > 0 && <span className="text-rose-500">*</span>}
            </label>
            {spaces.length === 0 ? (
              <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-[11px] text-amber-200">
                No Facility Spaces are currently active. You can complete your profile now and select a space once an administrator creates one.
              </div>
            ) : (
              <select
                value={selectedSpaceId}
                onChange={(e) => handleSpaceChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Affiliated Club / Organization
            </label>
            <select
              value={clubSelection}
              onChange={(e) => handleClubChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              {availableClubs.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">+ Register New Club...</option>
              <option value="">Independent / No Club (General Student Body)</option>
            </select>
          </div>

          {clubSelection === '__new__' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">
                  New Club Name <span className="text-rose-500">*</span>
                </label>
                <span className="text-[10px] text-slate-500">{customClub.length}/25</span>
              </div>
              <input
                type="text"
                required
                maxLength={25}
                placeholder="Enter club name (max 25 chars)"
                value={customClub}
                onChange={(e) => setCustomClub(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              SuperUser (Single Authority)
            </label>
            <select
              value={superuserId}
              onChange={(e) => setSuperuserId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              {filteredSuperusers.length === 0 ? (
                <option value="">No leads registered for this space</option>
              ) : (
                filteredSuperusers.map((su) => (
                  <option key={su.id} value={su.id}>
                    {su.name}{su.club_name ? ` (${su.club_name})` : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                Note <span className="text-slate-500 text-[10px]">(Optional)</span>
              </label>
              <span className="text-[10px] text-slate-500">{note.length}/255</span>
            </div>
            <input
              type="text"
              maxLength={255}
              placeholder="If you have a title or are a representative, mention it here"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800 sticky bottom-0 bg-slate-900/95 backdrop-blur-sm -mx-5 -mb-5 p-3.5 sm:-mx-6 sm:-mb-6 sm:p-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-3.5 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-indigo-900/30"
            >
              {submitting ? 'Registering...' : 'Complete Registration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegistrationModal;
