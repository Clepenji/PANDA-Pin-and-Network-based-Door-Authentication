/**
 * Formatting and Validation Helpers for PANDA UI
 */

export function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return false;
  const clean = phone.replace(/[\s\-()]/g, '');
  return /^\+?[0-9]{10,15}$/.test(clean);
}

export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  const clean = phone.replace(/[\s\-()]/g, '');
  if (/^[0-9]{10}$/.test(clean)) {
    return `+91${clean}`;
  }
  if (!clean.startsWith('+') && clean.length >= 10) {
    return `+${clean}`;
  }
  return clean;
}

export function countWords(str: string): number {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

export function formatTimeAgo(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const dateStr = timestamp.includes('Z') || timestamp.includes('T') ? timestamp : `${timestamp}Z`;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatTimeOnly(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const dateStr = timestamp.includes('Z') || timestamp.includes('T') ? timestamp : `${timestamp}Z`;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

export function formatValidTill(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const dateStr = expiresAt.includes('Z') || expiresAt.includes('T') ? expiresAt : `${expiresAt}Z`;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${weekday}, ${time}`;
}

export interface DayColorInfo {
  bg: string;
  name: string;
  hex: string;
  border: string;
  text: string;
}

// Week days strictly ordered starting Monday per campus schedule policy
export const WEEK_DAYS: DayColorInfo[] = [
  { bg: 'bg-blue-500', name: 'Mon', hex: '#3b82f6', border: 'border-blue-500', text: 'text-blue-400' },
  { bg: 'bg-purple-500', name: 'Tue', hex: '#a855f7', border: 'border-purple-500', text: 'text-purple-400' },
  { bg: 'bg-emerald-500', name: 'Wed', hex: '#10b981', border: 'border-emerald-500', text: 'text-emerald-400' },
  { bg: 'bg-amber-500', name: 'Thu', hex: '#f59e0b', border: 'border-amber-500', text: 'text-amber-400' },
  { bg: 'bg-cyan-500', name: 'Fri', hex: '#06b6d4', border: 'border-cyan-500', text: 'text-cyan-400' },
  { bg: 'bg-pink-500', name: 'Sat', hex: '#ec4899', border: 'border-pink-500', text: 'text-pink-400' },
  { bg: 'bg-rose-500', name: 'Sun', hex: '#f43f5e', border: 'border-rose-500', text: 'text-rose-400' },
];

export function getDayColor(dateStr?: string | null): DayColorInfo {
  if (!dateStr) return { bg: 'bg-slate-500', name: '-', hex: '#64748b', border: 'border-slate-500', text: 'text-slate-400' };
  const parsed = dateStr.includes('Z') || dateStr.includes('T') ? dateStr : `${dateStr}Z`;
  const d = new Date(parsed);
  if (isNaN(d.getTime())) return { bg: 'bg-slate-500', name: '-', hex: '#64748b', border: 'border-slate-500', text: 'text-slate-400' };
  const day = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const dayColors: DayColorInfo[] = [
    { bg: 'bg-rose-500', name: 'Sun', hex: '#f43f5e', border: 'border-rose-500', text: 'text-rose-400' },
    { bg: 'bg-blue-500', name: 'Mon', hex: '#3b82f6', border: 'border-blue-500', text: 'text-blue-400' },
    { bg: 'bg-purple-500', name: 'Tue', hex: '#a855f7', border: 'border-purple-500', text: 'text-purple-400' },
    { bg: 'bg-emerald-500', name: 'Wed', hex: '#10b981', border: 'border-emerald-500', text: 'text-emerald-400' },
    { bg: 'bg-amber-500', name: 'Thu', hex: '#f59e0b', border: 'border-amber-500', text: 'text-amber-400' },
    { bg: 'bg-cyan-500', name: 'Fri', hex: '#06b6d4', border: 'border-cyan-500', text: 'text-cyan-400' },
    { bg: 'bg-pink-500', name: 'Sat', hex: '#ec4899', border: 'border-pink-500', text: 'text-pink-400' },
  ];
  return dayColors[day] || { bg: 'bg-slate-500', name: 'Day', hex: '#64748b', border: 'border-slate-500', text: 'text-slate-400' };
}

export function isAcademicTransitionPeriod(now: Date = new Date()): boolean {
  const m = now.getMonth(); // 0 = Jan, 6 = Jul, 7 = Aug, 8 = Sep
  const d = now.getDate();
  if (m === 6 && d >= 15) return true; // July 15-31
  if (m === 7) return true;            // Entire August
  if (m === 8 && d <= 1) return true;  // September 1
  return false;
}

export function getCohortTag(createdAt?: string | null, now: Date = new Date()): string | null {
  if (!isAcademicTransitionPeriod(now)) {
    return null;
  }
  if (!createdAt) return 'New';
  const createdDate = new Date(createdAt.includes('Z') || createdAt.includes('T') ? createdAt : `${createdAt}Z`);
  const currentYear = now.getFullYear();
  const transitionStart = new Date(currentYear, 6, 15, 0, 0, 0); // July 15 00:00:00
  return createdDate >= transitionStart ? 'New' : 'Old';
}

export function autoCompleteInstitutionalEmail(
  prevValue: string,
  nextValue: string,
  allowedDomain?: string,
  inputEl?: HTMLInputElement | null
): string {
  const domainClean = (allowedDomain || 'hyderabad.bits-pilani.ac.in')
    .split(',')[0]
    .trim()
    .replace(/^@+/, '');

  if (
    domainClean &&
    nextValue.length > prevValue.length &&
    nextValue.endsWith('@') &&
    nextValue.indexOf('@') === nextValue.length - 1
  ) {
    const completed = `${nextValue}${domainClean}`;
    if (inputEl) {
      const atIdx = nextValue.length - 1;
      requestAnimationFrame(() => {
        try {
          inputEl.setSelectionRange(atIdx + 1, completed.length);
        } catch {
          // Ignore selection errors on unsupported input types
        }
      });
    }
    return completed;
  }
  return nextValue;
}
