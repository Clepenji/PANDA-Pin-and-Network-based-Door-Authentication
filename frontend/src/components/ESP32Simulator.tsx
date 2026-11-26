import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  Terminal,
  Lock,
  Unlock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Delete,
  Database,
  Radio,
  Clock,
} from 'lucide-react';
import { useSpace } from '../context/SpaceContext';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { ESP32SyncPinItem } from '../types';

interface ConsoleLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export const ESP32Simulator: React.FC = () => {
  const { spaces, selectedSpaceSlug, setSelectedSpaceSlug } = useSpace();

  // Collapsible dock state (default minimized floating pill)
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Selected space on simulator
  const [activeSpaceSlug, setActiveSpaceSlug] = useState<string>(selectedSpaceSlug || 'sandboxx_0');

  // Keypad entered digits
  const [pinInput, setPinInput] = useState<string>('');

  // Hardware emulation state
  const [isRelayActive, setIsRelayActive] = useState<boolean>(false);
  const [lockStatus, setLockStatus] = useState<'LOCKED' | 'UNLOCKED' | 'DENIED'>('LOCKED');
  const [statusText, setStatusText] = useState<string>('SYSTEM READY');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Local ESP32 RAM Memory: synced PINs for this space
  const [localMemory, setLocalMemory] = useState<ESP32SyncPinItem[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Serial Console logs
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addConsoleLog = useCallback((message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setConsoleLogs((prev) => [
      ...prev.slice(-49), // Keep latest 50 logs
      { id: Math.random().toString(36).substring(2, 9), timestamp: time, level, message },
    ]);
  }, []);

  // Fetch / Sync memory for active space
  const fetchMemorySync = useCallback(async (slug: string) => {
    setIsSyncing(true);
    addConsoleLog(`[SYNC] Polling GET /api/esp32/${slug}/sync...`, 'info');
    try {
      const data = await api.syncEsp32Pins(slug);
      setLocalMemory(data.pins || []);
      addConsoleLog(
        `[SYNC] Successfully cached ${data.pins.length} active PIN(s) into SRAM`,
        'success'
      );
    } catch (err: any) {
      addConsoleLog(`[SYNC ERROR] Memory sync failed: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [addConsoleLog]);

  // Initial sync & sync on space change
  useEffect(() => {
    fetchMemorySync(activeSpaceSlug);
  }, [activeSpaceSlug, fetchMemorySync]);

  // Keep space in sync if user selects in portal
  useEffect(() => {
    if (selectedSpaceSlug && selectedSpaceSlug !== activeSpaceSlug) {
      setActiveSpaceSlug(selectedSpaceSlug);
    }
  }, [selectedSpaceSlug]);

  // Real-time WebSocket Listeners:
  // Listens on esp32:{activeSpaceSlug} and space:{activeSpaceSlug} for ADD_PIN and REVOKE_PIN
  useEffect(() => {
    const handleWsEvent = (event: any) => {
      // Check for ADD_PIN action
      if (event.action === 'ADD_PIN' && event.space_id === activeSpaceSlug) {
        addConsoleLog(`[WS:ADD_PIN] Received new active PIN ${event.pin} (expires: ${event.expires_at})`, 'success');
        setLocalMemory((prev) => {
          // Avoid duplicate pin entries
          const filtered = prev.filter((p) => p.pin !== event.pin);
          return [
            ...filtered,
            {
              pin: event.pin,
              expires_at: event.expires_at,
              holder_name: event.holder_name || 'Entrant User',
              holder_email: event.holder_email || 'user@college.edu',
            },
          ];
        });
      }

      // Check for REVOKE_PIN action
      if (event.action === 'REVOKE_PIN' && event.space_id === activeSpaceSlug) {
        addConsoleLog(`[WS:REVOKE_PIN] Hardware purge: PIN ${event.pin} revoked early! Removed from SRAM.`, 'warn');
        setLocalMemory((prev) => prev.filter((p) => p.pin !== event.pin));
      }

      // Check for PURGE_PINS action
      if (
        (event.action === 'PURGE_PINS' || event.type === 'PURGE_PINS' || event.event_type === 'PURGE_PINS') &&
        (event.space_id === activeSpaceSlug || event.space_slug === activeSpaceSlug)
      ) {
        addConsoleLog(`[WS:PURGE_PINS] Hardware purge: All cached PINs purged from SRAM!`, 'warn');
        setLocalMemory([]);
      }

      // Check for authoritative SYNC_PINS action
      if (
        (event.action === 'SYNC_PINS' || event.type === 'SYNC_PINS' || event.event_type === 'SYNC_PINS') &&
        (event.space_id === activeSpaceSlug || event.space_slug === activeSpaceSlug)
      ) {
        const syncdPins = event.pins || event.data?.pins || [];
        addConsoleLog(`[WS:SYNC_PINS] Authoritative PIN synchronization: ${syncdPins.length} active PIN(s) cached in SRAM`, 'success');
        setLocalMemory(syncdPins);
      }

      // Check for space event wrappers
      if (event.event_type === 'ACCESS_REQUEST_APPROVED' && event.space_slug === activeSpaceSlug) {
        addConsoleLog(`[EVENT] Access request approved. Expecting PIN cache synchronization.`, 'info');
      }

      if (event.event_type === 'DOOR_UNLOCKED' && event.space_slug === activeSpaceSlug) {
        addConsoleLog(`[AUDIT] Log Transmitted: DOOR_UNLOCKED (${event.data?.actor_name || 'Entrant'})`, 'success');
      }

      if (event.event_type === 'INVALID_PIN_ATTEMPT' && event.space_slug === activeSpaceSlug) {
        addConsoleLog(`[AUDIT] Log Transmitted: INVALID_PIN_ATTEMPT recorded in audit ledger`, 'error');
      }
    };

    const unsubEsp32 = wsService.subscribe(`esp32:${activeSpaceSlug}`, handleWsEvent);
    const unsubSpace = wsService.subscribe(`space:${activeSpaceSlug}`, handleWsEvent);
    const unsubGlobal = wsService.subscribe('global', handleWsEvent);

    return () => {
      unsubEsp32();
      unsubSpace();
      unsubGlobal();
    };
  }, [activeSpaceSlug, addConsoleLog]);

  // Periodic expiration cleaner for local RAM display
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setLocalMemory((prev) =>
        prev.filter((p) => {
          const exp = new Date(p.expires_at);
          return exp > now;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll console
  useEffect(() => {
    if (isExpanded) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs, isExpanded]);

  const handleDigit = (digit: string) => {
    if (pinInput.length < 6) {
      setPinInput((prev) => prev + digit);
    }
  };

  const handleClear = () => {
    setPinInput('');
    setStatusText('KEYPAD CLEARED');
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
  };

  // Submit PIN to ESP32 event ingestion endpoint: POST /api/esp32/events
  const handleSubmitPin = async () => {
    if (pinInput.length !== 6) {
      setStatusText('ENTER 6 DIGITS');
      addConsoleLog('[KEYPAD] Invalid input length (< 6 digits)', 'warn');
      return;
    }

    setIsSubmitting(true);
    setStatusText('TRANSMITTING...');
    addConsoleLog(`[KEYPAD] Transmitting PIN ****** to /api/esp32/events...`, 'info');

    try {
      const resp = await api.sendEsp32Event({
        space_id: activeSpaceSlug,
        pin_entered: pinInput,
        timestamp: new Date().toISOString(),
        door_unlocked: true,
      });

      if (resp.granted) {
        setLockStatus('UNLOCKED');
        setIsRelayActive(true);
        setStatusText('DOOR UNLOCKED');
        addConsoleLog(`[RELAY] Door Unlocked! Pulse triggered for 5 seconds. Relay energised.`, 'success');
        addConsoleLog(`[AUDIT] Log Transmitted: DOOR_UNLOCKED stored with immutable actor attribution`, 'info');

        setTimeout(() => {
          setIsRelayActive(false);
          setLockStatus('LOCKED');
          setStatusText('SYSTEM READY');
          setPinInput('');
        }, 5000);
      } else {
        setLockStatus('DENIED');
        setStatusText('ACCESS DENIED');
        addConsoleLog(`[RELAY] Access Denied: PIN not found in active authorized list`, 'error');
        addConsoleLog(`[AUDIT] Log Transmitted: INVALID_PIN_ATTEMPT stored in CSV audit ledger`, 'warn');

        setTimeout(() => {
          setLockStatus('LOCKED');
          setStatusText('SYSTEM READY');
        }, 3000);
      }
    } catch (err: any) {
      setLockStatus('DENIED');
      setStatusText('COMM ERROR');
      addConsoleLog(`[ERROR] Ingestion failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSpaceConfig = spaces.find((s) => s.slug === activeSpaceSlug) || spaces[0] || null;

  return (
    <div className="fixed bottom-4 right-4 z-40 font-mono text-xs select-none">
      {/* Minimized Dock Button */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-950/90 border border-emerald-500/50 rounded-xl shadow-2xl hover:border-emerald-400 hover:bg-slate-900 text-slate-100 transition-all backdrop-blur-md group"
        >
          <div className="relative">
            <Cpu className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>
          <div className="flex flex-col text-left">
            <span className="font-bold text-xs tracking-wider text-emerald-400 flex items-center gap-1.5">
              ESP32 WROOM Simulator
              <span className="text-[10px] px-1.5 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">
                LIVE
              </span>
            </span>
            <span className="text-[10px] text-slate-400">
              {currentSpaceConfig?.name || 'SandBoxx 0'} • {localMemory.length} PINs in SRAM
            </span>
          </div>
          <ChevronUp className="w-4 h-4 text-slate-400 ml-1 group-hover:text-emerald-400" />
        </button>
      )}

      {/* Expanded Virtual Hardware Panel */}
      {isExpanded && (
        <div className="w-[420px] max-h-[85vh] flex flex-col bg-slate-950 border-2 border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
          {/* Hardware Header Bar */}
          <div className="bg-slate-900 border-b border-slate-800 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-950/70 border border-emerald-700/50 rounded-lg">
                <Cpu className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="font-bold text-slate-100 flex items-center gap-2">
                  ESP32-WROOM-32
                  <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded border border-slate-700">
                    240MHz
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                  WiFi: Connected • 115200 Baud
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Status LEDs */}
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex items-center gap-1" title="Power LED">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse" />
                  <span className="text-[9px] text-slate-400">PWR</span>
                </div>
                <div className="flex items-center gap-1" title="Relay / Solenoid Lock State">
                  <span
                    className={`w-2 h-2 rounded-full transition-colors ${
                      isRelayActive
                        ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-ping'
                        : lockStatus === 'DENIED'
                        ? 'bg-rose-500 shadow-sm shadow-rose-500'
                        : 'bg-amber-500/40'
                    }`}
                  />
                  <span className="text-[9px] text-slate-400">RLY</span>
                </div>
              </div>

              {/* Minimize button */}
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                title="Minimize Hardware Panel"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Target Space Selection Dropdown (Dynamically Populated from Registry) */}
            <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                Facility Space:
              </label>
              <select
                value={activeSpaceSlug}
                onChange={(e) => {
                  setActiveSpaceSlug(e.target.value);
                  setSelectedSpaceSlug(e.target.value);
                  handleClear();
                }}
                className="bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:border-emerald-500"
              >
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name} ({sp.slug})
                  </option>
                ))}
              </select>
            </div>

            {/* Simulated 16x2 OLED / LCD Display Screen */}
            <div className="bg-emerald-950/20 border-2 border-emerald-900/60 rounded-xl p-3 shadow-inner relative overflow-hidden font-mono">
              <div className="flex items-center justify-between text-[10px] text-emerald-400/80 border-b border-emerald-900/40 pb-1 mb-2">
                <span>DOOR CONTROLLER NODE</span>
                <span className="flex items-center gap-1">
                  {lockStatus === 'UNLOCKED' ? (
                    <Unlock className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Lock className="w-3 h-3 text-emerald-400" />
                  )}
                  {lockStatus}
                </span>
              </div>

              {/* PIN Code / Status readout */}
              <div className="text-center py-1">
                <div className="text-2xl font-bold tracking-[0.4em] text-emerald-300 min-h-[32px]">
                  {pinInput ? pinInput.padEnd(6, '·') : '······'}
                </div>
                <div
                  className={`text-[10px] font-bold mt-1 tracking-wider ${
                    lockStatus === 'UNLOCKED'
                      ? 'text-emerald-400 animate-pulse'
                      : lockStatus === 'DENIED'
                      ? 'text-rose-400 animate-pulse'
                      : 'text-emerald-500/70'
                  }`}
                >
                  {statusText}
                </div>
              </div>
            </div>

            {/* Interactive Physical-Style Keypad */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleDigit(digit)}
                  className="py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-100 font-bold text-base rounded-xl border border-slate-800 shadow-sm transition"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handleClear}
                className="py-2.5 bg-rose-950/40 hover:bg-rose-900/50 active:scale-95 text-rose-300 font-bold text-xs uppercase tracking-wider rounded-xl border border-rose-900/50 transition"
              >
                Clear
              </button>
              <button
                onClick={() => handleDigit('0')}
                className="py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-100 font-bold text-base rounded-xl border border-slate-800 shadow-sm transition"
              >
                0
              </button>
              <button
                onClick={handleBackspace}
                className="py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-300 rounded-xl border border-slate-800 flex items-center justify-center transition"
              >
                <Delete className="w-4 h-4" />
              </button>
            </div>

