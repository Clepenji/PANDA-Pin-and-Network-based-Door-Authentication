import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Club } from '../types';
import { api } from '../services/api';

interface ClubSelectorProps {
  value: string;
  onChange: (clubName: string) => void;
  required?: boolean;
  disabled?: boolean;
}

export const ClubSelector: React.FC<ClubSelectorProps> = ({
  value,
  onChange,
  required = false,
  disabled = false,
}) => {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [newClubInput, setNewClubInput] = useState<string>('');

  useEffect(() => {
    api
      .fetchClubs()
      .then((data) => setClubs(data))
      .catch((err) => console.warn('Failed to fetch clubs:', err));
  }, []);

  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__CREATE_NEW__') {
      setIsCreatingNew(true);
      setNewClubInput('');
      onChange('');
    } else {
      onChange(val);
    }
  };

  const handleNewClubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setNewClubInput(text);
    onChange(text);
  };

  const handleCancelNew = () => {
    setIsCreatingNew(false);
    setNewClubInput('');
    onChange('');
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-300">
          Campus Club / Organization {required && <span className="text-rose-400">*</span>}
        </label>
        {isCreatingNew && (
          <button
            type="button"
            onClick={handleCancelNew}
            className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
          >
            <ArrowLeft className="w-3 h-3" /> Select Existing Club
          </button>
        )}
      </div>

      {!isCreatingNew ? (
        <div className="relative">
          <select
            value={value}
            onChange={handleDropdownChange}
            disabled={disabled}
            aria-label="Select Campus Club or Organization"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all cursor-pointer"
          >
            {clubs.map((c) => (
              <option key={c.id} value={c.name} className="bg-slate-900 text-slate-100">
                {c.name}
              </option>
            ))}
            <option value="" className="bg-slate-900 text-slate-100">
              Independent / No Club (General Student Body)
            </option>
            <option value="__CREATE_NEW__" className="text-emerald-400 font-semibold bg-slate-900">
              + New Club / Create Other
            </option>
          </select>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="relative flex items-center">
            <input
              type="text"
              required={required}
              maxLength={25}
              value={newClubInput}
              onChange={handleNewClubChange}
              placeholder="Type club name (max 25 chars)..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-500/80 bg-slate-950 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
              autoFocus
            />
          </div>
          <div className="text-right text-[10px] text-slate-500">{newClubInput.length}/25</div>
        </div>
      )}
    </div>
  );
};
