import React, { useState, useMemo } from 'react';
import { DirectoryMember } from '../types';
import { useSpace } from '../context/SpaceContext';
import { CopyButton } from './CopyButton';
import { api } from '../services/api';
import {
  Users,
  Search,
  ArrowUpDown,
  Trash2,
  ChevronDown,
} from 'lucide-react';

interface UserDirectoryProps {
  members: DirectoryMember[];
  loading?: boolean;
  onMemberDeleted?: () => void;
}

type SortField = 'name' | 'role' | 'club_name' | 'created_at';
type SortOrder = 'asc' | 'desc';

export const UserDirectory: React.FC<UserDirectoryProps> = ({
  members,
  loading = false,
  onMemberDeleted,
}) => {
  const { spaces } = useSpace();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedClub, setSelectedClub] = useState<string>('all');
  const [selectedSpace, setSelectedSpace] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleDeleteMember = async (member: DirectoryMember) => {
    const isSuperUser = member.role === 'superuser';
    const roleLabel = isSuperUser ? 'SuperUser' : 'User';
    if (
      !window.confirm(
        `Are you sure you want to delete ${roleLabel} "${member.name}" (${member.email})?\n\nThis will permanently purge their record and access credentials.`
      )
    ) {
      return;
    }

    try {
      if (isSuperUser) {
        await api.deleteAdminSuperuser(member.id);
      } else {
        await api.deleteAdminUser(member.id);
      }
      onMemberDeleted?.();
    } catch (err: any) {
      alert(err.message || `Failed to delete ${roleLabel}`);
    }
  };

  // Unique clubs list from members
  const clubsList = useMemo(() => {
    const set = new Set<string>();
    members.forEach((m) => {
      if (m.club_name) set.add(m.club_name);
    });
    return Array.from(set).sort();
  }, [members]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredMembers = useMemo(() => {
    return members
      .filter((m) => {
        // Exclude revoked accounts
        if (m.is_active === false) return false;

        // Role filter
        if (selectedRole !== 'all' && m.role !== selectedRole) return false;

        // Club filter
        if (selectedClub !== 'all' && m.club_name !== selectedClub) return false;

        // Space filter
        if (selectedSpace !== 'all' && !m.spaces.includes(selectedSpace)) return false;

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = m.name.toLowerCase().includes(q);
          const matchEmail = m.email.toLowerCase().includes(q);
          const matchPhone = m.phone.toLowerCase().includes(q);
          const matchClub = m.club_name?.toLowerCase().includes(q);
          const matchNote = m.note?.toLowerCase().includes(q);
          return matchName || matchEmail || matchPhone || matchClub || matchNote;
        }

        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortField] || '';
        let valB: any = b[sortField] || '';

        if (sortField === 'created_at') {
          valA = new Date(valA).getTime();
          valB = new Date(valB).getTime();
        } else {
          valA = String(valA).toLowerCase();
          valB = String(valB).toLowerCase();
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [members, selectedRole, selectedClub, selectedSpace, searchQuery, sortField, sortOrder]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            Sortable Facility Member Directory
          </h2>
          <p className="text-xs text-slate-400">
            Registered students and authorized SuperUsers • Filterable by Club and Facility Space • Admins excluded
          </p>
        </div>

        <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 self-start sm:self-auto">
          Showing <span className="text-emerald-400 font-bold">{filteredMembers.length}</span> of {members.length} members
        </div>
      </div>

      {/* Filter Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
        {/* Search */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Search</label>
          <div className="relative">
            <input
              type="text"
              placeholder="Search name, phone, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-750 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>

        {/* Club Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Club Affiliation</label>
          <select
            value={selectedClub}
            onChange={(e) => setSelectedClub(e.target.value)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="all">All Clubs</option>
            {clubsList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Space Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Facility Space</label>
          <select
            value={selectedSpace}
            onChange={(e) => setSelectedSpace(e.target.value)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="all">All Spaces</option>
            {spaces.map((sp) => (
              <option key={sp.slug} value={sp.slug}>
                {sp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Role Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Role</label>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="all">All Roles</option>
            <option value="superuser">SuperUsers</option>
            <option value="user">Entrant Users</option>
          </select>
        </div>
      </div>

      {/* Directory Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-900/90 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
              <th
                onClick={() => toggleSort('name')}
                className="py-3 px-4 font-semibold border-r border-slate-800/80 cursor-pointer hover:text-white transition"
              >
                <div className="flex items-center gap-1.5">
                  <span>Member Name</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th
                onClick={() => toggleSort('role')}
                className="py-3 px-4 font-semibold border-r border-slate-800/80 w-32 cursor-pointer hover:text-white transition"
              >
                <div className="flex items-center gap-1.5">
                  <span>Role</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th
                onClick={() => toggleSort('club_name')}
                className="py-3 px-4 font-semibold border-r border-slate-800/80 cursor-pointer hover:text-white transition"
              >
                <div className="flex items-center gap-1.5">
                  <span>Club</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Contact Phone</th>
              <th className="py-3 px-4 font-semibold border-r border-slate-800/80">Spaces</th>

              <th
                onClick={() => toggleSort('created_at')}
                className="py-3 px-4 font-semibold border-r border-slate-800/80 cursor-pointer hover:text-white transition w-36"
              >
                <div className="flex items-center gap-1.5">
                  <span>Cohort Date</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th className="py-3 px-4 font-semibold text-center w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500 text-xs font-sans">
                  Loading member directory...
                </td>
              </tr>
            ) : filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500 text-xs font-sans">
                  No directory records match your filter criteria.
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => {
                const isSuperUser = m.role === 'superuser';
                const isExpanded = expandedIds.has(m.id);
                return (
                  <React.Fragment key={m.id}>
                    <tr className="hover:bg-slate-900/60 bg-slate-950 transition-colors">
                      {/* Name & Email */}
                      <td className="py-3 px-4 border-r border-slate-800/80 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">{m.name}</span>
                          {/* July 15 - Sept 1 Tag if present */}
                          {m.account_tag && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono uppercase ${
                                m.account_tag === 'New'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {m.account_tag}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">{m.email}</div>
                      </td>

                      {/* Role & Status */}
                      <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isSuperUser
                              ? m.is_active
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {isSuperUser ? (
                            m.is_active ? (
                              'SuperUser'
                            ) : (
                              'Revoked SuperUser'
                            )
                          ) : (
                            'Entrant'
                          )}
                        </span>
                      </td>

                      {/* Club */}
                      <td className="py-3 px-4 border-r border-slate-800/80 font-sans">
                        <span className="text-slate-300 font-medium">
                          {m.club_name || <span className="text-slate-600 italic">Independent</span>}
                        </span>
                      </td>

                      {/* Phone with copy button */}
                      <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-300 font-mono text-[11px]">{m.phone}</span>
                          <CopyButton textToCopy={m.phone} />
                        </div>
                      </td>

                      {/* Spaces */}
                      <td className="py-3 px-4 border-r border-slate-800/80">
                        <div className="flex flex-wrap gap-1">
                          {m.spaces.length === 0 ? (
                            <span className="text-slate-600 text-[11px] italic font-sans">None</span>
                          ) : (
                            m.spaces.map((sp) => (
                              <span
                                key={sp}
                                className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-750 text-slate-300 text-[10px] font-mono"
                              >
                                {sp}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3 px-4 border-r border-slate-800/80 whitespace-nowrap text-slate-400 text-[11px]">
                        {new Date(m.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.id)) next.delete(m.id);
                                else next.add(m.id);
                                return next;
                              });
                            }}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            title={isExpanded ? 'Collapse details' : 'Expand full details & note'}
                          >
                            <ChevronDown
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-white' : ''}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMember(m)}
                            className="py-1 px-2.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-semibold inline-flex items-center gap-1 transition active:scale-95"
                            title={`Delete ${isSuperUser ? 'SuperUser' : 'User'} ${m.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-950/90 border-t border-slate-800/80 animate-in fade-in duration-100">
                        <td colSpan={7} className="p-3 text-xs">
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                              <span>{isSuperUser ? 'SuperUser Profile Details' : 'Student Entrant Details'}</span>
                              <span className="font-mono text-slate-500">ID: {m.id}</span>
                            </div>
                            <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-2.5">
                              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-0.5">Note:</div>
                              <div className="text-xs italic text-indigo-200">
                                {m.note ? `"${m.note}"` : <span className="text-slate-500 not-italic">No note or representative title declared.</span>}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 pt-1">
                              <div><span className="text-slate-500 font-medium">College Year:</span> <span className="text-slate-200">{m.college_year || 'Not Applicable'}</span></div>
                              <div><span className="text-slate-500 font-medium">Club:</span> <span className="text-slate-200">{m.club_name || 'Independent'}</span></div>
                              <div><span className="text-slate-500 font-medium">Phone:</span> <span className="text-slate-200 font-mono">{m.phone}</span></div>
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
    </div>
  );
};
