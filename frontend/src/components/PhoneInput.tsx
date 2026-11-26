import React, { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';

interface PhoneInputProps {
  value: string; // e.g. "+919876543210"
  onChange: (fullPhone: string, isValid: boolean) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳', digits: 10 },
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸', digits: 10 },
  { code: '+44', country: 'UK', flag: '🇬🇧', digits: 10 },
  { code: '+61', country: 'Australia', flag: '🇦🇺', digits: 9 },
  { code: '+971', country: 'UAE', flag: '🇦🇪', digits: 9 },
  { code: '+65', country: 'Singapore', flag: '🇸🇬', digits: 8 },
  { code: '+49', country: 'Germany', flag: '🇩🇪', digits: 10 },
];

export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  onChange,
  required = true,
  disabled = false,
  className = '',
}) => {
  // Parse initial value or default to +91
  const [selectedCode, setSelectedCode] = useState<string>('+91');
  const [localNumber, setLocalNumber] = useState<string>('');
  const [touched, setTouched] = useState<boolean>(false);

  useEffect(() => {
    if (value) {
      const match = COUNTRY_CODES.find((c) => value.startsWith(c.code));
      if (match) {
        setSelectedCode(match.code);
        setLocalNumber(value.slice(match.code.length));
      } else if (value.startsWith('+')) {
        // Fallback for custom code
        setSelectedCode('+91');
        setLocalNumber(value.replace(/^\+91/, ''));
      } else {
        setLocalNumber(value);
      }
    }
  }, []);

  const currentCountry = COUNTRY_CODES.find((c) => c.code === selectedCode) || COUNTRY_CODES[0];
  const requiredDigits = currentCountry.digits;
  const cleanedDigits = localNumber.replace(/\D/g, '');
  const isValid = cleanedDigits.length === requiredDigits;

  const handleLocalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, requiredDigits);
    setLocalNumber(raw);
    const valid = raw.length === requiredDigits;
    onChange(`${selectedCode}${raw}`, valid);
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCode = e.target.value;
    setSelectedCode(newCode);
    const country = COUNTRY_CODES.find((c) => c.code === newCode) || COUNTRY_CODES[0];
    const sliced = cleanedDigits.slice(0, country.digits);
    setLocalNumber(sliced);
    onChange(`${newCode}${sliced}`, sliced.length === country.digits);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-semibold text-slate-300">
        Phone Number {required && <span className="text-rose-400">*</span>}
      </label>

      <div className="relative flex rounded-xl border border-slate-700 bg-slate-950 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all">
        {/* Country Code Selector */}
        <div className="flex items-center pl-3 pr-2 border-r border-slate-800 bg-slate-900/60 rounded-l-xl">
          <span className="text-sm mr-1.5">{currentCountry.flag}</span>
          <select
            value={selectedCode}
            onChange={handleCodeChange}
            disabled={disabled}
            aria-label="Select Country Code"
            className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer pr-1"
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code} className="bg-slate-900 text-slate-100">
                {c.code} ({c.country})
              </option>
            ))}
          </select>
        </div>

        {/* Local Number Input */}
        <div className="relative flex-1 flex items-center">
          <input
            type="tel"
            inputMode="numeric"
            value={localNumber}
            onChange={handleLocalChange}
            onBlur={() => setTouched(true)}
            disabled={disabled}
            placeholder={`${requiredDigits} digits`}
            className="w-full bg-transparent px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 font-mono tracking-wider focus:outline-none"
          />

          <div className="pr-3 flex items-center pointer-events-none">
            {cleanedDigits.length > 0 && isValid && (
              <Check className="w-4 h-4 text-emerald-400" />
            )}
            {cleanedDigits.length > 0 && !isValid && touched && (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>
        </div>
      </div>

      {touched && !isValid && cleanedDigits.length > 0 && (
        <p className="text-[10px] text-rose-400 flex items-center gap-1 mt-0.5">
          <AlertCircle className="w-3 h-3" />
          Please enter a valid {requiredDigits}-digit phone number.
        </p>
      )}
    </div>
  );
};
