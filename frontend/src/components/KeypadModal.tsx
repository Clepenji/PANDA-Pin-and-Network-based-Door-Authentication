import React, { useState } from 'react';
import { Lock, Unlock, X, Delete, Check } from 'lucide-react';
import { useSpace } from '../context/SpaceContext';
import { api } from '../services/api';

interface KeypadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeypadModal: React.FC<KeypadModalProps> = ({ isOpen, onClose }) => {
  const { spaces, selectedSpaceSlug, setSelectedSpaceSlug } = useSpace();
  const [pin, setPin] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentSpace = spaces.find((s) => s.slug === selectedSpaceSlug) || spaces[0] || null;

  const handleDigit = (digit: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
    setStatusMessage(null);
    setIsSuccess(null);
  };

  const handleSubmit = async () => {
    if (!currentSpace) {
      setStatusMessage('No Facility Space configured yet');
      setIsSuccess(false);
      return;
    }

    if (pin.length !== 6) {
      setStatusMessage('Please enter full 6-digit PIN');
      setIsSuccess(false);
      return;
    }

    setIsVerifying(true);
    setStatusMessage('Verifying credentials...');
    setIsSuccess(null);

    try {
      const resp = await api.verifyKeypad(currentSpace.esp32_deviceId, pin);
      if (resp.granted) {
        setIsSuccess(true);
        setStatusMessage(`UNLOCKED: ${resp.message}`);
        setTimeout(() => {
          handleClear();
          onClose();
        }, 2200);
      } else {
        setIsSuccess(false);
        setStatusMessage(`DENIED: ${resp.message}`);
      }
    } catch (err: any) {
      setIsSuccess(false);
      setStatusMessage(`ERROR: ${err.message || 'Verification failed'}`);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-700 mb-2">
            {isSuccess ? (
              <Unlock className="w-6 h-6 text-emerald-400 animate-bounce" />
            ) : (
              <Lock className="w-6 h-6 text-indigo-400" />
            )}
          </div>
          <h3 className="text-lg font-bold">IoT Door Controller Keypad</h3>
          <p className="text-xs text-slate-400">Simulates physical ESP32 access lock</p>
        </div>

        {/* Space Selection (Dynamic) */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-400 mb-1">Target Facility Space</label>
          <div className="grid grid-cols-2 gap-2">
            {spaces.map((sp) => (
              <button
                key={sp.slug}
                onClick={() => {
                  setSelectedSpaceSlug(sp.slug);
                  handleClear();
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition border ${
                  selectedSpaceSlug === sp.slug
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {sp.name}
              </button>
            ))}
          </div>
        </div>

        {/* PIN Code Display */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-center mb-4">
          <div className="text-2xl tracking-[0.5em] font-mono font-bold text-emerald-400 min-h-[36px]">
            {pin.padEnd(6, '•')}
          </div>
          {statusMessage && (
            <div
              className={`text-xs mt-1.5 font-medium ${
                isSuccess ? 'text-emerald-400' : isSuccess === false ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {statusMessage}
            </div>
          )}
        </div>

        {/* 12-Key Pad */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              className="py-3 bg-slate-700 hover:bg-slate-600 active:scale-95 rounded-xl font-bold text-lg transition"
            >
              {digit}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="py-3 bg-slate-700/60 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl text-xs font-semibold uppercase tracking-wider transition"
          >
            Clear
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="py-3 bg-slate-700 hover:bg-slate-600 active:scale-95 rounded-xl font-bold text-lg transition"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="py-3 bg-slate-700/60 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl flex items-center justify-center transition"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        {/* Unlock Button */}
        <button
          onClick={handleSubmit}
          disabled={isVerifying || pin.length !== 6}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
            pin.length === 6 && !isVerifying
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          <Check className="w-4 h-4" />
          Unlock Door
        </button>
      </div>
    </div>
  );
};
