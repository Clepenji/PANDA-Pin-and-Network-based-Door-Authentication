import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSpace } from '../context/SpaceContext';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import {
  AdminMetrics,
  SecondaryAdmin,
  AdminSuperUser,
  DirectoryMember,
  ClusterGraphData,
  ActiveKeySummary,
} from '../types';
import { ExcelSpaceLogs } from '../components/ExcelSpaceLogs';
import { InteractiveClusterGraph } from '../components/InteractiveClusterGraph';
import { UserDirectory } from '../components/UserDirectory';
import { AddAdminModal } from '../components/AddAdminModal';
import { AddSuperUserModal } from '../components/AddSuperUserModal';
import { CopyButton } from '../components/CopyButton';
import {
  ShieldAlert,
  Users,
  Building2,
  Activity,
  FileSpreadsheet,
  Network,
  Shield,
  KeyRound,
  RotateCcw,
  UserPlus,
  Trash2,
  Lock,
} from 'lucide-react';

type AdminTab = 'logs' | 'directory_graph' | 'superusers_keys' | 'admin_accounts';
type SubView = 'graph' | 'directory';

export const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const { spaces } = useSpace();

  // Active Tab
  const [activeTab, setActiveTab] = useState<AdminTab>('logs');
  const [subView, setSubView] = useState<SubView>('graph');

  // Operational Metrics
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);

  // Secondary Admins
  const [admins, setAdmins] = useState<SecondaryAdmin[]>([]);
  const [isAddAdminOpen, setIsAddAdminOpen] = useState<boolean>(false);

  // SuperUsers
  const [superusers, setSuperusers] = useState<AdminSuperUser[]>([]);
  const [isAddSuperUserOpen, setIsAddSuperUserOpen] = useState<boolean>(false);

  // Active Keys (Universal)
  const [activeKeys, setActiveKeys] = useState<ActiveKeySummary[]>([]);

  // Directory & Cluster Graph Data
  const [directoryMembers, setDirectoryMembers] = useState<DirectoryMember[]>([]);
  const [clusterData, setClusterData] = useState<ClusterGraphData>({ nodes: [], links: [] });
  const [dirLoading, setDirLoading] = useState<boolean>(false);

  // Load Operational Metrics
  const loadMetrics = useCallback(async () => {
    try {
      const data = await api.fetchAdminMetrics();
      setMetrics(data);
    } catch (err) {
      console.error('Failed to load operational metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  // Load Secondary Admins
  const loadAdmins = useCallback(async () => {
    try {
      const data = await api.fetchSecondaryAdmins();
      setAdmins(data);
    } catch (err) {
      console.error('Failed to load secondary admins:', err);
    }
  }, []);

  // Load SuperUsers
  const loadSuperUsers = useCallback(async () => {
    try {
      const suData = await api.fetchAdminSuperUsers();
      setSuperusers(suData);
    } catch (err) {
      console.error('Failed to load superusers:', err);
    }
  }, []);

  // Load Active Keys across all spaces
  const loadActiveKeys = useCallback(async () => {
    try {
      const data = await api.fetchActiveKeys();
      setActiveKeys(data);
    } catch (err) {
      console.error('Failed to load active keys:', err);
    }
  }, []);

  // Load Directory & Cluster Graph
  const loadDirectoryAndGraph = useCallback(async () => {
    setDirLoading(true);
    try {
      const [dirData, graphData] = await Promise.all([
        api.fetchDirectory(),
        api.fetchClusterGraph(),
      ]);
      setDirectoryMembers(dirData);
      setClusterData(graphData);
    } catch (err) {
      console.error('Failed to load directory/graph data:', err);
    } finally {
      setDirLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    loadAdmins();
    loadSuperUsers();
    loadActiveKeys();
    loadDirectoryAndGraph();

    const unsubscribe = wsService.subscribe('global', () => {
      loadMetrics();
      loadActiveKeys();
    });

    return () => {
      unsubscribe();
    };
  }, [loadMetrics, loadAdmins, loadSuperUsers, loadActiveKeys, loadDirectoryAndGraph]);

  // Admin Account Actions
  const handleCreateAdmin = async (payload: { name: string; email: string }) => {
    await api.createSecondaryAdmin(payload);
    await loadAdmins();
  };

  const handleDeleteAdmin = async (adminId: string, email: string) => {
    if (!window.confirm(`Are you sure you want to delete administrator ${email}?`)) return;
    try {
      await api.deleteSecondaryAdmin(adminId);
      await loadAdmins();
    } catch (err: any) {
      alert(`Deletion failed: ${err.message}`);
    }
  };

  // SuperUser Actions
  const handleCreateSuperUser = async (payload: {
    name: string;
    email: string;
    phone: string;
    club_name?: string;
    allowed_spaces: string[];
  }) => {
    await api.createSuperUser(payload);
    await loadSuperUsers();
    await loadDirectoryAndGraph();
  };

  const handleRevokeSuperUser = async (suId: string, name: string) => {
    if (
      !window.confirm(
        `Revoke SuperUser privileges for ${name}? Their SuperUser authorization will immediately terminate and their next login will redirect to fresh User registration.`
      )
    )
      return;

    try {
      await api.revokeSuperUser(suId);
      await loadSuperUsers();
      await loadDirectoryAndGraph();
    } catch (err: any) {
      alert(`Revocation failed: ${err.message}`);
    }
  };

  // Active Key Revocation
  const handleRevokeKey = async (pinId: string, holderName: string) => {
    if (!window.confirm(`Revoke active key for ${holderName}? Physical lock will invalidate this code immediately.`))
      return;
    try {
      await api.revokePin(pinId);
      await loadActiveKeys();
    } catch (err: any) {
      alert(`Key revocation failed: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Desktop Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3.5 rounded-2xl bg-rose-950/80 text-rose-400 border border-rose-800/80 shadow-lg">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white">Facility Administration</h1>
              {user?.is_root && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                  Master Root Privilege
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Desktop-optimized management portal • Security telemetry, secondary staff, and cluster intelligence
            </p>
          </div>
        </div>

        {/* System Reset Placeholder Slot (Per Requirement) */}
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <div className="relative group">
            <button
              disabled
              className="py-2.5 px-4 rounded-xl bg-slate-950 text-slate-500 font-mono text-xs font-bold flex items-center gap-2 border border-slate-800 cursor-not-allowed opacity-70"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-500/70" />
              <span>System Reset</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Release Build
              </span>
            </button>
            <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-30 w-64 p-2.5 rounded-xl bg-slate-950 border border-slate-800 shadow-xl text-[11px] text-slate-400 font-sans">
              Annual September 1st Reset purges expired cohort accounts and archives 3-year audit ledgers. Hardcoded slot enabled in Release configuration.
            </div>
          </div>
        </div>
      </div>

      {/* Top Metrics Strip: Operational Analytics Cards ONLY */}
      {/* Strictly: 1. Total Registered Users, 2. Weekly Entries per Space, 3. Avg Access Requests/Day (No Active Pins or Pending Requests) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Registered Users */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
              <Users className="w-4 h-4 text-cyan-400" />
              Total Registered Users
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {metricsLoading ? '...' : metrics?.total_registered_users ?? 0}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 font-sans">
              Active facility student & lead directory accounts
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-cyan-950/60 text-cyan-400 border border-cyan-800/60">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Weekly Entries per Facility Space */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-emerald-400" />
              Weekly Entries per Space
            </div>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              Last 7 Days
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            {spaces.map((sp) => {
              const count = metrics?.weekly_entries_per_space[sp.slug] ?? 0;
              return (
                <div
                  key={sp.slug}
                  className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 flex flex-col"
                >
                  <span className="text-[11px] text-slate-400 font-medium truncate">{sp.name}</span>
                  <span className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                    {metricsLoading ? '...' : count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Average Access Requests per Day */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
              <Activity className="w-4 h-4 text-amber-400" />
              Avg. Requests / Day
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {metricsLoading ? '...' : `${metrics?.avg_access_requests_per_day ?? 0}`}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 font-sans">
              Daily adjudication throughput over last 30 days
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-amber-950/60 text-amber-400 border border-amber-800/60">
            <Activity className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Desktop Main Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
            activeTab === 'logs'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Shared Space Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('directory_graph')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
            activeTab === 'directory_graph'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/50'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Directory & Cluster Graph</span>
        </button>

        <button
          onClick={() => setActiveTab('superusers_keys')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
            activeTab === 'superusers_keys'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/50'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>SuperUsers & Active Keys</span>
          {activeKeys.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-200 text-[10px] font-mono border border-cyan-800">
              {activeKeys.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('admin_accounts')}
          className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
            activeTab === 'admin_accounts'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-950/50'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Secondary Admins</span>
          {admins.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-950 text-rose-200 text-[10px] font-mono border border-rose-800">
              {admins.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Excel-Style Shared Space Logs */}
      {activeTab === 'logs' && <ExcelSpaceLogs />}

      {/* Tab 2: Directory & Cluster Graph */}
      {activeTab === 'directory_graph' && (
        <div className="space-y-4">
          {/* Sub-View Switcher */}
          <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSubView('graph')}
                className={`py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  subView === 'graph'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>Interactive Cluster Graph</span>
              </button>

              <button
                onClick={() => setSubView('directory')}
                className={`py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  subView === 'directory'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Sortable Directory</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline px-3">
              K-Means Cluster Architecture • D3 Force-Directed Simulation
            </span>
          </div>

          {subView === 'graph' ? (
            <InteractiveClusterGraph data={clusterData} loading={dirLoading} />
          ) : (
            <UserDirectory
              members={directoryMembers}
              loading={dirLoading}
              onMemberDeleted={loadDirectoryAndGraph}
            />
          )}
        </div>
      )}

      {/* Tab 3: SuperUsers & Active Key Management */}
      {activeTab === 'superusers_keys' && (
        <div className="space-y-6">
          {/* Section A: SuperUser Lead Administration */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-400" />
                  SuperUser Lead Management
                </h3>
                <p className="text-xs text-slate-400">
                  Register delegated leads, adjust Facility Space authority, or revoke privileges
                </p>
              </div>

              <button
                onClick={() => setIsAddSuperUserOpen(true)}
                className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow-md"
              >
                <UserPlus className="w-4 h-4" />
                <span>Register SuperUser</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Lead Name</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Club</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Phone</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Authority</th>
                    <th className="py-3 px-4 font-semibold text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
                  {superusers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 font-sans text-xs">
                        No SuperUsers registered.
                      </td>
                    </tr>
                  ) : (
                    superusers.map((su) => (
                      <tr key={su.id} className="hover:bg-slate-900/60 bg-slate-950 transition-colors">
                        <td className="py-3 px-4 border-r border-slate-800/80 font-sans">
                          <div className="font-semibold text-slate-200">{su.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{su.email}</div>
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80 font-sans">
                          {su.club_name || <span className="text-slate-600 italic">Independent</span>}
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap">
                          <div className="flex items-center justify-between gap-2">
                            <span>{su.phone}</span>
                            <CopyButton textToCopy={su.phone} />
                          </div>
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80">
                          <div className="flex flex-wrap gap-1">
                            {(su.allowed_spaces || []).map((sp) => (
                              <span
                                key={sp}
                                className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 text-[10px] border border-indigo-800"
                              >
                                {sp}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleRevokeSuperUser(su.id, su.name)}
                            className="py-1 px-2.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-semibold transition active:scale-95"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section B: Active Keys Across All Spaces */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-cyan-400" />
                  Active Key Holders (All Spaces)
                </h3>
                <p className="text-xs text-slate-400">
                  Universal key management • Actual PIN numbers sanitized for security • Revoke any key early
                </p>
              </div>

              <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                {activeKeys.length} Active Key Tokens
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Key Holder</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Facility Space</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">PIN Status</th>
                    <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Valid Till</th>
                    <th className="py-3 px-4 font-semibold text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
                  {activeKeys.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 font-sans text-xs">
                        No active PIN keys currently issued.
                      </td>
                    </tr>
                  ) : (
                    activeKeys.map((key) => (
                      <tr key={key.id} className="hover:bg-slate-900/60 bg-slate-950 transition-colors">
                        <td className="py-3 px-4 border-r border-slate-800/80 font-sans">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">{key.holder_name}</span>
                            {key.account_tag && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                                {key.account_tag}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">{key.holder_email}</div>
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap font-semibold text-slate-300">
                          {key.space_name}
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap">
                          {/* Strict Privacy Rule: raw PIN digits are hidden/masked */}
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-750 text-cyan-400 font-bold tracking-widest text-[11px]">
                            • • • • • •
                          </span>
                        </td>

                        <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap text-slate-300 font-medium">
                          {key.valid_till}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleRevokeKey(key.id, key.holder_name)}
                            className="py-1 px-2.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-semibold transition active:scale-95"
                          >
                            Revoke Key
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Secondary Admin Account Management */}
      {activeTab === 'admin_accounts' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                Secondary Administrator Accounts
              </h3>
              <p className="text-xs text-slate-400">
                Staff administration accounts with elevated management privileges • Root Admin strictly protected
              </p>
            </div>

            <button
              onClick={() => setIsAddAdminOpen(true)}
              className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 transition active:scale-95 shadow-md shadow-rose-950/50"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Admin</span>
            </button>
          </div>

          {/* Root Admin Protection Banner */}
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-800/50 flex items-start gap-3 text-xs text-indigo-300">
            <Lock className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-indigo-200">Root Administrator Security Policy:</strong>
              <p className="mt-0.5 text-indigo-300/80">
                The Master Root Administrator account (<code className="text-emerald-300">rehankuriance@gmail.com</code>) is hardcoded into facility database seeds and cannot be modified or deleted. Per system security rules, the Root Administrator is strictly hidden from this manageable list.
              </p>
            </div>
          </div>

          {/* Secondary Admins List */}
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                  <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Admin Full Name</th>
                  <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Email Address</th>
                  <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Established Date</th>
                  <th className="py-3 px-4 font-semibold text-center w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 font-sans text-xs">
                      No secondary administrators established. Master Root Administrator operates facility solely.
                    </td>
                  </tr>
                ) : (
                  admins.map((adm) => (
                    <tr key={adm.id} className="hover:bg-slate-900/60 bg-slate-950 transition-colors">
                      <td className="py-3 px-4 border-r border-slate-800/80 font-sans font-semibold text-slate-200">
                        {adm.name}
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80 text-slate-300">
                        {adm.email}
                      </td>

                      <td className="py-3 px-4 border-r border-slate-800/80 text-slate-400 whitespace-nowrap">
                        {new Date(adm.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDeleteAdmin(adm.id, adm.email)}
                          className="py-1 px-2.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-semibold flex items-center gap-1 mx-auto transition active:scale-95"
                          title="Delete secondary admin"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <AddAdminModal
        isOpen={isAddAdminOpen}
        onClose={() => setIsAddAdminOpen(false)}
        onSubmit={handleCreateAdmin}
      />

      <AddSuperUserModal
        isOpen={isAddSuperUserOpen}
        onClose={() => setIsAddSuperUserOpen(false)}
        onSubmit={handleCreateSuperUser}
      />
    </div>
  );
};