            {/* Submit / Unlock Action Button */}
            <button
              onClick={handleSubmitPin}
              disabled={isSubmitting || pinInput.length !== 6}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition ${
                pinInput.length === 6 && !isSubmitting
                  ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-950'
                  : 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Unlock className="w-3.5 h-3.5" />
              Transmit Keypad Entry (Submit)
            </button>

            {/* Local RAM Memory Table (Synced PINs) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  Local RAM Memory ({localMemory.length} active)
                </span>
                <button
                  onClick={() => fetchMemorySync(activeSpaceSlug)}
                  disabled={isSyncing}
                  className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                  title="Force Polling Sync"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sync Memory
                </button>
              </div>

              {localMemory.length === 0 ? (
                <div className="text-[10px] text-slate-500 italic py-2 text-center">
                  No active PINs cached in SRAM for {currentSpaceConfig?.name}.
                  <br />
                  Approve a request or issue a direct PIN to watch live sync.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {localMemory.map((item) => {
                    const expires = new Date(item.expires_at);
                    const now = new Date();
                    const secondsLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));

                    return (
                      <div
                        key={item.pin}
                        className="flex items-center justify-between p-1.5 bg-slate-950 border border-slate-800/80 rounded-lg text-[10px]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 bg-emerald-950 border border-emerald-700/60 rounded font-mono font-bold text-emerald-400">
                            {item.pin}
                          </span>
                          <span className="text-slate-300 truncate max-w-[130px]" title={item.holder_email}>
                            {item.holder_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 font-mono text-[9px]">
                          <Clock className="w-3 h-3 text-amber-400" />
                          <span className={secondsLeft < 30 ? 'text-rose-400 font-bold animate-pulse' : 'text-slate-300'}>
                            {secondsLeft}s left
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Serial Hardware Console Output */}
            <div className="bg-black/90 border border-slate-800 rounded-xl p-2.5 font-mono">
              <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800/80 pb-1 mb-1.5">
                <span className="flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-emerald-400" />
                  UART0 Serial Console (115200)
                </span>
                <span className="text-[9px] text-slate-500">{consoleLogs.length} frames</span>
              </div>
              <div className="h-28 overflow-y-auto space-y-1 text-[9px] pr-1">
                {consoleLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-1.5 leading-relaxed">
                    <span className="text-slate-600 shrink-0">{log.timestamp}</span>
                    <span
                      className={`break-all ${
                        log.level === 'success'
                          ? 'text-emerald-400'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'error'
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
