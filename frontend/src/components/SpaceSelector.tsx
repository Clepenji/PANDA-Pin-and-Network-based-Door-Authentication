import React from 'react';
import { useSpace } from '../context/SpaceContext';
import { Building2, KeyRound, Clock } from 'lucide-react';

export const SpaceSelector: React.FC = () => {
  const { spaces, selectedSpaceSlug, setSelectedSpaceSlug, statuses } = useSpace();

  return (
    <div className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl p-3 shadow-lg">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          Facility Space Selection
        </span>
        <span className="text-[11px] text-slate-500 font-medium">Dynamic Registry</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {spaces.length === 0 ? (
          <div className="col-span-1 sm:col-span-2 py-4 text-center text-xs text-slate-500">
            No Facility Spaces registered yet. Use Admin Dashboard to add spaces.
          </div>
        ) : (
          spaces.map((space) => {
          const isSelected = selectedSpaceSlug === space.slug;
          const status = statuses[space.slug];
          const activePins = status?.active_pin_count ?? 0;
          const pendingRequests = status?.pending_request_count ?? 0;

          return (
            <button
              key={space.slug}
              onClick={() => setSelectedSpaceSlug(space.slug)}
              className={`flex items-center justify-between p-3 rounded-xl border text-left transition ${
                isSelected
                  ? 'bg-emerald-950/40 border-emerald-500/80 text-white shadow-md ring-1 ring-emerald-500/30'
                  : 'bg-slate-800 border-slate-700/70 text-slate-300 hover:bg-slate-750 hover:border-slate-600'
              }`}
            >
              <div>
                <div className="font-semibold text-sm">{space.name}</div>
                <div className="text-[11px] text-slate-400 font-mono">{space.slug}</div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  title={`${activePins} active valid PINs`}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300 font-medium border border-emerald-700/50"
                >
                  <KeyRound className="w-3 h-3" />
                  {activePins}
                </span>

                {pendingRequests > 0 && (
                  <span
                    title={`${pendingRequests} pending requests`}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 font-medium border border-amber-700/50 animate-pulse"
                  >
                    <Clock className="w-3 h-3" />
                    {pendingRequests}
                  </span>
                )}
              </div>
            </button>
          );
        }))}
      </div>
    </div>
  );
};
