import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { useSpace } from '../context/SpaceContext';
import { PortalLog } from '../types';
import { getDayColor } from '../utils/format';
import {
  Download,
  Calendar,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  DoorOpen,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  RefreshCw,
  Clock,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface ExcelSpaceLogsProps {
  title?: string;
  subtitle?: string;
}

type TimePreset = '7d' | '30d' | '90d' | '1y' | '3y' | 'custom';

export const ExcelSpaceLogs: React.FC<ExcelSpaceLogsProps> = ({
  title = 'Facility Access Logs',
  subtitle = 'Excel-style operational access records across all Facility Spaces',
}) => {
  const { spaces } = useSpace();

  const [logs, setLogs] = useState<PortalLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Filters
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [selectedSpace, setSelectedSpace] = useState<string>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Calculate start/end date ISO strings from preset
  const getDateRange = useCallback((): { startDate?: string; endDate?: string } => {
    const now = new Date();
    if (timePreset === 'custom') {
      return {
        startDate: customStartDate ? new Date(customStartDate).toISOString() : undefined,
        endDate: customEndDate ? new Date(customEndDate).toISOString() : undefined,
      };
    }

    const past = new Date();
    if (timePreset === '7d') past.setDate(now.getDate() - 7);
    else if (timePreset === '30d') past.setDate(now.getDate() - 30);
    else if (timePreset === '90d') past.setDate(now.getDate() - 90);
    else if (timePreset === '1y') past.setFullYear(now.getFullYear() - 1);
    else if (timePreset === '3y') past.setFullYear(now.getFullYear() - 3);

    return {
      startDate: past.toISOString(),
      endDate: now.toISOString(),
    };
  }, [timePreset, customStartDate, customEndDate]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = getDateRange();
      const data = await api.fetchPortalLogs(
        selectedSpace === 'all' ? undefined : selectedSpace,
        startDate,
        endDate,
        1000
      );
      setLogs(data);
    } catch (err) {
      console.error('Failed to load portal logs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSpace, getDateRange]);

  useEffect(() => {
    loadLogs();

    const unsubscribe = wsService.subscribe('global', () => {
      loadLogs();
    });

    return () => {
      unsubscribe();
    };
  }, [loadLogs]);

  const handleDownloadCsv = async () => {
    setIsExporting(true);
    try {
      await api.downloadAuditLogsCsv();
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Human-friendly event formatting (crisp labels with NO "granted")
  const formatEventLabel = (eventType: string): { label: string; color: string; icon: React.ReactNode } => {
    switch (eventType) {
      case 'DOOR_UNLOCKED':
      case 'DOOR_OPENED':
        return {
          label: 'Door Opened',
          color: 'text-emerald-400 bg-emerald-950/80 border-emerald-800/80',
          icon: <DoorOpen className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case 'ACCESS_GRANTED':
      case 'ACCESS_APPROVED':
        return {
          label: 'Access Approved',
          color: 'text-cyan-400 bg-cyan-950/80 border-cyan-800/80',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />,
        };
      case 'REQUEST_REJECTED':
        return {
          label: 'Request Rejected',
          color: 'text-rose-400 bg-rose-950/80 border-rose-800/80',
          icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          label: eventType.replace(/_/g, ' '),
          color: 'text-slate-300 bg-slate-800 border-slate-700',
          icon: <Info className="w-3.5 h-3.5 text-slate-400" />,
        };
    }
  };

  // Client-side filtering
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Event filter
      if (selectedEventType !== 'all') {
        const ev = String(log.event_type);
        if (selectedEventType === 'DOOR_OPENED' && !ev.includes('DOOR')) {
          return false;
        }
        if (selectedEventType === 'ACCESS_APPROVED' && !ev.includes('ACCESS') && !ev.includes('APPROVED')) {
          return false;
        }
        if (selectedEventType === 'REQUEST_REJECTED' && !ev.includes('REJECTED')) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const actorNameMatch = log.actor_name?.toLowerCase().includes(query);
        const actorEmailMatch = log.actor_email?.toLowerCase().includes(query);
        const authorityMatch = log.authority_name?.toLowerCase().includes(query);
        const spaceMatch = log.space_name?.toLowerCase().includes(query) || log.space_id?.toLowerCase().includes(query);
        const justificationMatch = log.justification_snapshot?.toLowerCase().includes(query);

        return actorNameMatch || actorEmailMatch || authorityMatch || spaceMatch || justificationMatch;
      }

      return true;
    });
  }, [logs, selectedEventType, searchQuery]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
      {/* Top Header & Export Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800/80">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">{title}</h2>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={loadLogs}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
            title="Refresh logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={handleDownloadCsv}
            disabled={isExporting}
            className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 transition active:scale-95 disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-100" />
            <span>{isExporting ? 'Exporting...' : 'Download CSV'}</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar (Excel Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
        {/* Time Filter Preset */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            Time Range
          </label>
          <select
            value={timePreset}
            onChange={(e) => setTimePreset(e.target.value as TimePreset)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-medium"
          >
            <option value="7d">Last 7 Days (Default)</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="1y">Last 1 Year</option>
            <option value="3y">Last 3 Years (Max Retention)</option>
            <option value="custom">Custom Date Range</option>
          </select>
        </div>

        {/* Space Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            Facility Space
          </label>
          <select
            value={selectedSpace}
            onChange={(e) => setSelectedSpace(e.target.value)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
          >
            <option value="all">All Facility Spaces</option>
            {spaces.map((sp) => (
              <option key={sp.slug} value={sp.slug}>
                {sp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Event Type Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            Event Type
          </label>
          <select
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
          >
            <option value="all">All Recorded Events</option>
            <option value="DOOR_OPENED">Door Opened</option>
            <option value="ACCESS_APPROVED">Access Approved</option>
            <option value="REQUEST_REJECTED">Request Rejected</option>
          </select>
        </div>

        {/* Search Input */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Search className="w-3.5 h-3.5 text-amber-400" />
            Search Person / Lead
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="Search name, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-750 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>

        {/* Custom Date Range Pickers (conditional) */}
        {timePreset === 'custom' && (
          <div className="col-span-1 sm:col-span-2 lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Start Date:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">End Date:</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Excel-Style Table (Grid layout with NO zebra striping, subtle cell borders) */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-900/90 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80 w-44">Timestamp</th>
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80 w-40">Event</th>
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Person</th>
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80 w-36">Facility Space</th>
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Authorized By</th>
              <th className="py-3 px-3 font-semibold text-center w-12">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500 text-xs">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                    <span>Querying access audit ledger...</span>
                  </div>
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500 text-xs">
                  No access log entries match the selected filters.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const eventInfo = formatEventLabel(log.event_type);
                const isExpanded = expandedLogId === log.id;
                const dayInfo = getDayColor(log.created_at);
                const formattedDate = new Date(log.created_at).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <React.Fragment key={log.id}>
                    {/* Main Row: Uniform row background (no zebra striping), subtle cell borders */}
                    <tr
                      className={`hover:bg-slate-900/70 transition-colors ${
                        isExpanded ? 'bg-slate-900/90' : 'bg-slate-950'
                      }`}
                    >
                      <td className="py-3 px-4 border-r border-slate-800/80 text-slate-400 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-4 rounded-full ${dayInfo.bg} shrink-0 inline-block`}
                            title={`${dayInfo.name} (${new Date(log.created_at).toLocaleDateString()})`}
                          />
                          <span>{formattedDate}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border ${eventInfo.color}`}
                        >
                          {eventInfo.icon}
                          {eventInfo.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80">
                        <div className="font-semibold text-slate-200">{log.actor_name}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[220px]">
                          {log.actor_email}
                        </div>
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap font-semibold text-slate-300">
                        {log.space_name || log.space_id}
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80">
                        <div className="font-medium text-slate-300">{log.authority_name}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                          {log.authority_email}
                        </div>
                      </td>

                      {/* Right-Side Expansion Icon Button */}
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title={isExpanded ? 'Collapse details' : 'Expand details'}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Inline Expansion Drawer (Reveals secondary details without adding clutter to the main row) */}
                    {isExpanded && (
                      <tr className="bg-slate-900/60 border-b border-slate-800">
                        <td colSpan={6} className="py-4 px-6 text-xs font-sans text-slate-300">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                            <div>
                              <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-cyan-400" />
                                Entry Justification & Purpose
                              </div>
                              <p className="text-slate-200 text-xs italic bg-slate-900/80 p-2.5 rounded-lg border border-slate-850">
                                {log.justification_snapshot || 'Direct key generation / physical door sensor unlock.'}
                              </p>
                            </div>

                            <div className="space-y-1.5 text-xs">
                              <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-1">
                                Ledger Cryptographic Metadata
                              </div>
                              <div className="flex justify-between border-b border-slate-850 pb-1 text-[11px]">
                                <span className="text-slate-500 font-mono">Record UUID:</span>
                                <span className="text-slate-300 font-mono text-[10px]">{log.id}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-850 pb-1 text-[11px]">
                                <span className="text-slate-500 font-mono">Audit Timestamp (UTC):</span>
                                <span className="text-slate-300 font-mono text-[10px]">
                                  {new Date(log.created_at).toUTCString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-slate-500 font-mono">Privacy Enforcement:</span>
                                <span className="text-emerald-400 font-mono text-[10px]">
                                  Raw PIN Sanitized • CSV Ledger Protected
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 pt-2 border-t border-slate-800/80 font-mono">
        <div>
          Showing {filteredLogs.length} of {logs.length} ledger events (3-year maximum rolling retention).
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Real-time WebSocket Synchronization Active</span>
        </div>
      </div>
    </div>
  );
};
