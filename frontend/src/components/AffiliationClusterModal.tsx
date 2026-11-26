import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import {
  X,
  Users,
  Search,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Home,
  ZoomIn,
  ZoomOut,
  Crown,
  Trash2,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { api } from '../services/api';
import { DirectoryMember } from '../types';
import { useSpace } from '../context/SpaceContext';
import { wsService } from '../services/websocket';
import { copyToClipboard } from '../utils/clipboard';

interface AffiliationClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  onCheckLogs?: (member: DirectoryMember) => void;
  currentUserRole?: 'admin' | 'superuser';
}

interface MemberNodePosition {
  member: DirectoryMember;
  x: number;
  y: number;
  isSuperUser: boolean;
  club: string;
  color: string;
}

interface ClusterPosition {
  club: string;
  cx: number;
  cy: number;
  color: string;
  r: number;
  members: DirectoryMember[];
  superusers: DirectoryMember[];
  students: DirectoryMember[];
  memberNodes: MemberNodePosition[];
  labelY: number;
  countY: number;
}

export const AffiliationClusterModal: React.FC<AffiliationClusterModalProps> = ({
  isOpen,
  onClose,
  showToast,
  onCheckLogs,
  currentUserRole = 'admin',
}) => {
  const { spaces: liveSpaces } = useSpace();
  const REGISTERED_SPACES = useMemo(
    () => Object.fromEntries(liveSpaces.map((sp) => [sp.slug, sp])),
    [liveSpaces]
  );

  const [roster, setRoster] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [spaceFilter, setSpaceFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [selectedSuperUser, setSelectedSuperUser] = useState<DirectoryMember | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<DirectoryMember | null>(null);
  const [hoveredNode, setHoveredNode] = useState<DirectoryMember | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(new Set());

  // Graph Viewport Controls
  const width = 1000;
  const height = 560;
  const DEFAULT_ZOOM = 1.35;
  const DEFAULT_PAN = { x: -175, y: -87.5 };
  const [showUsers, setShowUsers] = useState<boolean>(true); // Strictly toggles regular student user visibility
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>(DEFAULT_PAN);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isWheeling, setIsWheeling] = useState<boolean>(false);

  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wheelTimeoutRef = useRef<any>(null);

  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;
  const panRef = useRef<{ x: number; y: number }>(pan);
  panRef.current = pan;

  useEffect(() => {
    if (!isOpen) return;
    fetchRoster();
    handleResetView();
    const unsub = wsService.subscribe('global', (evt: any) => {
      const evtType = evt?.event_type || evt?.type;
      if (
        evtType === 'USER_DIRECTORY_UPDATED' ||
        evtType === 'FACILITY_SPACE_REMOVED' ||
        evtType === 'FACTORY_RESET' ||
        evtType === 'SPACE_UPDATED'
      ) {
        fetchRoster();
      }
    });
    return () => {
      unsub();
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, [isOpen]);

  // Native non-passive wheel and touch listeners to strictly prevent browser webpage zooming/scrolling
  useEffect(() => {
    if (!isOpen) return;

    const container = graphContainerRef.current;
    if (!container) return;

    const onNativeWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-y-auto')) {
        e.stopPropagation();
        return;
      }

      // Strictly stop browser viewport from zooming in/out or scrolling
      e.preventDefault();
      e.stopPropagation();

      const svgEl = svgRef.current;
      if (!svgEl) return;

      const rect = svgEl.getBoundingClientRect();
      const clientX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const clientY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      // Convert mouse coordinates to SVG viewBox coordinates
      const svgX = (clientX / rect.width) * width;
      const svgY = (clientY / rect.height) * height;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      let zoomFactor: number;
      if (e.ctrlKey) {
        // Trackpad pinch-to-zoom (ctrlKey is true on trackpad pinch in modern browsers)
        zoomFactor = Math.exp(-e.deltaY * 0.01);
      } else {
        // Discrete mouse wheel or two-finger scroll
        zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
      }

      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.4), 4.5);

      // Keep svgX and svgY anchored at the exact pointer position
      const newPanX = svgX - (svgX - currentPan.x) * (newZoom / currentZoom);
      const newPanY = svgY - (svgY - currentPan.y) * (newZoom / currentZoom);

      zoomRef.current = newZoom;
      panRef.current = { x: newPanX, y: newPanY };

      setIsWheeling(true);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => setIsWheeling(false), 120);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    const onNativeTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-y-auto')) {
        return;
      }
      // Stop browser viewport zoom or pull-to-refresh while dragging/pinching on the graph
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    container.addEventListener('wheel', onNativeWheel, { passive: false });
    container.addEventListener('touchmove', onNativeTouchMove, { passive: false });

    return () => {
      container.removeEventListener('wheel', onNativeWheel);
      container.removeEventListener('touchmove', onNativeTouchMove);
    };
  }, [isOpen, width, height]);

  const fetchRoster = async () => {
    try {
      setLoading(true);
      const members = await api.fetchDirectory();

      // People are unique by their email ID: active superuser role takes precedence over user role
      const seenEmails = new Set<string>();
      const deduplicated: DirectoryMember[] = [];
      const sorted = [...(members || [])].sort((a, b) => (a.role === 'superuser' ? -1 : b.role === 'superuser' ? 1 : 0));
      for (const m of sorted) {
        const key = m.email.toLowerCase().trim();
        if (!seenEmails.has(key)) {
          seenEmails.add(key);
          deduplicated.push(m);
        }
      }

      setRoster(deduplicated);
    } catch (err: any) {
      showToast('Failed to load user roster', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPhone = async (phone?: string, id?: string) => {
    if (!phone) return;
    const ok = await copyToClipboard(phone);
    if (id) setCopiedId(id);
    if (ok) {
      showToast('Phone number copied', 'info');
    } else {
      showToast(`Phone: ${phone}`, 'info');
    }
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteMember = async (member: DirectoryMember) => {
    const isSuperUser = member.role === 'superuser';
    const roleLabel = isSuperUser ? 'SuperUser' : 'User';
    if (
      !window.confirm(
        `Are you sure you want to permanently delete ${roleLabel} "${member.name}" (${member.email})?\n\nThis will purge their record and access credentials.`
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
      showToast(`${roleLabel} ${member.name} deleted successfully`, 'success');
      if (selectedSuperUser?.id === member.id) setSelectedSuperUser(null);
      if (selectedStudent?.id === member.id) setSelectedStudent(null);
      await fetchRoster();
    } catch (err: any) {
      showToast(err.message || `Failed to delete ${roleLabel}`, 'error');
    }
  };

  // 1. Group members by club (cluster)
  const clusters = useMemo(() => {
    const map = new Map<string, DirectoryMember[]>();
    roster.forEach((m) => {
      const clubName = m.club_name && m.club_name.trim() ? m.club_name.trim() : 'Unassigned / Student Body';
      if (!map.has(clubName)) {
        map.set(clubName, []);
      }
      map.get(clubName)!.push(m);
    });

    const list = Array.from(map.entries()).map(([club, members]) => ({
      club,
      members,
      superusers: members.filter((m) => m.role === 'superuser'),
      students: members.filter((m) => m.role === 'user'),
    }));

    return list.sort((a, b) => b.members.length - a.members.length);
  }, [roster]);

  // Color generator for clubs
  const getClusterColor = (clubName: string, index: number) => {
    const norm = clubName.toLowerCase();
    if (
      norm.includes('unassigned') ||
      norm.includes('independent') ||
      norm.includes('student body') ||
      norm.includes('none')
    ) {
      return '#64748b'; // Slate neutral
    }
    const colors = [
      '#3b82f6', // Blue
      '#06b6d4', // Cyan
      '#a855f7', // Purple
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ec4899', // Pink
      '#6366f1', // Indigo
      '#14b8a6', // Teal
      '#f97316', // Orange
    ];
    return colors[index % colors.length];
  };

  // Club Name to Color Mapping Dictionary
  const clubColorMap = useMemo(() => {
    const map = new Map<string, string>();
    clusters.forEach((c, idx) => {
      map.set(c.club.toLowerCase().trim(), getClusterColor(c.club, idx));
    });
    return map;
  }, [clusters]);

  const getClubColor = (clubName?: string | null) => {
    if (!clubName || !clubName.trim()) return '#64748b';
    return clubColorMap.get(clubName.toLowerCase().trim()) || '#3b82f6';
  };

  // Canvas Viewport Coordinates
  const centerX = width / 2;
  const centerY = height / 2;

  const totalEntities = useMemo(() => roster.length, [roster]);

  // Dynamic collision radius calculation: expands naturally with member count
  const computeClusterRadius = (memberCount: number) => {
    if (memberCount <= 1) return 34;
    if (memberCount <= 3) return 42;
    if (memberCount <= 6) return 52;
    if (memberCount <= 12) return 66;
    if (memberCount <= 25) return 84;
    if (memberCount <= 50) return 108;
    return Math.min(170, 108 + Math.sqrt(memberCount) * 7);
  };

  // 2. Dynamic Physics-Based Naturally Expanding Layout with D3 Force Simulation
  // Kept tight and snug for small teams; expands naturally outward with member and club count
  const clusterPositions = useMemo<ClusterPosition[]>(() => {
    if (clusters.length === 0) return [];

    const totalClusters = clusters.length;

    // Initial placement: tight, snug, and centered
    const initialSpread = Math.max(50, Math.min(220, 35 + Math.sqrt(totalEntities) * 14 + totalClusters * 10));

    const simNodes = clusters.map((c, i) => {
      const outerR = computeClusterRadius(c.members.length);
      const angle = (i / Math.max(totalClusters, 1)) * 2 * Math.PI - Math.PI / 2;
      return {
        id: c.club,
        club: c.club,
        r: outerR,
        x: centerX + Math.cos(angle) * (totalClusters === 1 ? 0 : initialSpread),
        y: centerY + Math.sin(angle) * (totalClusters === 1 ? 0 : initialSpread * 0.75),
      };
    });

    if (simNodes.length === 1) {
      simNodes[0].x = centerX;
      simNodes[0].y = centerY;
    } else if (simNodes.length > 1) {
      const simulation = d3
        .forceSimulation(simNodes as any)
        .force('center', d3.forceCenter(centerX, centerY))
        .force('x', d3.forceX(centerX).strength(0.09))
        .force('y', d3.forceY(centerY).strength(0.09))
        .force('charge', d3.forceManyBody().strength(-120))
        .force(
          'collide',
          d3.forceCollide<any>((d: any) => d.r + 18).iterations(4)
        )
        .stop();

      // Tick simulation synchronously to reach natural equilibrium
      for (let i = 0; i < 220; ++i) {
        simulation.tick();
      }

      // Re-center bounding centroid
      const avgX = d3.mean(simNodes, (d) => d.x) || centerX;
      const avgY = d3.mean(simNodes, (d) => d.y) || centerY;
      simNodes.forEach((n) => {
        n.x += centerX - avgX;
        n.y += centerY - avgY;
      });
    }

    // Map each cluster to its satellite positions
    return clusters.map((c, i) => {
      const simNode = simNodes[i] || { x: centerX, y: centerY, r: 40 };
      const cx = simNode.x;
      const cy = simNode.y;
      const color = getClusterColor(c.club, i);

      const superusers = c.members.filter((m) => m.role === 'superuser');
      const students = c.members.filter((m) => m.role !== 'superuser');

      const memberNodes: MemberNodePosition[] = [];
      const totalMembers = c.members.length;

      // Natural satellite orbits tailored closely to actual member count
      if (totalMembers <= 2) {
        // Very tight orbit for 1-2 members
        const dist = 32;
        c.members.forEach((m, idx) => {
          const isSu = m.role === 'superuser';
          const angle = -Math.PI / 2 + (idx / Math.max(totalMembers, 1)) * 2 * Math.PI;
          const mx = cx + Math.cos(angle) * dist;
          const my = cy + Math.sin(angle) * dist;
          memberNodes.push({ member: m, x: mx, y: my, isSuperUser: isSu, club: c.club, color });
        });
      } else if (totalMembers <= 5) {
        // Small cluster: superusers at 36px, students at 44px
        superusers.forEach((su, suIdx) => {
          const angle = -Math.PI / 2 + (suIdx / Math.max(superusers.length, 1)) * 2 * Math.PI;
          const mx = cx + Math.cos(angle) * 36;
          const my = cy + Math.sin(angle) * 36;
          memberNodes.push({ member: su, x: mx, y: my, isSuperUser: true, club: c.club, color });
        });
        students.forEach((st, stIdx) => {
          const angle = -Math.PI / 2 + 0.4 + (stIdx / Math.max(students.length, 1)) * 2 * Math.PI;
          const mx = cx + Math.cos(angle) * 44;
          const my = cy + Math.sin(angle) * 44;
          memberNodes.push({ member: st, x: mx, y: my, isSuperUser: false, club: c.club, color });
        });
      } else {
        // Larger clusters expand naturally in concentric shells
        superusers.forEach((su, suIdx) => {
          const suAngle = -Math.PI / 2 + (suIdx / Math.max(superusers.length, 1)) * 2 * Math.PI;
          const mx = cx + Math.cos(suAngle) * 42;
          const my = cy + Math.sin(suAngle) * 42;
          memberNodes.push({ member: su, x: mx, y: my, isSuperUser: true, club: c.club, color });
        });

        const ringCapacities = [8, 14, 20, 26, 32];
        const baseRadius = 58;
        const ringSpacing = 22;

        students.forEach((st, stIdx) => {
          let accumulated = 0;
          let ringIndex = 0;
          let idxInRing = 0;
          let ringCap = ringCapacities[0];

          for (let r = 0; r < ringCapacities.length; r++) {
            const cap = ringCapacities[r];
            if (stIdx < accumulated + cap) {
              ringIndex = r;
              idxInRing = stIdx - accumulated;
              ringCap = cap;
              break;
            }
            accumulated += cap;
            if (r === ringCapacities.length - 1) {
              ringIndex = r + 1;
              idxInRing = stIdx - accumulated;
              ringCap = Math.max(stIdx - accumulated + 1, 30);
            }
          }

          const radius = baseRadius + ringIndex * ringSpacing;
          const ringPhase = -Math.PI / 2 + ringIndex * 0.42;
          const mAngle = ringPhase + (idxInRing / Math.max(ringCap, 1)) * 2 * Math.PI;
          const mx = cx + Math.cos(mAngle) * radius;
          const my = cy + Math.sin(mAngle) * radius;
          memberNodes.push({ member: st, x: mx, y: my, isSuperUser: false, club: c.club, color });
        });
      }

      // Keep club name and member count snug to hub circle
      const labelY = cy + 17;
      const countY = cy + 28;

      return {
        ...c,
        cx,
        cy,
        r: simNode.r,
        color,
        superusers,
        students,
        memberNodes,
        labelY,
        countY,
      };
    });
  }, [clusters, totalEntities, centerX, centerY]);

  // Global lookup dictionary of all member nodes in the graph (keyed by email)
  const nodePositionMap = useMemo(() => {
    const map = new Map<string, MemberNodePosition>();
    clusterPositions.forEach((cp) => {
      cp.memberNodes.forEach((mn) => {
        if (mn.member.id) map.set(mn.member.id, mn);
        if (mn.member.email) map.set(mn.member.email.toLowerCase().trim(), mn);
      });
    });
    return map;
  }, [clusterPositions]);

  // SuperUser-selected linkages:
  // Connects to all students supervised by this lead across ALL facility spaces, plus fellow club members
  const selectedSuData = useMemo(() => {
    if (!selectedSuperUser) return null;
    const suEmail = selectedSuperUser.email.toLowerCase().trim();
    const suNode = nodePositionMap.get(selectedSuperUser.id) || nodePositionMap.get(suEmail);
    if (!suNode) return null;

    const suClub = (selectedSuperUser.club_name || '').trim().toLowerCase();

    // Directly supervised students (across any space)
    const directlySupervisedStudents = roster.filter(
      (m) => m.role === 'user' && m.assigned_superuser_ids?.includes(selectedSuperUser.id)
    );

    // Fellow club students
    const fellowClubStudents = roster.filter(
      (m) =>
        m.role === 'user' &&
        m.club_name &&
        m.club_name.trim().toLowerCase() === suClub &&
        !m.assigned_superuser_ids?.includes(selectedSuperUser.id)
    );

    // Node positions of directly supervised students
    const directSupervisedNodes: Array<{
      node: MemberNodePosition;
      spaces: string[];
    }> = [];

    directlySupervisedStudents.forEach((st) => {
      const np = nodePositionMap.get(st.id) || nodePositionMap.get(st.email.toLowerCase().trim());
      if (np) {
        const matchingSpaces = (st.assigned_superusers || [])
          .filter((as) => as.superuser_id === selectedSuperUser.id)
          .map((as) => REGISTERED_SPACES[as.space_id]?.name || as.space_id);
        directSupervisedNodes.push({
          node: np,
          spaces: matchingSpaces.length > 0 ? matchingSpaces : st.spaces,
        });
      }
    });

    // Node positions of fellow club students
    const fellowClubNodes: MemberNodePosition[] = [];
    fellowClubStudents.forEach((st) => {
      const np = nodePositionMap.get(st.id) || nodePositionMap.get(st.email.toLowerCase().trim());
      if (np) fellowClubNodes.push(np);
    });

    const allAssociatedIds = new Set([
      selectedSuperUser.id,
      suEmail,
      ...directlySupervisedStudents.map((s) => s.id),
      ...directlySupervisedStudents.map((s) => s.email.toLowerCase().trim()),
    ]);

    return {
      suNode,
      directlySupervisedStudents,
      fellowClubStudents,
      directSupervisedNodes,
      fellowClubNodes,
      allAssociatedIds,
    };
  }, [selectedSuperUser, roster, nodePositionMap]);

  // Student-selected linkages:
  // Connects to student's assigned supervising leads across ALL facility spaces + club centroid
  const selectedStudentData = useMemo(() => {
    if (!selectedStudent) return null;
    const stEmail = selectedStudent.email.toLowerCase().trim();
    const studentNode = nodePositionMap.get(selectedStudent.id) || nodePositionMap.get(stEmail);
    if (!studentNode) return null;

    // SuperUsers assigned to this student across facility spaces
    const supervisingLeadLinks: Array<{
      suNode: MemberNodePosition;
      spaceName: string;
      suName: string;
    }> = [];

    (selectedStudent.assigned_superusers || []).forEach((as) => {
      const suNode = nodePositionMap.get(as.superuser_id);
      if (suNode) {
        supervisingLeadLinks.push({
          suNode,
          spaceName: REGISTERED_SPACES[as.space_id]?.name || as.space_id,
          suName: as.superuser_name || suNode.member.name,
        });
      }
    });

    // Associated IDs to keep highlighted
    const highlightedIds = new Set<string>([
      selectedStudent.id,
      stEmail,
      ...supervisingLeadLinks.map((l) => l.suNode.member.id),
      ...supervisingLeadLinks.map((l) => l.suNode.member.email.toLowerCase().trim()),
    ]);

    return {
      studentNode,
      supervisingLeadLinks,
      highlightedIds,
    };
  }, [selectedStudent, nodePositionMap]);

  // Dynamic color theme for selected superuser based on their club
  const suClubColor = useMemo(() => {
    if (!selectedSuperUser) return '#a855f7';
    if (selectedSuData?.suNode?.color) return selectedSuData.suNode.color;
    return getClubColor(selectedSuperUser.club_name);
  }, [selectedSuperUser, selectedSuData, clubColorMap]);

  // Dynamic color theme for selected student based on their club
  const studentClubColor = useMemo(() => {
    if (!selectedStudent) return '#38bdf8';
    if (selectedStudentData?.studentNode?.color) return selectedStudentData.studentNode.color;
    return getClubColor(selectedStudent.club_name);
  }, [selectedStudent, selectedStudentData, clubColorMap]);

  // Filtered members for table
  const filteredRoster = useMemo(() => {
    let list = roster;
    if (selectedSuperUser && selectedSuData) {
      list = [
        selectedSuperUser,
        ...selectedSuData.directlySupervisedStudents,
      ];
    } else if (selectedStudent && selectedStudentData) {
      const seenSuIds = new Set<string>();
      const suMembers: DirectoryMember[] = [];
      for (const l of selectedStudentData.supervisingLeadLinks) {
        if (!seenSuIds.has(l.suNode.member.id)) {
          seenSuIds.add(l.suNode.member.id);
          suMembers.push(l.suNode.member);
        }
      }
      list = [selectedStudent, ...suMembers];
    } else if (selectedClub) {
      list = list.filter(
        (m) =>
          (m.club_name && m.club_name.trim() ? m.club_name.trim() : 'Unassigned / Student Body') ===
          selectedClub
      );
    }
    // Role filter
    if (roleFilter !== 'all') {
      list = list.filter((m) => m.role === roleFilter);
    }
    // Space filter
    if (spaceFilter !== 'all') {
      list = list.filter((m) => m.spaces && m.spaces.includes(spaceFilter));
    }
    // College Year filter
    if (yearFilter !== 'all') {
      list = list.filter((m) => (m.college_year || 'Not Applicable') === yearFilter);
    }
    // Search keyword
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.club_name && m.club_name.toLowerCase().includes(q)) ||
          (m.college_year && m.college_year.toLowerCase().includes(q)) ||
          (m.phone && m.phone.includes(q)) ||
          (m.note && m.note.toLowerCase().includes(q))
      );
    }
    return list;
  }, [
    roster,
    selectedSuperUser,
    selectedSuData,
    selectedStudent,
    selectedStudentData,
    selectedClub,
    roleFilter,
    spaceFilter,
    yearFilter,
    search,
  ]);

  // Centering on Club Selection
  const handleSelectClub = (clubName: string | null) => {
    setSelectedSuperUser(null);
    setSelectedStudent(null);
    if (!clubName || selectedClub === clubName) {
      setSelectedClub(null);
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      return;
    }

    setSelectedClub(clubName);
    const target = clusterPositions.find((c) => c.club === clubName);
    if (target) {
      const targetScale = 1.6;
      const targetX = centerX - target.cx * targetScale;
      const targetY = centerY - target.cy * targetScale;
      setZoom(targetScale);
      setPan({ x: targetX, y: targetY });
    }
  };

  // Auto-position & zoom viewport so selected person and all their connections occupy the viewing space
  const focusOnPoints = (points: Array<{ x: number; y: number }>) => {
    if (!points || points.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = 90;
    const boxW = Math.max(180, maxX - minX + pad * 2);
    const boxH = Math.max(140, maxY - minY + pad * 2);
    const scale = Math.max(0.75, Math.min(2.6, Math.min(width / boxW, height / boxH)));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    setZoom(scale);
    setPan({
      x: width / 2 - midX * scale,
      y: height / 2 - midY * scale,
    });
  };

  useEffect(() => {
    if (selectedSuData?.suNode) {
      const pts: Array<{ x: number; y: number }> = [selectedSuData.suNode];
      selectedSuData.directSupervisedNodes.forEach((n) => pts.push(n.node));
      focusOnPoints(pts);
    } else if (selectedStudentData?.studentNode) {
      const pts: Array<{ x: number; y: number }> = [selectedStudentData.studentNode];
      selectedStudentData.supervisingLeadLinks.forEach((l) => pts.push(l.suNode));
      focusOnPoints(pts);
    }
  }, [selectedSuData, selectedStudentData]);

  // Toggle Selection of a SuperUser
  const handleSelectSuperUser = (su: DirectoryMember) => {
    if (selectedSuperUser?.id === su.id || selectedSuperUser?.email.toLowerCase() === su.email.toLowerCase()) {
      setSelectedSuperUser(null);
    } else {
      setSelectedSuperUser(su);
      setSelectedStudent(null);
      setSelectedClub(null);
    }
  };

  // Toggle Selection of a Student
  const handleSelectStudent = (st: DirectoryMember) => {
    if (selectedStudent?.id === st.id || selectedStudent?.email.toLowerCase() === st.email.toLowerCase()) {
      setSelectedStudent(null);
    } else {
      setSelectedStudent(st);
      setSelectedSuperUser(null);
      setSelectedClub(null);
    }
  };

  // Reset View to Home
  const handleResetView = () => {
    setSelectedClub(null);
    setSelectedSuperUser(null);
    setSelectedStudent(null);
    setSearch('');
    setRoleFilter('all');
    setSpaceFilter('all');
    setYearFilter('all');
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  };

  const mouseStartPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Mouse Drag / Pan
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'circle' || target.tagName === 'text') return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    mouseStartPanRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const panScale = rect && rect.width > 0 && rect.height > 0
      ? Math.max(width / rect.width, height / rect.height) * 1.15
      : 1.15;
    setPan({
      x: mouseStartPanRef.current.x + (e.clientX - dragStart.x) * panScale,
      y: mouseStartPanRef.current.y + (e.clientY - dragStart.y) * panScale,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Drag / Pinch Zoom Refs
  const touchStartPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const touchMidpointSvgRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const getTouchDistance = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    if (e.touches.length === 1) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'circle' || target.tagName === 'text') return;
      const t = e.touches[0];
      setIsDragging(true);
      touchStartPointRef.current = { x: t.clientX, y: t.clientY };
      touchStartPanRef.current = { ...pan };
      touchStartDistRef.current = null;
    } else if (e.touches.length === 2) {
      setIsDragging(true);
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getTouchDistance(t1, t2);
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoom;
      touchStartPanRef.current = { ...pan };

      const midClientX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const midClientY = (t1.clientY + t2.clientY) / 2 - rect.top;
      touchMidpointSvgRef.current = {
        x: (midClientX / rect.width) * width,
        y: (midClientY / rect.height) * height,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    if (e.touches.length === 1 && !touchStartDistRef.current) {
      const t = e.touches[0];
      const rect = svgRef.current.getBoundingClientRect();
      const panScale = rect.width > 0 && rect.height > 0
        ? Math.max(width / rect.width, height / rect.height) * 1.15
        : 1.15;
      const dx = (t.clientX - touchStartPointRef.current.x) * panScale;
      const dy = (t.clientY - touchStartPointRef.current.y) * panScale;
      setPan({
        x: touchStartPanRef.current.x + dx,
        y: touchStartPanRef.current.y + dy,
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getTouchDistance(t1, t2);
      if (dist > 0 && touchStartDistRef.current > 0) {
        const factor = dist / touchStartDistRef.current;
        const newZoom = Math.min(Math.max(touchStartZoomRef.current * factor, 0.4), 4.5);

        const svgMid = touchMidpointSvgRef.current;
        const initZ = touchStartZoomRef.current;
        const initPan = touchStartPanRef.current;

        const newPanX = svgMid.x - (svgMid.x - initPan.x) * (newZoom / initZ);
        const newPanY = svgMid.y - (svgMid.y - initPan.y) * (newZoom / initZ);

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStartPointRef.current = { x: t.clientX, y: t.clientY };
      touchStartPanRef.current = { ...pan };
      touchStartDistRef.current = null;
    } else if (e.touches.length === 0) {
      setIsDragging(false);
      touchStartDistRef.current = null;
    }
  };

  if (!isOpen) return null;

  const activeCardMember = hoveredNode || selectedSuperUser || selectedStudent;

  return (
    <div className="fixed inset-0 !mt-0 bg-slate-950 sm:bg-black/80 z-50 flex flex-col sm:items-center sm:justify-center p-0 sm:p-4 overflow-hidden sm:overflow-y-auto">
      <div className="bg-slate-900 border-0 sm:border sm:border-slate-700/80 rounded-none sm:rounded-2xl max-w-full sm:max-w-5xl w-full h-[100dvh] sm:h-auto sm:max-h-[94dvh] flex flex-col shadow-2xl overflow-hidden sm:my-auto">
        {/* Header (pinned at top) */}
        <div className="px-3 py-2.5 sm:p-4 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
              User Directory &amp; Affiliation Clusters
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchRoster}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition"
              title="Refresh roster"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Visibility Toggles, Home Reset, Zoom Controls (pinned below header) */}
        <div className="bg-slate-950 px-3 sm:px-4 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2">
            {/* Home Reset View Button */}
            <button
              onClick={handleResetView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 transition font-medium"
              title="Reset view and clear selection"
            >
              <Home className="w-3.5 h-3.5 text-indigo-400" />
              <span>Home View</span>
            </button>

            {/* User Satellites Visibility Toggle (Strictly toggles students/users, SuperUsers always visible) */}
            <button
              onClick={() => setShowUsers(!showUsers)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition font-medium ${
                showUsers
                  ? 'bg-indigo-950/80 border-indigo-700 text-indigo-300 hover:bg-indigo-900/60'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
              title={
                showUsers
                  ? 'Hide regular user nodes (SuperUsers always visible)'
                  : 'Show regular user nodes'
              }
            >
              {showUsers ? (
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{showUsers ? 'Users: Visible' : 'Users: Hidden'}</span>
            </button>
          </div>

          {/* Zoom In/Out & Percent Pill */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 hidden sm:inline">
              Scroll wheel / pinch inside graph to zoom · Drag to pan · Scroll outside to browse table
            </span>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 font-mono">
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.25, 0.4))}
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 active:scale-95 transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
              <span className="text-xs sm:text-[10px] text-slate-300 px-1.5 select-none font-semibold">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.25, 4.5))}
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 active:scale-95 transition"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Modal Body for Desktop & Mobile (allows scrolling filters & roster table cleanly) */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 2D SVG Graph Area with Pointer/Touch Zoom & Pan */}
        <div
          ref={graphContainerRef}
          className="bg-slate-950 p-2 sm:p-3 relative select-none overflow-hidden flex justify-center items-center touch-none"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full max-w-[1000px] h-[350px] sm:h-[400px] cursor-grab active:cursor-grabbing touch-none"
            style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <g
              transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
              style={{
                transition: isDragging || isWheeling ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* 1. Centroid connecting background lines within clubs */}
              {clusterPositions.map((cp, idx) => {
                let isClusterDimmed = false;
                if (selectedSuperUser && selectedSuData) {
                  const suClubLabel =
                    selectedSuperUser.club_name && selectedSuperUser.club_name.trim()
                      ? selectedSuperUser.club_name.trim()
                      : 'Unassigned / Student Body';
                  isClusterDimmed = suClubLabel.toLowerCase() !== cp.club.toLowerCase();
                } else if (selectedStudent && selectedStudentData) {
                  const stClubLabel =
                    selectedStudent.club_name && selectedStudent.club_name.trim()
                      ? selectedStudent.club_name.trim()
                      : 'Unassigned / Student Body';
                  isClusterDimmed = stClubLabel.toLowerCase() !== cp.club.toLowerCase();
                } else if (selectedClub) {
                  isClusterDimmed = selectedClub !== cp.club;
                }

                return (
                  <g
                    key={`lines-${idx}`}
                    style={{
                      opacity: isClusterDimmed ? 0.04 : 0.8,
                      transition: 'opacity 0.25s ease',
                    }}
                  >
                    {cp.memberNodes.map((mn, mi) => {
                      const mEmail = mn.member.email.toLowerCase().trim();
                      const isHighlightedBySuperUser =
                        selectedSuData &&
                        (selectedSuData.allAssociatedIds.has(mn.member.id) || selectedSuData.allAssociatedIds.has(mEmail));
                      const isHighlightedByStudent =
                        selectedStudentData &&
                        (selectedStudentData.highlightedIds.has(mn.member.id) || selectedStudentData.highlightedIds.has(mEmail));

                      // Only draw line to regular students if showUsers is true or if associated with selected focus
                      const isVisible =
                        mn.isSuperUser || showUsers || isHighlightedBySuperUser || isHighlightedByStudent;
                      if (!isVisible) return null;

                      return (
                        <line
                          key={`line-${idx}-${mi}`}
                          x1={cp.cx}
                          y1={cp.cy}
                          x2={mn.x}
                          y2={mn.y}
                          stroke={cp.color}
                          strokeOpacity={mn.isSuperUser ? 0.5 : 0.25}
                          strokeWidth={mn.isSuperUser ? 1.5 : 1.0}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* 2. Dynamic SuperUser Multi-Space Supervision & Association Lines */}
              {selectedSuData && (
                <g key="su-multi-space-lines" className="animate-in fade-in duration-300">
                  {/* Lines to directly supervised students across ANY club / space (solid to the color of the selected superuser) */}
                  {selectedSuData.directSupervisedNodes.map((item, di) => {
                    return (
                      <g key={`su-direct-${di}`}>
                        {/* Glow backdrop with solid selected superuser color */}
                        <line
                          x1={selectedSuData.suNode.x}
                          y1={selectedSuData.suNode.y}
                          x2={item.node.x}
                          y2={item.node.y}
                          stroke={suClubColor}
                          strokeWidth="3.5"
                          strokeOpacity="0.4"
                          strokeLinecap="round"
                        />
                        {/* Crisp solid foreground connector matching selected superuser color */}
                        <line
                          x1={selectedSuData.suNode.x}
                          y1={selectedSuData.suNode.y}
                          x2={item.node.x}
                          y2={item.node.y}
                          stroke={suClubColor}
                          strokeWidth="2.2"
                          strokeDasharray="5 3"
                          strokeOpacity="0.95"
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                </g>
              )}

              {/* 3. Dynamic Student Multi-Space Supervising Leads Lines */}
              {selectedStudentData && (
                <g key="student-multi-space-lines" className="animate-in fade-in duration-300">
                  {selectedStudentData.supervisingLeadLinks.map((link, li) => {
                    const suColor = link.suNode.color || getClubColor(link.suNode.member.club_name);
                    const gradId = `st-lead-grad-${li}`;
                    return (
                      <g key={`student-lead-${li}`}>
                        <defs>
                          <linearGradient
                            id={gradId}
                            x1={selectedStudentData.studentNode.x}
                            y1={selectedStudentData.studentNode.y}
                            x2={link.suNode.x}
                            y2={link.suNode.y}
                            gradientUnits="userSpaceOnUse"
                          >
                            <stop offset="0%" stopColor={studentClubColor} />
                            <stop offset="100%" stopColor={suColor} />
                          </linearGradient>
                        </defs>
                        {/* Glow backdrop line */}
                        <line
                          x1={selectedStudentData.studentNode.x}
                          y1={selectedStudentData.studentNode.y}
                          x2={link.suNode.x}
                          y2={link.suNode.y}
                          stroke={`url(#${gradId})`}
                          strokeWidth="3.5"
                          strokeOpacity="0.45"
                          strokeLinecap="round"
                        />
                        {/* Crisp foreground connector */}
                        <line
                          x1={selectedStudentData.studentNode.x}
                          y1={selectedStudentData.studentNode.y}
                          x2={link.suNode.x}
                          y2={link.suNode.y}
                          stroke={`url(#${gradId})`}
                          strokeWidth="2.2"
                          strokeDasharray="5 3"
                          strokeOpacity="0.95"
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                </g>
              )}

              {/* 4. Centroid Nodes (Clubs) */}
              {clusterPositions.map((cp, idx) => {
                let isClusterDimmed = false;
                if (selectedSuperUser && selectedSuData) {
                  const suClub = (selectedSuperUser.club_name || '').trim().toLowerCase();
                  const associatedClubs = new Set([
                    suClub,
                    ...selectedSuData.directlySupervisedStudents.map((s) => (s.club_name || '').trim().toLowerCase()),
                  ]);
                  isClusterDimmed = !associatedClubs.has(cp.club.toLowerCase());
                } else if (selectedStudent && selectedStudentData) {
                  const stClub = (selectedStudent.club_name || '').trim().toLowerCase();
                  const associatedClubs = new Set([
                    stClub,
                    ...selectedStudentData.supervisingLeadLinks.map((l) => (l.suNode.member.club_name || '').trim().toLowerCase()),
                  ]);
                  isClusterDimmed = !associatedClubs.has(cp.club.toLowerCase());
                } else if (selectedClub) {
                  isClusterDimmed = selectedClub !== cp.club;
                }
                const isSelected = selectedClub === cp.club;

                return (
                  <g
                    key={`centroid-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectClub(cp.club);
                    }}
                    className="cursor-pointer"
                    style={{
                      opacity: isClusterDimmed ? 0.08 : 1.0,
                      transition: 'opacity 0.25s ease',
                    }}
                  >
                    {/* Active Selection Pulse Ring (anchored in-place with animate-pulse) */}
                    {isSelected && (
                      <circle
                        cx={cp.cx}
                        cy={cp.cy}
                        r="24"
                        fill="none"
                        stroke={cp.color}
                        strokeWidth="2.5"
                        strokeOpacity="0.8"
                        className="animate-pulse"
                      />
                    )}

                    {/* Centroid Hub Circle */}
                    <circle
                      cx={cp.cx}
                      cy={cp.cy}
                      r="14"
                      fill={cp.color}
                      fillOpacity="0.25"
                      stroke={cp.color}
                      strokeWidth={isSelected ? 3.0 : 1.8}
                    />
                    <circle cx={cp.cx} cy={cp.cy} r="5" fill={cp.color} />

                    {/* Invisible Wide Hit Target (no jumping or oscillation) */}
                    <circle
                      cx={cp.cx}
                      cy={cp.cy}
                      r="22"
                      fill="transparent"
                      className="cursor-pointer"
                    />

                    {/* Centroid Club Label cleanly positioned close to hub circle */}
                    <text
                      x={cp.cx}
                      y={cp.labelY}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10.5"
                      fontWeight="700"
                      className="pointer-events-none drop-shadow-md tracking-tight select-none"
                    >
                      {cp.club}
                    </text>
                    <text
                      x={cp.cx}
                      y={cp.countY}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                      className="pointer-events-none font-mono select-none"
                    >
                      {cp.members.length} member{cp.members.length === 1 ? '' : 's'}
                    </text>
                  </g>
                );
              })}

              {/* 5. Member Satellite Nodes (SuperUsers & Students) */}
              {clusterPositions.map((cp, idx) => {
                return (
                  <g key={`members-${idx}`}>
                    {cp.memberNodes.map((mn, mi) => {
                      const isSu = mn.isSuperUser;
                      const mEmail = mn.member.email.toLowerCase().trim();
                      const isSelectedSu =
                        selectedSuperUser &&
                        (selectedSuperUser.id === mn.member.id ||
                          selectedSuperUser.email.toLowerCase().trim() === mEmail);
                      const isSelectedStudent =
                        selectedStudent &&
                        (selectedStudent.id === mn.member.id ||
                          selectedStudent.email.toLowerCase().trim() === mEmail);

                      // Direct supervision linkages
                      const isSupervisedBySelectedSu =
                        selectedSuData &&
                        selectedSuData.directlySupervisedStudents.some(
                          (s) => s.id === mn.member.id || s.email.toLowerCase().trim() === mEmail
                        );

                      // Supervising lead of selected student
                      const isLeadOfSelectedStudent =
                        selectedStudentData &&
                        selectedStudentData.supervisingLeadLinks.some(
                          (l) =>
                            l.suNode.member.id === mn.member.id ||
                            l.suNode.member.email.toLowerCase().trim() === mEmail
                        );

                      // Visibility: SuperUsers always visible; students visible if showUsers or associated
                      const isVisible =
                        isSu ||
                        showUsers ||
                        isSelectedStudent ||
                        isSupervisedBySelectedSu;
                      if (!isVisible) return null;

                      // Dimming logic
                      let nodeOpacity = 1.0;
                      if (selectedSuperUser && selectedSuData) {
                        if (isSelectedSu || isSupervisedBySelectedSu) {
                          nodeOpacity = 1.0;
                        } else {
                          nodeOpacity = 0.05;
                        }
                      } else if (selectedStudent && selectedStudentData) {
                        if (isSelectedStudent || isLeadOfSelectedStudent) {
                          nodeOpacity = 1.0;
                        } else {
                          nodeOpacity = 0.05;
                        }
                      } else if (selectedClub) {
                        nodeOpacity = selectedClub === cp.club ? 1.0 : 0.16;
                      }

                      const isHovered =
                        hoveredNode &&
                        (hoveredNode.id === mn.member.id ||
                          hoveredNode.email.toLowerCase().trim() === mEmail);

                      return (
                        <g
                          key={`mn-${idx}-${mi}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSu) {
                              handleSelectSuperUser(mn.member);
                            } else {
                              handleSelectStudent(mn.member);
                            }
                          }}
                          onMouseEnter={() => setHoveredNode(mn.member)}
                          onMouseLeave={() => setHoveredNode(null)}
                          className="cursor-pointer"
                          style={{
                            opacity: nodeOpacity,
                            transition: 'opacity 0.25s ease',
                          }}
                        >
                          {/* Selected SuperUser Active Pulse Ring (matches superuser club color) */}
                          {isSelectedSu && (
                            <circle
                              cx={mn.x}
                              cy={mn.y}
                              r="12"
                              fill="none"
                              stroke={suClubColor}
                              strokeWidth="2.5"
                              className="animate-pulse"
                            />
                          )}

                          {/* Selected Student Active Pulse Ring (matches student club color) */}
                          {isSelectedStudent && (
                            <circle
                              cx={mn.x}
                              cy={mn.y}
                              r="10"
                              fill="none"
                              stroke={studentClubColor}
                              strokeWidth="2.5"
                              className="animate-pulse"
                            />
                          )}

                          {/* Directly Supervised Student Focus Ring (strictly matches the student's own club color) */}
                          {isSupervisedBySelectedSu && (
                            <circle
                              cx={mn.x}
                              cy={mn.y}
                              r="8.5"
                              fill="none"
                              stroke={mn.color || cp.color}
                              strokeWidth="1.8"
                              strokeDasharray="3 2"
                            />
                          )}

                          {/* SuperUser Lead Halo Ring */}
                          {isSu && (
                            <circle
                              cx={mn.x}
                              cy={mn.y}
                              r={isSelectedSu ? 10 : 8}
                              fill="none"
                              stroke={isSelectedSu ? suClubColor : isLeadOfSelectedStudent ? studentClubColor : '#ffffff'}
                              strokeWidth={isSelectedSu || isLeadOfSelectedStudent ? 2.2 : 1.5}
                              strokeDasharray={isSelectedSu ? 'none' : '2 2'}
                            />
                          )}

                          {/* Primary Visual Node Circle */}
                          <circle
                            cx={mn.x}
                            cy={mn.y}
                            r={
                              isSelectedSu || isSelectedStudent
                                ? isSu
                                  ? 7.0
                                  : 6.0
                                : isHovered
                                ? isSu
                                  ? 6.5
                                  : 5.0
                                : isSu
                                ? 5.5
                                : 3.8
                            }
                            fill={
                              isSu
                                ? isSelectedSu
                                  ? suClubColor
                                  : isLeadOfSelectedStudent
                                  ? suClubColor
                                  : cp.color
                                : isSelectedStudent
                                ? studentClubColor
                                : isSupervisedBySelectedSu
                                ? (mn.color || cp.color)
                                : cp.color
                            }
                            stroke={isSu ? '#ffffff' : isSupervisedBySelectedSu ? '#ffffff' : '#0f172a'}
                            strokeWidth={isSu ? 1.5 : isSupervisedBySelectedSu ? 1.5 : 1}
                          />

                          {/* 36px Transparent Hit Target for effortless mouse & touch interaction */}
                          <circle
                            cx={mn.x}
                            cy={mn.y}
                            r="18"
                            fill="transparent"
                            className="cursor-pointer"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Integrated Compact Focus & Hover Card */}
          {activeCardMember && (
            <div
              className="absolute bottom-2 left-2 bg-slate-900/95 border rounded-xl p-2 sm:p-2.5 shadow-2xl backdrop-blur max-w-[195px] sm:max-w-[240px] w-full text-[10px] animate-in fade-in duration-150 z-20 pointer-events-auto space-y-1"
              style={{
                borderColor: activeCardMember.role === 'superuser' ? `${suClubColor}88` : `${studentClubColor}88`,
                boxShadow: `0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px -3px ${
                  activeCardMember.role === 'superuser' ? `${suClubColor}33` : `${studentClubColor}33`
                }`,
              }}
            >
              {/* Header: Name, Role Badge, Clear Focus */}
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0 flex-1 flex items-center gap-1">
                  <span className="font-bold text-white text-xs truncate" title={activeCardMember.name}>
                    {activeCardMember.name}
                  </span>
                  <span
                    className={`text-[8px] px-1 py-0.2 rounded uppercase font-bold whitespace-nowrap shrink-0 ${
                      activeCardMember.role === 'superuser'
                        ? 'bg-purple-950 text-purple-300 border border-purple-700/60'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                    }`}
                  >
                    {activeCardMember.role === 'superuser' ? 'SU' : 'User'}
                  </span>
                </div>

                {(selectedSuperUser || selectedStudent) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSuperUser(null);
                      setSelectedStudent(null);
                    }}
                    className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition shrink-0"
                    title="Clear focus"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Email (concatenated/truncated, no label) */}
              <div className="text-[10px] text-slate-400 font-mono truncate" title={activeCardMember.email}>
                {activeCardMember.email}
              </div>

              {/* Club · Year · Phone (compact, no field labels) */}
              <div className="text-[10px] text-slate-300 truncate">
                <span>{activeCardMember.club_name || 'General'}</span>
                <span className="text-slate-600"> · </span>
                <span className="text-slate-400">{activeCardMember.college_year || 'N/A'}</span>
              </div>

              {activeCardMember.phone && (
                <button
                  onClick={() => handleCopyPhone(activeCardMember.phone, activeCardMember.id)}
                  className="text-[10px] text-slate-300 hover:text-indigo-300 font-mono flex items-center gap-1 truncate"
                  title="Click to copy phone"
                >
                  <span>{activeCardMember.phone}</span>
                  {copiedId === activeCardMember.id ? (
                    <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                  )}
                </button>
              )}

              {/* Spaces / Supervising Leads (compact, no verbose labels) */}
              {activeCardMember.role === 'superuser' ? (
                <div className="text-[9px] text-purple-300 truncate pt-0.5 border-t border-slate-800/80">
                  {(activeCardMember.spaces || []).map((s) => REGISTERED_SPACES[s]?.name || s).join(', ') || 'No spaces'}
                </div>
              ) : (
                activeCardMember.assigned_superusers &&
                activeCardMember.assigned_superusers.length > 0 && (
                  <div className="text-[9px] text-indigo-300 truncate pt-0.5 border-t border-slate-800/80">
                    {activeCardMember.assigned_superusers
                      .map((as) => `${REGISTERED_SPACES[as.space_id]?.name || as.space_id}: ${as.superuser_name || 'Lead'}`)
                      .join(' · ')}
                  </div>
                )
              )}

              {/* Compact Action Buttons */}
              <div className="pt-1 border-t border-slate-800/80 flex items-center gap-1.5">
                {onCheckLogs && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCheckLogs(activeCardMember);
                    }}
                    className="flex-1 py-1 px-2 rounded-md bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/40 text-[10px] font-semibold inline-flex items-center justify-center gap-1 transition"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Logs</span>
                  </button>
                )}
                {(currentUserRole === 'admin' || activeCardMember.role !== 'superuser') && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMember(activeCardMember);
                    }}
                    className="py-1 px-2 rounded-md bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-[10px] font-semibold inline-flex items-center justify-center gap-1 transition"
                    title={`Delete ${activeCardMember.role === 'superuser' ? 'SuperUser' : 'User'}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Search & Club/Role/Space/Year Filter Toolbar */}
        <div className="p-2.5 sm:p-3 bg-slate-900 flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-center justify-between border-t border-b border-slate-800 min-w-0">
          <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, email, club, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Club Filter */}
            <select
              value={selectedClub || ''}
              onChange={(e) => handleSelectClub(e.target.value || null)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Affiliation Clusters ({roster.length})</option>
              {clusters.map((c) => (
                <option key={c.club} value={c.club}>
                  {c.club} ({c.members.length})
                </option>
              ))}
            </select>

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Roles</option>
              <option value="superuser">SuperUsers</option>
              <option value="user">Students</option>
            </select>

            {/* Facility Space Filter */}
            <select
              value={spaceFilter}
              onChange={(e) => setSpaceFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Spaces</option>
              {Object.entries(REGISTERED_SPACES).map(([sId, sp]) => (
                <option key={sId} value={sId}>
                  {sp.name}
                </option>
              ))}
            </select>

            {/* College Year Filter */}
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All College Years</option>
              <option value="1st Year">1st Year</option>
              <option value="2nd Year">2nd Year</option>
              <option value="3rd Year">3rd Year</option>
              <option value="4th Year">4th Year</option>
              <option value="Not Applicable">Not Applicable</option>
            </select>

            {(search || selectedClub || roleFilter !== 'all' || spaceFilter !== 'all' || yearFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearch('');
                  setSelectedClub(null);
                  setRoleFilter('all');
                  setSpaceFilter('all');
                  setYearFilter('all');
                }}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded border border-slate-700 transition"
              >
                Clear
              </button>
            )}

            <span className="text-[11px] font-mono text-slate-400 px-2 py-1 bg-slate-950 rounded border border-slate-800">
              {filteredRoster.length} of {roster.length}
            </span>
          </div>
        </div>

        {/* Roster Table */}
        <div className="overflow-x-hidden sm:overflow-x-auto p-2.5 sm:p-4">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px] sticky top-0">
              <tr>
                <th className="py-2 px-2 sm:px-3 whitespace-nowrap">Name</th>
                <th className="py-2 px-2 sm:px-3 whitespace-nowrap">Year</th>
                <th className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">Email</th>
                <th className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">Phone</th>
                <th className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">Club</th>
                <th className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">SuperUsers / Spaces</th>
                <th className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">Role</th>
                <th className="py-2 px-2 sm:px-3 text-right whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredRoster.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                    No directory members match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredRoster.map((m) => {
                const mEmail = m.email.toLowerCase().trim();
                const isSelectedSu =
                  selectedSuperUser &&
                  (selectedSuperUser.id === m.id || selectedSuperUser.email.toLowerCase().trim() === mEmail);
                const isSelectedStudent =
                  selectedStudent &&
                  (selectedStudent.id === m.id || selectedStudent.email.toLowerCase().trim() === mEmail);
                const isSuperUser = m.role === 'superuser';

                const isExpanded = expandedMemberIds.has(m.id);

                return (
                  <React.Fragment key={m.id}>
                    <tr
                      onClick={() => {
                        if (isSuperUser) {
                          handleSelectSuperUser(m);
                        } else {
                          handleSelectStudent(m);
                        }
                      }}
                      className="transition cursor-pointer hover:bg-slate-800/40"
                      style={
                        isSelectedSu
                          ? {
                              backgroundColor: `${suClubColor}1f`,
                              boxShadow: `inset 0 0 0 1px ${suClubColor}77`,
                            }
                          : isSelectedStudent
                          ? {
                              backgroundColor: `${studentClubColor}1f`,
                              boxShadow: `inset 0 0 0 1px ${studentClubColor}77`,
                            }
                          : undefined
                      }
                    >
                    <td className="py-2 px-2 sm:px-3 font-medium text-white">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate max-w-[150px] sm:max-w-none">{m.name}</span>
                        {isSuperUser && (
                          <span title="SuperUser" className="shrink-0">
                            <Crown
                              className="w-3 h-3"
                              style={{
                                color: isSelectedSu
                                  ? suClubColor
                                  : getClubColor(m.club_name),
                              }}
                            />
                          </span>
                        )}
                        {m.account_tag && (
                          <span className="text-[9px] px-1 rounded bg-amber-950/80 text-amber-300 border border-amber-700/50 font-mono whitespace-nowrap shrink-0">
                            {m.account_tag}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 sm:px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-indigo-300 border border-indigo-900/50 whitespace-nowrap">
                        {m.college_year || 'Not Applicable'}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell py-2 px-3 text-slate-400 font-mono text-[11px] max-w-[130px] sm:max-w-[170px] md:max-w-[210px] truncate" title={m.email}>
                      {m.email}
                    </td>
                    <td className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">
                      {m.phone ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPhone(m.phone, m.id);
                          }}
                          className="font-mono text-[11px] text-slate-300 hover:text-indigo-300 flex items-center gap-1"
                        >
                          <span>{m.phone}</span>
                          {copiedId === m.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className="hidden sm:table-cell py-2 px-3 whitespace-nowrap font-medium"
                      style={{ color: getClubColor(m.club_name) }}
                    >
                      {m.club_name || 'General'}
                    </td>
                    <td className="hidden sm:table-cell py-2 px-3">
                      {isSuperUser ? (
                        <div className="flex flex-wrap gap-1">
                          {(m.spaces || []).map((s) => (
                            <span
                              key={s}
                              className="text-[10px] px-1.5 py-0.5 rounded border font-mono whitespace-nowrap"
                              style={{
                                backgroundColor: isSelectedSu ? `${suClubColor}22` : 'rgba(88, 28, 135, 0.6)',
                                borderColor: isSelectedSu ? `${suClubColor}66` : 'rgba(126, 34, 206, 0.5)',
                                color: isSelectedSu ? '#ffffff' : '#d8b4fe',
                              }}
                            >
                              {REGISTERED_SPACES[s]?.name || s}
                            </span>
                          ))}
                        </div>
                      ) : m.assigned_superusers && m.assigned_superusers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.assigned_superusers.map((as, idx) => {
                            const isThisSu = selectedSuperUser && as.superuser_id === selectedSuperUser.id;
                            return (
                              <span
                                key={idx}
                                className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap transition"
                                style={
                                  isThisSu
                                    ? {
                                        backgroundColor: `${suClubColor}22`,
                                        borderColor: `${suClubColor}77`,
                                        color: '#ffffff',
                                      }
                                    : {
                                        backgroundColor: 'rgba(49, 46, 129, 0.6)',
                                        borderColor: 'rgba(67, 56, 202, 0.5)',
                                        color: '#a5b4fc',
                                      }
                                }
                                title={`${REGISTERED_SPACES[as.space_id]?.name || as.space_id}: ${as.superuser_name || 'SuperUser'}`}
                              >
                                <span className="text-slate-400">{REGISTERED_SPACES[as.space_id]?.name || as.space_id}: </span>
                                <strong className="text-white">{as.superuser_name || 'Lead'}</strong>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-slate-600 italic">None</span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell py-2 px-3 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase whitespace-nowrap ${
                          m.role === 'superuser'
                            ? 'bg-purple-950/90 text-purple-300 border border-purple-700/60'
                            : 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/60'
                        }`}
                      >
                        {m.role === 'superuser' ? 'SuperUser' : 'Student'}
                      </span>
                    </td>
                    <td className="py-2 px-2 sm:px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedMemberIds((prev) => {
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
                        {(currentUserRole === 'admin' || m.role !== 'superuser') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMember(m);
                            }}
                            className="hidden sm:inline-flex py-1 px-2.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-[11px] font-semibold items-center gap-1 transition active:scale-95 shadow-sm"
                            title={`Delete ${m.role === 'superuser' ? 'SuperUser' : 'User'} ${m.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-950/90 border-t border-slate-800/80 animate-in fade-in duration-100">
                      <td colSpan={8} className="p-2.5 sm:p-3 text-xs">
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 sm:p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                                m.role === 'superuser'
                                  ? 'bg-purple-950/90 text-purple-300 border border-purple-700/60'
                                  : 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/60'
                              }`}
                            >
                              {m.role === 'superuser' ? 'SuperUser' : 'Student'}
                            </span>
                            <span className="font-mono text-slate-500">Registered: {new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px] text-slate-300">
                            <div className="font-mono truncate" title={m.email}>{m.email}</div>
                            <div style={{ color: getClubColor(m.club_name) }} className="font-medium">
                              {m.club_name || 'Independent'}
                            </div>
                            <div className="font-mono">
                              {m.phone ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyPhone(m.phone, m.id);
                                  }}
                                  className="inline-flex items-center gap-1 hover:text-indigo-300"
                                >
                                  <span>{m.phone}</span>
                                  {copiedId === m.id ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-slate-500" />
                                  )}
                                </button>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {isSuperUser ? (
                              <div className="flex flex-wrap gap-1">
                                {(m.spaces || []).map((s) => (
                                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-purple-700/50 bg-purple-950/60 text-purple-200 font-mono">
                                    {REGISTERED_SPACES[s]?.name || s}
                                  </span>
                                ))}
                              </div>
                            ) : m.assigned_superusers && m.assigned_superusers.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {m.assigned_superusers.map((as, idx) => (
                                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-700/50 bg-indigo-950/60 text-indigo-200">
                                    {REGISTERED_SPACES[as.space_id]?.name || as.space_id}: <strong className="text-white">{as.superuser_name || 'Lead'}</strong>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-600 italic">No assigned spaces</span>
                            )}
                          </div>
                          {m.note && (
                            <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-2 text-xs italic text-indigo-200">
                              "{m.note}"
                            </div>
                          )}
                          {(currentUserRole === 'admin' || m.role !== 'superuser') && (
                            <div className="sm:hidden pt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteMember(m);
                                }}
                                className="py-1 px-2.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-[11px] font-semibold inline-flex items-center gap-1 transition"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
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
      </div>
    </div>
  );
};

export default AffiliationClusterModal;
