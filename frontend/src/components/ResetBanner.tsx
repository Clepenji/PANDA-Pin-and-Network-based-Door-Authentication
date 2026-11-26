import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ResetWarningInfo } from '../types';

interface ResetBannerProps {
  bannerStatus?: ResetWarningInfo | null;
}

export const ResetBanner: React.FC<ResetBannerProps> = ({ bannerStatus }) => {
  const [dismissed, setDismissed] = useState(false);

  if (!bannerStatus?.is_warning_active || dismissed) {
    return null;
  }

  return (
    <div className="bg-amber-950/40 border-b border-amber-500/30 px-3 sm:px-4 py-2 text-xs text-amber-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="leading-tight text-[11px] sm:text-xs">
            {bannerStatus.warning_message ||
              'Notice: All users and superusers (created before July 15th) will be deleted from the system on September 1st for the new academic year.'}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-400 hover:text-white p-1 rounded hover:bg-amber-900/30 transition shrink-0"
          title="Dismiss warning banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default ResetBanner;
