import React, { useState, useEffect } from 'react';
import { ShieldAlert, X, AlertTriangle, Crown } from 'lucide-react';
import { UserProfile } from '../types';
import { api } from '../services/api';
import { autoCompleteInstitutionalEmail } from '../utils/format';

interface AddAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; email: string; is_root?: boolean }) => Promise<void>;
  currentUser?: UserProfile | null;
}

export const AddAdminModal: React.FC<AddAdminModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  currentUser,
}) => {
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [isRoot, setIsRoot] = useState<boolean>(false);
  const [allowedDomain, setAllowedDomain] = useState<string>('hyderabad.bits-pilani.ac.in');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fetchAuthConfig().then((cfg) => {
      if (cfg?.allowed_email_domain) setAllowedDomain(cfg.allowed_email_domain);
    }).catch(() => {});
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Please provide both administrator name and institutional email.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim().slice(0, 15),
        email: email.trim().toLowerCase(),
        is_root: currentUser?.is_root ? isRoot : false,
      });
      setName('');
      setEmail('');
      setIsRoot(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to establish administrator account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-750 w-full max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl relative space-y-5 max-h-[92dvh] overflow-y-auto my-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-rose-950/80 text-rose-400 border border-rose-800/80">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Add Secondary Administrator</h3>
            <p className="text-xs text-slate-400">Establish operational staff administration account</p>
          </div>
        </div>

        {/* Mandatory Staff Warning (Per Requirement) */}
        <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-rose-200 block mb-0.5">Security Warning: Staff Access Only</strong>
            <span>
              Administrator accounts possess full facility privileges, including security audit logs export, user deletion, and hardware telemetry. Never grant Administrator access to students or student leads.
            </span>
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
                Staff Name <span className="text-rose-500">*</span>
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
              className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Staff Email Address <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              required
              placeholder="e.g. faculty@hyderabad.bits-pilani.ac.in"
              value={email}
              onChange={(e) => setEmail((prev) => autoCompleteInstitutionalEmail(prev, e.target.value, allowedDomain, e.target))}
              className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono"
            />
          </div>

          {/* Root Admin Authority Checkbox (Visible when creator is Root Admin) */}
          {currentUser?.is_root && (
            <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-950/30 border border-amber-800/50 cursor-pointer hover:border-amber-750 transition select-none">
              <input
                type="checkbox"
                checked={isRoot}
                onChange={(e) => setIsRoot(e.target.checked)}
                className="mt-0.5 rounded border-amber-750 text-amber-500 focus:ring-amber-500 bg-slate-950"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-amber-200">Grant Root Administrator Status</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Grants full authority over Facility Spaces registration, ESP32 hardware secrets, and OTA firmware deployments.
                </p>
              </div>
            </label>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
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
              className="py-2.5 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/50 transition active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Confirm & Create Administrator'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
