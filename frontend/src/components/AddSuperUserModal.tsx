import React, { useState, useEffect } from 'react';
import { useSpace } from '../context/SpaceContext';
import { PhoneInput } from './PhoneInput';
import { ClubSelector } from './ClubSelector';
import { Shield, X, CheckSquare, Square, UserCheck, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { autoCompleteInstitutionalEmail } from '../utils/format';

interface AddSuperUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    email: string;
    phone: string;
    college_year: string;
    club_name?: string;
    allowed_spaces: string[];
  }) => Promise<void>;
}

export const AddSuperUserModal: React.FC<AddSuperUserModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { spaces } = useSpace();

  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [collegeYear, setCollegeYear] = useState<string>('Not Applicable');
  const [isPhoneValid, setIsPhoneValid] = useState<boolean>(false);
  const [clubName, setClubName] = useState<string>('');
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>(
    spaces.length > 0 ? [spaces[0].slug] : []
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [lookingUp, setLookingUp] = useState<boolean>(false);
  const [autofilledUser, setAutofilledUser] = useState<string | null>(null);
  const [allowedDomain, setAllowedDomain] = useState<string>('hyderabad.bits-pilani.ac.in');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fetchAuthConfig().then((cfg) => {
      if (cfg?.allowed_email_domain) setAllowedDomain(cfg.allowed_email_domain);
    }).catch(() => {});
  }, []);

  // Debounced lookup when institutional email is entered
  useEffect(() => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length < 5) {
      setAutofilledUser(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLookingUp(true);
      try {
        const res = await api.lookupRegisteredUser(cleanEmail);
        if (res.found && res.name) {
          setName(res.name.slice(0, 25));
          if (res.phone) {
            setPhone(res.phone);
            setIsPhoneValid(true);
          }
          if (res.college_year) setCollegeYear(res.college_year);
          if (res.club_name) setClubName(res.club_name);
          setAutofilledUser(res.name);
        } else {
          setAutofilledUser(null);
        }
      } catch {
        setAutofilledUser(null);
      } finally {
        setLookingUp(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [email]);

  if (!isOpen) return null;

  const toggleSpace = (slug: string) => {
    setSelectedSpaces((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Please provide Name and Email.');
      return;
    }
    if (!phone || !isPhoneValid) {
      setError('Please provide a valid 10-digit mobile phone number.');
      return;
    }
    if (selectedSpaces.length === 0) {
      setError('Please assign authority over at least one Facility Space.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone,
        college_year: collegeYear,
        club_name: clubName.trim() || undefined,
        allowed_spaces: selectedSpaces,
      });
      setName('');
      setEmail('');
      setPhone('');
      setCollegeYear('Not Applicable');
      setSelectedSpaces(spaces.length > 0 ? [spaces[0].slug] : []);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to register SuperUser.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-750 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Register SuperUser</h3>
            <p className="text-xs text-slate-400">Delegate Facility Space request adjudication privileges</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Institutional Email <span className="text-rose-500">*</span>
              </label>
              {lookingUp && (
                <span className="flex items-center gap-1 text-[10px] text-indigo-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> checking...
                </span>
              )}
            </div>
            <input
              type="email"
              required
              placeholder="e.g. lead@hyderabad.bits-pilani.ac.in"
              value={email}
              onChange={(e) => setEmail((prev) => autoCompleteInstitutionalEmail(prev, e.target.value, allowedDomain, e.target))}
              className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            {autofilledUser && (
              <div className="p-2.5 rounded-xl bg-indigo-950/70 border border-indigo-700/60 text-indigo-200 text-xs flex items-center gap-2 mt-2">
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Registered user <strong>{autofilledUser}</strong> detected. Details autofilled! Their user account will be upgraded to SuperUser.
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
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
              className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              College Year <span className="text-rose-500">*</span>
            </label>
            <select
              value={collegeYear}
              onChange={(e) => setCollegeYear(e.target.value)}
              className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="1st Year">1st Year</option>
              <option value="2nd Year">2nd Year</option>
              <option value="3rd Year">3rd Year</option>
              <option value="4th Year">4th Year</option>
              <option value="Postgraduate">Postgraduate</option>
              <option value="Not Applicable">Not Applicable</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Contact Mobile Phone <span className="text-rose-500">*</span>
            </label>
            <PhoneInput
              value={phone}
              onChange={(p, valid) => {
                setPhone(p);
                setIsPhoneValid(valid);
              }}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Club Affiliation
            </label>
            <ClubSelector
              value={clubName}
              onChange={setClubName}
            />
          </div>

          {/* Facility Space Authority Checkboxes */}
          <div className="space-y-2 pt-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Designated Space Authority <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {spaces.length === 0 ? (
                <div className="col-span-1 sm:col-span-2 text-xs text-slate-500 py-3 text-center">
                  No facility spaces configured yet. Add spaces in Admin Dashboard first.
                </div>
              ) : (
                spaces.map((sp) => {
                const isChecked = selectedSpaces.includes(sp.slug);
                return (
                  <button
                    key={sp.slug}
                    type="button"
                    onClick={() => toggleSpace(sp.slug)}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      isChecked
                        ? 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{sp.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{sp.slug}</div>
                    </div>
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600 shrink-0" />
                    )}
                  </button>
                );
              }))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-950/50 transition active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register SuperUser'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
