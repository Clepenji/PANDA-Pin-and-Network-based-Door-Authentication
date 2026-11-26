import React, { useState, useEffect } from 'react';
import { Cpu, X, Lock, Unlock, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../services/api';

interface KeypadSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const KeypadSimulator: React.FC<KeypadSimulatorProps> = ({
  isOpen,
  onClose,
  showToast,
}) => {
  const [spaces, setSpaces] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastEventResult, setLastEventResult] = useState<{
    granted: boolean;
    message: string;
    entrant?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.fetchSpaces()
        .then((sps) => {
          if (sps && sps.length > 0) {
            setSpaces(sps);
            if (!sps.some((s) => s.slug === selectedSlug)) {
              setSelectedSlug(sps[0].slug);
            }
          }
        })
        .catch((err) => {
          console.error('Failed to fetch spaces for simulator:', err);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyClick = (val: string) => {
    if (pinInput.length < 6) {
      setPinInput((prev) => prev + val);
    }
  };

  const handleClear = () => {
    setPinInput('');
    setLastEventResult(null);
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
  };

  const handleSimulateUnlock = async () => {
    if (pinInput.length !== 6) {
      showToast('Keypad PIN must be 6 digits', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.sendEsp32Event({
        space_id: selectedSlug,
        pin_entered: pinInput,
        timestamp: new Date().toISOString(),
      });

      setLastEventResult({
        granted: res.granted,
        message: res.message,
      });

      if (res.granted) {
        showToast(`Door UNLOCKED: Access granted`, 'success');
      } else {
        showToast('Access DENIED: Invalid or expired PIN', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Keypad simulation failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-4 sm:p-5 shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">ESP32 Keypad Simulator</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Space Switcher */}
        <div className="flex flex-wrap gap-2 my-3">
          {spaces.map((sp) => (
            <button
              key={sp.slug}
              onClick={() => {
                setSelectedSlug(sp.slug);
                setPinInput('');
                setLastEventResult(null);
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition ${
                selectedSlug === sp.slug
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/40'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              {sp.name}
            </button>
          ))}
        </div>

        {/* Keypad Display Screen */}
        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 text-center my-3 shadow-inner">
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
            <span>KEYPAD SCREEN</span>
            <span>{selectedSlug}</span>
          </div>

          <div className="h-10 flex items-center justify-center gap-2 font-mono text-xl sm:text-2xl font-bold tracking-widest text-indigo-300">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className={`w-7 h-8 rounded border flex items-center justify-center transition-all ${
                  pinInput[i]
                    ? 'border-indigo-400 bg-indigo-950/40 text-white'
                    : 'border-slate-800 bg-slate-900/40 text-slate-600'
                }`}
              >
                {pinInput[i] || '·'}
              </span>
            ))}
          </div>
        </div>

        {/* Result banner if simulated */}
        {lastEventResult && (
          <div
            className={`p-2.5 rounded-xl border text-xs mb-3 flex items-center gap-2 ${
              lastEventResult.granted
                ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-200'
                : 'bg-rose-950/80 border-rose-700/60 text-rose-200'
            }`}
          >
            {lastEventResult.granted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <div className="leading-tight">
              <span className="font-bold">
                {lastEventResult.granted ? 'Door Unlocked' : 'Access Denied'}:
              </span>{' '}
              {lastEventResult.message}
            </div>
          </div>
        )}

        {/* Numeric Keypad Buttons */}
        <div className="grid grid-cols-3 gap-2 my-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => handleKeyClick(digit)}
              className="h-11 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-700 text-white font-mono font-semibold text-base border border-slate-800 transition active:scale-95 shadow-sm"
            >
              {digit}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-11 rounded-xl bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 font-semibold text-xs border border-rose-900/50 transition active:scale-95"
          >
            Clear
          </button>
          <button
            onClick={() => handleKeyClick('0')}
            className="h-11 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-700 text-white font-mono font-semibold text-base border border-slate-800 transition active:scale-95 shadow-sm"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="h-11 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 font-semibold text-xs border border-slate-800 transition active:scale-95"
          >
            ⌫
          </button>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSimulateUnlock}
          disabled={submitting || pinInput.length !== 6}
          className="w-full mt-3 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-xs transition active:scale-98 shadow-md shadow-indigo-900/30"
        >
          {lastEventResult?.granted ? (
            <Unlock className="w-4 h-4 text-emerald-300" />
          ) : (
            <Lock className="w-4 h-4" />
          )}
          <span>{submitting ? 'Verifying PIN...' : 'Simulate Lock Entry'}</span>
        </button>
      </div>
    </div>
  );
};

export default KeypadSimulator;
