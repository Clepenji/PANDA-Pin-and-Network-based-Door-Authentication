import React, { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../services/api';

export const ResetWarningBanner: React.FC = () => {
  const [warningActive, setWarningActive] = useState<boolean>(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    api
      .fetchResetWarning()
      .then((data) => {
        setWarningActive(data.is_warning_active);
        setWarningMessage(data.warning_message || null);
      })
      .catch((err) => console.warn('Failed to load reset warning:', err));
  }, []);

  if (!warningActive || !warningMessage || dismissed) {
    return null;
  }

  return (
    <div className="bg-amber-950/90 border border-amber-600/70 text-amber-200 px-4 py-3 rounded-2xl shadow-xl flex items-start justify-between gap-3 animate-in fade-in">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <span className="font-bold text-amber-300 block mb-0.5">Annual System Reset Notice</span>
          <span>{warningMessage}</span>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 text-amber-400 hover:text-amber-100 rounded-lg hover:bg-amber-900/50 transition shrink-0"
        title="Dismiss Notice"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
