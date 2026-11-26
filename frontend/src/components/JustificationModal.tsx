import React, { useState } from 'react';
import { X, Send, KeyRound } from 'lucide-react';

interface JustificationModalProps {
  isOpen: boolean;
  spaceName: string;
  onClose: () => void;
  onSubmit: (justification: string) => Promise<void>;
}

export const JustificationModal: React.FC<JustificationModalProps> = ({
  isOpen,
  spaceName,
  onClose,
  onSubmit,
}) => {
  const [justification, setJustification] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const charCount = justification.length;
  const wordCount = justification.trim() ? justification.trim().split(/\s+/).length : 0;
  const isSubmitDisabled = !justification.trim() || isSubmitting || charCount > 256;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(justification.trim());
      setJustification('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 text-slate-100 relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-emerald-950/80 border border-emerald-600/50 rounded-2xl text-emerald-400">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Request Entry PIN</h3>
            <p className="text-xs text-slate-400">Petition for physical entry to {spaceName}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-800/60 text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Reason for Access <span className="text-rose-500 font-bold">*</span>
              </label>
              <span
                className={`text-[11px] font-mono ${
                  charCount > 240 ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {charCount} / 256
              </span>
            </div>

            <textarea
              required
              rows={4}
              maxLength={256}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="State your task, project, or event purpose..."
              className="w-full p-3.5 rounded-2xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none leading-relaxed"
              autoFocus
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 px-0.5">
              <span>Suggested: ~20 words explaining your visit</span>
              <span className="font-mono text-slate-400">{wordCount} words</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg ${
                !isSubmitDisabled
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950 active:scale-95'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Submitting...' : 'Send Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
