import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { ClusterGraphData, ClusterGraphNode, ClusterGraphLink } from '../types';
import { CopyButton } from './CopyButton';
import {
  Info,
  Sparkles,
} from 'lucide-react';

interface InteractiveClusterGraphProps {
  data: ClusterGraphData;
  loading?: boolean;
}

// Vibrant palette for club clusters
const CLUSTER_COLORS = [
  '#06b6d4', // cyan-500
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#3b82f6', // blue-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
];

export const InteractiveClusterGraph: React.FC<InteractiveClusterGraphProps> = ({
  data,
  loading = false,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [selectedNode, setSelectedNode] = useState<ClusterGraphNode | null>(null);

  // Map each club to a distinct color
  const clubColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    data.nodes.forEach((n) => {
      if (n.role === 'club' && !map.has(n.name)) {
        map.set(n.name, CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length]);
        colorIdx++;
      }
    });
    return map;
  }, [data.nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.nodes.length === 0) return;

    const width = containerRef.current.clientWidth || 900;
    const height = 550;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous render

    svg
      .attr('viewBox', [0, 0, width, height])
      .attr('width', '100% them')
      .attr('height', height)
      .style('background', '#0b1329');

    // Root group for zooming
    const g = svg.append('g').attr('class', 'graph-root');

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Deep copy nodes and links for D3 mutation
    const nodes: ClusterGraphNode[] = data.nodes.map((d) => ({ ...d }));
    const links: ClusterGraphLink[] = data.links.map((d) => ({ ...d }));

    // Group centroids positions map for cluster attraction
    const clubNodes = nodes.filter((n) => n.role === 'club');
    const clubCount = clubNodes.length || 1;
    const radius = Math.min(width, height) * 0.35;

    // Distribute clubs evenly in a circle initially
    clubNodes.forEach((club, i) => {
      const angle = (i / clubCount) * 2 * Math.PI;
      club.x = width / 2 + radius * Math.cos(angle);
      club.y = height / 2 + radius * Math.sin(angle);
    });

    // Create D3 Force Simulation
    const simulation = d3
      .forceSimulation<ClusterGraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<ClusterGraphNode, ClusterGraphLink>(links)
          .id((d) => d.id)
          .distance((d) => (d.relation === 'leads' ? 60 : 85))
          .strength(0.7)
      )
      .force('charge', d3.forceManyBody<ClusterGraphNode>().strength((d) => (d.role === 'club' ? -400 : -120)))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.08))
      .force(
        'collide',
        d3.forceCollide<ClusterGraphNode>().radius((d) => (d.role === 'club' ? 45 : d.role === 'superuser' ? 26 : 18)).strength(0.9)
      );

    // Render Links
    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => (d.relation === 'leads' ? '#38bdf8' : '#334155'))
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => (d.relation === 'leads' ? 2 : 1))
      .attr('stroke-dasharray', (d) => (d.relation === 'leads' ? 'none' : '2,2'));

    // Render Nodes Group
    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, ClusterGraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, ClusterGraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    node.each(function (d) {
      const el = d3.select(this);
      const clubColor = clubColorMap.get(d.club_name || d.name) || '#06b6d4';

      if (d.role === 'club') {
        // Club Centroid (Cluster center)
        el.append('circle')
          .attr('r', 32)
          .attr('fill', clubColor)
          .attr('fill-opacity', 0.2)
          .attr('stroke', clubColor)
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '4,2');

        el.append('circle')
          .attr('r', 22)
          .attr('fill', '#0f172a')
          .attr('stroke', clubColor)
          .attr('stroke-width', 2);

        // Member count text
        el.append('text')
          .text(d.member_count ?? '')
          .attr('text-anchor', 'middle')
          .attr('dy', '.3em')
          .attr('fill', clubColor)
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .attr('font-family', 'ui-monospace, monospace');
      } else if (d.role === 'superuser') {
        // SuperUser Lead
        el.append('circle')
          .attr('r', 18)
          .attr('fill', '#1e1b4b')
          .attr('stroke', '#6366f1')
          .attr('stroke-width', 2.5);

        // Inner glowing star/indicator
        el.append('circle')
          .attr('r', 8)
          .attr('fill', '#a855f7');
      } else {
        // Standard User Entrant
        el.append('circle')
          .attr('r', 10)
          .attr('fill', '#0f172a')
          .attr('stroke', clubColor)
          .attr('stroke-width', 1.5);
      }
    });

    // Node labels
    node
      .append('text')
      .text((d) => (d.role === 'club' ? d.name : d.name.split(' ')[0]))
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => (d.role === 'club' ? 46 : 24))
      .attr('fill', (d) => (d.role === 'club' ? '#f8fafc' : '#cbd5e1'))
      .attr('font-size', (d) => (d.role === 'club' ? '12px' : '9px'))
      .attr('font-weight', (d) => (d.role === 'club' ? 'bold' : 'normal'))
      .style('pointer-events', 'none')
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)');

    // Node Click interaction
    node.on('click', (_, d) => {
      setSelectedNode(d);
    });

    // Simulation Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, clubColorMap]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Campus Affiliation Cluster Graph
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Force-directed clustering by Club affiliation • Highlighting SuperUsers &amp; Student Members • Admins strictly excluded
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono bg-slate-950/80 px-4 py-2 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-cyan-400 border-dashed bg-cyan-950/60 inline-block" />
            <span className="text-slate-300">Club Centroid</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-indigo-600 border border-indigo-400 inline-block shadow-sm" />
            <span className="text-slate-300">SuperUser</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-emerald-400 inline-block" />
            <span className="text-slate-300">Student Entrant</span>
          </div>
        </div>
      </div>

      {/* Main Canvas + Detail Drawer layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* SVG Canvas Area */}
        <div
          ref={containerRef}
          className="lg:col-span-3 relative w-full h-[550px] rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-inner"
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">
              Simulating physics cluster nodes...
            </div>
          ) : (
            <svg ref={svgRef} className="w-full h-full" />
          )}

          {/* Quick Helper Floating Overlay */}
          <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl text-[10px] text-slate-400 font-mono pointer-events-none backdrop-blur-sm">
            Drag nodes • Scroll to Zoom • Click node for details
          </div>
        </div>

        {/* Detail Panel for Selected Node */}
        <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-cyan-400" />
                Cluster Node Details
              </span>
              {selectedNode && (
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-[11px] text-slate-500 hover:text-slate-300 font-mono"
                >
                  Clear
                </button>
              )}
            </div>

            {selectedNode ? (
              <div className="space-y-4">
                <div>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      selectedNode.role === 'club'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                        : selectedNode.role === 'superuser'
                        ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    }`}
                  >
                    {selectedNode.role === 'club'
                      ? 'Club Cluster Centroid'
                      : selectedNode.role === 'superuser'
                      ? 'SuperUser'
                      : 'Student Entrant'}
                  </span>
                  <h3 className="text-base font-bold text-white mt-1.5">{selectedNode.name}</h3>
                </div>

                {selectedNode.club_name && (
                  <div className="text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">
                      Club Affiliation:
                    </span>
                    <span className="text-slate-200 font-semibold">{selectedNode.club_name}</span>
                  </div>
                )}

                {selectedNode.email && (
                  <div className="text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Email:</span>
                    <span className="text-slate-300 font-mono break-all">{selectedNode.email}</span>
                  </div>
                )}

                {selectedNode.phone && (
                  <div className="text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-bold">Phone:</span>
                      <span className="text-slate-300 font-mono">{selectedNode.phone}</span>
                    </div>
                    <CopyButton textToCopy={selectedNode.phone} label="Copy" />
                  </div>
                )}

                {selectedNode.spaces && selectedNode.spaces.length > 0 && (
                  <div className="text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">
                      {selectedNode.role === 'superuser' ? 'Governed Spaces:' : 'Registered Spaces:'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {selectedNode.spaces.map((sp) => (
                        <span
                          key={sp}
                          className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700"
                        >
                          {sp}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.role === 'club' && (
                  <div className="text-xs bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-center">
                    <div className="text-2xl font-black text-cyan-400 font-mono">
                      {selectedNode.member_count ?? 0}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Total Connected Members</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16 text-slate-500 text-xs">
                Click on any node in the cluster graph to inspect details.
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-500 font-mono border-t border-slate-800/80 pt-3 mt-4">
            Security Guarantee: Administrators strictly isolated from student cluster graphs.
          </div>
        </div>
      </div>
    </div>
  );
};
