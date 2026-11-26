import React, { useState, useEffect, useCallback } from 'react';
import { Cpu, RefreshCw, Activity, Trash2, Pencil } from 'lucide-react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { ESP32DeviceStatus } from '../types';
import { formatTimeAgo } from '../utils/format';

interface ESP32StatusBarProps {
  allowedSpaces?: string[];
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
  className?: string;
  isRootAdmin?: boolean;
  canViewMac?: boolean;
  onDeleteLock?: (deviceId: string, lockName: string) => void;
  onEditLock?: (device: ESP32DeviceStatus) => void;
}

export const ESP32StatusBar: React.FC<ESP32StatusBarProps> = ({
  allowedSpaces,
  showToast,
  className = '',
  isRootAdmin = false,
  canViewMac = false,
  onDeleteLock,
  onEditLock,
}) => {
  const [devices, setDevices] = useState<ESP32DeviceStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [pingingSpace, setPingingSpace] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.fetchEsp32Status();
      setDevices(data);
    } catch (err: any) {
      console.warn('Failed to load ESP32 device status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();

    // Subscribe to real-time ESP32 device status updates over WebSocket
    const unsubscribe = wsService.subscribe('global', (event: any) => {
      const eventType = event.event_type || event.type;
      if (eventType === 'ESP_DEVICE_STATUS' && event.data) {
        const updated = event.data;
        setDevices((prev) => {
          const index = prev.findIndex(
            (d) =>
              (updated.device_id && d.device_id === updated.device_id) ||
              (updated.space_id && d.space_id === updated.space_id) ||
              (updated.id && d.id === updated.id)
          );
          if (index >= 0) {
            const next = [...prev];
            next[index] = {
              ...next[index],
              is_online: updated.is_online !== undefined ? updated.is_online : next[index].is_online,
              last_ping_ms: updated.last_ping_ms !== undefined ? updated.last_ping_ms : next[index].last_ping_ms,
              last_seen_at: updated.last_seen_at || next[index].last_seen_at,
              firmware_version: updated.firmware_version !== undefined ? updated.firmware_version : next[index].firmware_version,
              ip_address: updated.ip_address !== undefined ? updated.ip_address : next[index].ip_address,
              mac_address: updated.mac_address !== undefined ? updated.mac_address : next[index].mac_address,
            };
            return next;
          } else {
            // Do NOT append a floating block on ping or partial telemetry!
            // Refresh complete authoritative status from backend instead
            loadStatus();
            return prev;
          }
        });
      } else if (
        eventType === 'ESP_DEVICE_DELETED' ||
        eventType === 'FACILITY_SPACE_REMOVED' ||
        eventType === 'FACILITY_SPACE_CREATED' ||
        eventType === 'SPACE_UPDATED'
      ) {
        loadStatus();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadStatus]);

  const handleDeleteDevice = async (targetId: string, displayName: string) => {
    if (!onDeleteLock) return;
    // Optimistically remove from view immediately
    setDevices((prev) => prev.filter((d) => d.device_id !== targetId && d.id !== targetId && d.space_id !== targetId));
    try {
      await onDeleteLock(targetId, displayName);
    } finally {
      await loadStatus();
    }
  };

  const handlePing = async (targetId: string) => {
    if (!targetId) return;
    setPingingSpace(targetId);
    try {
      const res = await api.pingEsp32(targetId);
      setDevices((prev) =>
        prev.map((d) =>
          (d.device_id === targetId || d.space_id === targetId || d.id === targetId)
            ? {
                ...d,
                is_online: res.is_online,
                last_ping_ms: res.ping_ms ?? d.last_ping_ms,
                last_seen_at: res.last_seen_at || d.last_seen_at,
              }
            : d
        )
      );

      if (res.is_online && res.ping_ms !== undefined && res.ping_ms !== null) {
        showToast?.(`ESP32 [${targetId}] responded in ${res.ping_ms}ms`, 'success');
      } else {
        showToast?.(`ESP32 [${targetId}] is offline or ping timed out`, 'error');
      }
    } catch (err: any) {
      showToast?.(err.message || `Failed to ping ESP32 [${targetId}]`, 'error');
    } finally {
      setPingingSpace(null);
    }
  };

  // Filter by allowedSpaces if provided (for SuperUsers)
  const filteredDevices = allowedSpaces
    ? devices.filter((d) => d.space_id && allowedSpaces.includes(d.space_id))
    : devices;

  if (filteredDevices.length === 0 && !loading) {
    return (
      <div className={`bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center shadow-xl backdrop-blur-sm ${className}`}>
        <Cpu className="w-8 h-8 text-slate-600 mx-auto mb-2" />
        <h3 className="text-sm font-bold text-slate-300">No ESP32 Controllers Found</h3>
        <p className="text-xs text-slate-500 mt-1">
          {allowedSpaces
            ? 'No ESP32 hardware devices registered under your authorized spaces.'
            : 'No ESP32 hardware devices registered in the system.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800 text-cyan-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Hardware Status & Heartbeat
            </h3>
            <p className="text-[11px] text-slate-400">
              Real-time ESP32-WROOM node telemetry & anti-spoofing gateway
            </p>
          </div>
        </div>

        <button
          onClick={loadStatus}
          disabled={loading}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition text-xs flex items-center gap-1.5 font-mono"
          title="Refresh hardware status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredDevices.map((dev) => {
          const isOnline = dev.is_online;
          const targetId = dev.device_id || dev.space_id;
          const isPinging = pingingSpace === targetId;
          const pingMs = dev.last_ping_ms;
          const spaceDisplayName = dev.space_name || (dev.space_id || '').replace('_', ' ');
          const lockDisplayName = dev.name || 'Door Lock';

          return (
            <div
              key={dev.device_id || dev.id || dev.space_id}
              className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                isOnline
                  ? 'bg-slate-950/70 border-emerald-900/50 hover:border-emerald-700/60'
                  : 'bg-slate-950/70 border-rose-950/60 hover:border-rose-800/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  {/* Row 1: Space Name + Status Badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-100 uppercase tracking-wide truncate">
                      {spaceDisplayName}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1.5 shrink-0 ${
                        isOnline
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80'
                          : 'bg-rose-950/80 text-rose-400 border border-rose-800/80'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                        }`}
                      />
                      {isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  {/* Row 2: Lock Name in small text under space name */}
                  <div className="text-[11px] font-medium text-cyan-300 font-mono truncate flex items-center gap-1.5">
                    <span className="text-slate-300 font-semibold">{lockDisplayName}</span>
                    {dev.device_id && (
                      <span className="text-slate-500 text-[10px]">({dev.device_id})</span>
                    )}
                  </div>

                  {/* Row 3: Telemetry info with non-breaking MAC address */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 font-mono pt-0.5">
                    <span>{dev.firmware_version ? `FW: ${dev.firmware_version}` : 'FW: 1.0.0'}</span>
                    {dev.ip_address && dev.ip_address !== 'unknown' && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span>{dev.ip_address}</span>
                      </>
                    )}
                    {canViewMac && dev.mac_address && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span className="whitespace-nowrap inline-flex items-center gap-1">
                          <span>MAC:</span>
                          <span className="text-indigo-300 font-medium font-mono">{dev.mac_address}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Latency Badge (shrink-0 with whitespace-nowrap and min-w prevents text wrapping) */}
                <div className="shrink-0 text-right">
                  <span
                    className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border inline-flex items-center justify-center whitespace-nowrap min-w-[54px] ${
                      !isOnline || pingMs === null || pingMs === undefined
                        ? 'bg-slate-900 text-slate-500 border-slate-800'
                        : pingMs < 100
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : pingMs < 300
                        ? 'bg-amber-950 text-amber-400 border-amber-800'
                        : 'bg-rose-950 text-rose-400 border-rose-800'
                    }`}
                  >
                    {isOnline && pingMs !== null && pingMs !== undefined ? `${pingMs}ms` : '-- ms'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-850/80 text-[11px] text-slate-400">
                <span className="truncate">
                  {dev.last_seen_at
                    ? `Seen ${formatTimeAgo(dev.last_seen_at)}`
                    : 'Never connected'}
                </span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isRootAdmin && onEditLock && (
                    <button
                      onClick={() => onEditLock(dev)}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/40 border border-transparent hover:border-indigo-900/60 transition"
                      title={`Edit lock ${lockDisplayName}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {isRootAdmin && onDeleteLock && (dev.device_id || dev.id || dev.space_id) && (
                    <button
                      onClick={() => handleDeleteDevice((dev.device_id || dev.id || dev.space_id)!, lockDisplayName)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/60 transition"
                      title={`Remove lock ${lockDisplayName}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => handlePing(targetId || '')}
                    disabled={isPinging}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white transition font-medium flex items-center gap-1.5 border border-slate-700/80 disabled:opacity-50"
                    title="Send manual PING frame to device"
                  >
                    <Activity
                      className={`w-3 h-3 text-cyan-400 ${isPinging ? 'animate-spin' : ''}`}
                    />
                    <span>{isPinging ? 'Pinging...' : 'Ping Node'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ESP32StatusBar;
