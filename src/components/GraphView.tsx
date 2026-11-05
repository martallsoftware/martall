import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TagGraph } from "../types";

interface Props {
  onSelectNote: (path: string) => void;
  darkMode: boolean;
}

interface Node {
  id: string;
  label: string;
  type: "tag" | "note";
  x: number;
  y: number;
  vx: number;
  vy: number;
  path?: string;
}

interface Edge {
  source: number;
  target: number;
}

const LAYOUT_KEY = "martall_graph_layout";

interface SavedLayout {
  positions: Record<string, [number, number]>;
  viewBox: { x: number; y: number; w: number; h: number };
}

function saveLayout(nodes: Node[], viewBox: { x: number; y: number; w: number; h: number }) {
  const positions: Record<string, [number, number]> = {};
  nodes.forEach((n) => { positions[n.id] = [n.x, n.y]; });
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ positions, viewBox }));
}

function loadLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function runForceLayout(nodes: Node[], edges: Edge[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;

  const tagNodes = nodes.filter((n) => n.type === "tag");
  const noteNodes = nodes.filter((n) => n.type === "note");
  const tagRadius = Math.min(width, height) * 0.35;

  tagNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / tagNodes.length;
    node.x = cx + tagRadius * Math.cos(angle);
    node.y = cy + tagRadius * Math.sin(angle);
  });

  noteNodes.forEach((node) => {
    const connected = edges.filter(
      (e) => nodes[e.target]?.id === node.id || nodes[e.source]?.id === node.id,
    );
    if (connected.length > 0) {
      let sx = 0, sy = 0;
      connected.forEach((e) => {
        const other = nodes[e.source]?.id === node.id ? nodes[e.target] : nodes[e.source];
        sx += other.x;
        sy += other.y;
      });
      node.x = sx / connected.length + (Math.random() - 0.5) * 60;
      node.y = sy / connected.length + (Math.random() - 0.5) * 60;
    } else {
      node.x = cx + (Math.random() - 0.5) * width * 0.5;
      node.y = cy + (Math.random() - 0.5) * height * 0.5;
    }
  });

  for (let iter = 0; iter < 150; iter++) {
    const alpha = 1 - iter / 150;
    const repulsion = 1500 * alpha;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    const springStrength = 0.04 * alpha;
    const idealLength = 120;
    edges.forEach((e) => {
      const a = nodes[e.source];
      const b = nodes[e.target];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLength) * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    const gravity = 0.02 * alpha;
    nodes.forEach((node) => {
      node.vx += (cx - node.x) * gravity;
      node.vy += (cy - node.y) * gravity;
    });

    nodes.forEach((node) => {
      node.x += node.vx * 0.5;
      node.y += node.vy * 0.5;
      node.vx *= 0.8;
      node.vy *= 0.8;
    });
  }
}

interface PreviewState {
  path: string;
  title: string;
  content: string;
  screenX: number;
  screenY: number;
}

export default function GraphView({ onSelectNote, darkMode }: Props) {
  const [graph, setGraph] = useState<TagGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 });
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragRef = useRef<{
    type: "pan" | "node";
    nodeId?: string;
    startX: number;
    startY: number;
    vbX: number;
    vbY: number;
    moved: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<TagGraph>("get_tag_graph");
      setGraph(data);
    } catch (err) {
      console.error("Failed to get tag graph:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Build nodes/edges when graph data changes
  useEffect(() => {
    if (!graph) return;

    const n: Node[] = [];
    const e: Edge[] = [];

    graph.tags.forEach((tag, i) => {
      n.push({ id: `tag-${i}`, label: `#${tag}`, type: "tag", x: 0, y: 0, vx: 0, vy: 0 });
    });

    graph.notes.forEach((note, i) => {
      n.push({ id: `note-${i}`, label: note.title, type: "note", x: 0, y: 0, vx: 0, vy: 0, path: note.path });
    });

    graph.edges.forEach((edge) => {
      e.push({ source: edge.tag_index, target: graph.tags.length + edge.note_index });
    });

    // Try to restore saved positions
    const saved = loadLayout();
    let restored = false;

    if (saved?.positions) {
      for (const node of n) {
        const pos = saved.positions[node.id];
        if (pos) {
          node.x = pos[0];
          node.y = pos[1];
          restored = true;
        }
      }
    }

    if (!restored) {
      runForceLayout(n, e, 1200, 900);
    }

    setNodes(n);
    setEdges(e);

    if (saved?.viewBox && restored) {
      setViewBox(saved.viewBox);
    } else {
      const padding = 80;
      const minX = Math.min(...n.map((nd) => nd.x)) - padding;
      const minY = Math.min(...n.map((nd) => nd.y)) - padding;
      const maxX = Math.max(...n.map((nd) => nd.x)) + padding;
      const maxY = Math.max(...n.map((nd) => nd.y)) + padding;
      setViewBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }
  }, [graph]);

  // Keep refs for saving from wheel handler
  const nodesRef = useRef(nodes);
  const viewBoxRef = useRef(viewBox);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { viewBoxRef.current = viewBox; }, [viewBox]);

  // Bounding box of all nodes (with padding) — used for fit-to-view, zoom limits and the minimap.
  const bounds = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 };
    const pad = 80;
    const minX = Math.min(...nodes.map((n) => n.x)) - pad;
    const minY = Math.min(...nodes.map((n) => n.y)) - pad;
    const maxX = Math.max(...nodes.map((n) => n.x)) + pad;
    const maxY = Math.max(...nodes.map((n) => n.y)) + pad;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [nodes]);
  const boundsRef = useRef(bounds);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSave = useCallback((vb: { x: number; y: number; w: number; h: number }) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveLayout(nodesRef.current, vb), 300);
  }, []);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  /** Zoom by `factor` (<1 = in) keeping the SVG point (px, py) fixed; defaults to the view centre. */
  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    setViewBox((v) => {
      const b = boundsRef.current;
      const maxW = Math.max(b.w, b.h * (v.w / v.h)) * 4;
      const nw = Math.min(Math.max(v.w * factor, 60), maxW);
      const f = nw / v.w;
      const cx = px ?? v.x + v.w / 2;
      const cy = py ?? v.y + v.h / 2;
      const newVb = { x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w: nw, h: v.h * f };
      scheduleSave(newVb);
      return newVb;
    });
  }, [scheduleSave]);

  // Scroll-wheel / trackpad-pinch zoom towards the cursor.
  // Depends on hasNodes: the <svg> only exists once the graph has loaded.
  const hasNodes = nodes.length > 0;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const vb = viewBoxRef.current;
      const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
      const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(delta * (e.ctrlKey ? 0.01 : 0.002)), px, py);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [hasNodes, zoomBy]);

  // screenToSvg using ref to avoid stale closures
  const screenToSvgRef = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const vb = viewBoxRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
        y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Only pan — node clicks are handled by the <g> onMouseDown with stopPropagation
      setPreview(null);
      const vb = viewBoxRef.current;
      dragRef.current = {
        type: "pan",
        startX: e.clientX,
        startY: e.clientY,
        vbX: vb.x,
        vbY: vb.y,
        moved: false,
      };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current || !svgRef.current) return;

      // Only count as moved if mouse traveled more than 4px
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (!dragRef.current.moved && dx * dx + dy * dy < 16) return;

      dragRef.current.moved = true;

      if (dragRef.current.type === "node" && dragRef.current.nodeId) {
        // Drag the node
        const svgPos = screenToSvgRef(e.clientX, e.clientY);
        setNodes((prev) =>
          prev.map((n) =>
            n.id === dragRef.current!.nodeId
              ? { ...n, x: svgPos.x - dragRef.current!.vbX, y: svgPos.y - dragRef.current!.vbY }
              : n,
          ),
        );
      } else {
        // Pan
        const rect = svgRef.current.getBoundingClientRect();
        const vb = viewBoxRef.current;
        const scaleX = vb.w / rect.width;
        const scaleY = vb.h / rect.height;
        const dx = (e.clientX - dragRef.current.startX) * scaleX;
        const dy = (e.clientY - dragRef.current.startY) * scaleY;
        setViewBox((v) => ({ ...v, x: dragRef.current!.vbX - dx, y: dragRef.current!.vbY - dy }));
      }
    },
    [screenToSvgRef],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current?.type === "node" && !dragRef.current.moved && dragRef.current.nodeId) {
        const node = nodes.find((n) => n.id === dragRef.current!.nodeId);
        if (node?.type === "note" && node.path) {
          // Show preview instead of opening immediately
          invoke<{ content: string }>("read_note", { path: node.path })
            .then((result) => {
              setPreview({
                path: node.path!,
                title: node.label,
                content: result.content,
                screenX: e.clientX,
                screenY: e.clientY,
              });
            })
            .catch(() => {});
        } else if (node?.type === "tag") {
          // Close preview when clicking a tag
          setPreview(null);
        }
      }
      if (dragRef.current?.moved) {
        saveLayout(nodes, viewBox);
      }
      dragRef.current = null;
    },
    [nodes, viewBox],
  );

  const zoomIn = useCallback(() => zoomBy(0.8), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1.25), [zoomBy]);

  /** Fit all nodes into the view, keeping the screen's aspect ratio. */
  const fitView = useCallback(() => {
    const svg = svgRef.current;
    const b = boundsRef.current;
    const rect = svg?.getBoundingClientRect();
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : b.w / b.h;
    let w = b.w, h = b.h;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    const newVb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
    setViewBox(newVb);
    saveLayout(nodesRef.current, newVb);
  }, []);

  const [showMinimap, setShowMinimap] = useState(() => {
    try { return localStorage.getItem("martall_graph_minimap") !== "0"; } catch { return true; }
  });
  const toggleMinimap = () => {
    setShowMinimap((v) => {
      try { localStorage.setItem("martall_graph_minimap", v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };

  const tagColor = "#22C55E";
  const noteColor = darkMode ? "#8B8B9E" : "#6B7280";
  const lineColor = darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  const isDraggingNode = dragRef.current?.type === "node";

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading graph...
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
        <svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-40">
          <circle cx="6" cy="6" r="3" />
          <circle cx="14" cy="6" r="3" />
          <circle cx="10" cy="14" r="3" />
          <path d="M8.5 7.5l2 4M11.5 7.5l-2 4" />
        </svg>
        <span>No tags yet. Add #tags to your notes.</span>
      </div>
    );
  }

  // Render simple markdown preview
  const renderPreviewContent = (content: string) => {
    const lines = content.split("\n").slice(0, 30); // First 30 lines
    return lines.map((line, i) => {
      const t = line.trimStart();
      if (t.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-2">{t.slice(4)}</h3>;
      if (t.startsWith("## ")) return <h2 key={i} className="text-base font-semibold mt-2">{t.slice(3)}</h2>;
      if (t.startsWith("# ")) return <h1 key={i} className="text-lg font-bold mt-2">{t.slice(2)}</h1>;
      if (t.startsWith("- [x] ") || t.startsWith("- [X] "))
        return <p key={i} className="text-xs text-green-400 ml-2">{"\u2611 " + t.slice(6)}</p>;
      if (t.startsWith("- [ ] "))
        return <p key={i} className="text-xs text-gray-400 ml-2">{"\u2610 " + t.slice(6)}</p>;
      if (t.startsWith("- "))
        return <p key={i} className="text-xs ml-2">{"\u2022 " + t.slice(2)}</p>;
      if (t.startsWith("> "))
        return <p key={i} className="text-xs italic text-green-400/70 border-l-2 border-green-500 pl-2 ml-1">{t.slice(2)}</p>;
      if (t.startsWith("```")) return null;
      if (t === "") return <br key={i} />;
      // Highlight #tags
      const parts = t.split(/(#\p{L}[\p{L}\p{N}_/-]*)/gu);
      return (
        <p key={i} className="text-xs">
          {parts.map((part, j) =>
            /^#\p{L}/u.test(part) ? (
              <span key={j} className="text-green-400 font-medium">{part}</span>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      );
    });
  };

  return (
    <div ref={containerRef} className="w-full h-full relative" onClick={(e) => {
      // Close preview when clicking outside
      if (preview && e.target === e.currentTarget) setPreview(null);
    }}>
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        <button onClick={zoomIn} className="p-2 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" title="Zoom in">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 5v10M5 10h10" /></svg>
        </button>
        <button onClick={zoomOut} className="p-2 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" title="Zoom out">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 10h10" /></svg>
        </button>
        <button onClick={fitView} className="p-2 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" title="Fit all nodes">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>
        </button>
        <button onClick={toggleMinimap} className={`p-2 rounded-lg transition-colors ${showMinimap ? "bg-accent/20 text-accent" : "bg-gray-200/80 dark:bg-gray-700/80"} hover:bg-gray-300 dark:hover:bg-gray-600`} title="Toggle overview map">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><rect x="10" y="10" width="5" height="4" /></svg>
        </button>
        <button onClick={refresh} className="p-2 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" title="Refresh">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 10a7 7 0 0113.4-2.8M17 10a7 7 0 01-13.4 2.8" /><path d="M3 4v4h4M17 16v-4h-4" /></svg>
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className={`w-full h-full ${isDraggingNode ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Edges */}
        {edges.map((e, i) => (
          <line
            key={`edge-${i}`}
            x1={nodes[e.source].x}
            y1={nodes[e.source].y}
            x2={nodes[e.target].x}
            y2={nodes[e.target].y}
            stroke={lineColor}
            strokeWidth={0.8}
          />
        ))}

        {/* Nodes */}
        {nodes.map((node) => {
          const isTag = node.type === "tag";
          const isHovered = hoveredNode === node.id;
          const r = isTag ? 20 : 10;

          return (
            <g
              key={node.id}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                const svgPos = screenToSvgRef(e.clientX, e.clientY);
                dragRef.current = {
                  type: "node",
                  nodeId: node.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  vbX: svgPos.x - node.x,
                  vbY: svgPos.y - node.y,
                  moved: false,
                };
              }}
            >
              {/* Invisible larger hit area */}
              <circle
                cx={node.x}
                cy={node.y}
                r={isTag ? 30 : 20}
                fill="transparent"
              />

              {/* Glow on hover */}
              {isHovered && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 8}
                  fill={isTag ? tagColor : noteColor}
                  opacity={0.12}
                />
              )}

              {/* Node circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={isTag ? "#8B8B9E" : "#5A5A6E"}
                opacity={isHovered ? 0.95 : isTag ? 0.7 : 0.5}
              />

              {/* Label — to the right */}
              <text
                x={node.x + r + 6}
                y={node.y + 4}
                fontSize={isTag ? 12 : 10}
                fontWeight={isTag ? 600 : 400}
                fill={isTag ? tagColor : "#9CA3AF"}
                opacity={isHovered || isTag ? 1 : 0.6}
              >
                {node.label.length > 25 ? node.label.slice(0, 23) + "..." : node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Zoom level */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-gray-400 select-none pointer-events-none">
        {Math.round((bounds.w / viewBox.w) * 100)}%
      </div>

      {/* Overview minimap */}
      {showMinimap && (
        <Minimap
          nodes={nodes}
          edges={edges}
          bounds={bounds}
          viewBox={viewBox}
          darkMode={darkMode}
          onCenter={(x, y) =>
            setViewBox((v) => {
              const newVb = { ...v, x: x - v.w / 2, y: y - v.h / 2 };
              scheduleSave(newVb);
              return newVb;
            })
          }
          onZoom={(factor, x, y) => zoomBy(factor, x, y)}
        />
      )}

      {/* Note Preview Panel */}
      {preview && (
        <div
          className="absolute z-20 w-80 max-h-96 rounded-xl border shadow-2xl overflow-hidden flex flex-col"
          style={{
            right: 16,
            top: 56,
            backgroundColor: darkMode ? "#1e1e2e" : "#FFFFFF",
            borderColor: darkMode ? "#333355" : "#D1D5DB",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: darkMode ? "#333355" : "#E5E7EB" }}
          >
            <span className="text-sm font-semibold truncate" style={{ color: darkMode ? "#E5E7EB" : "#1F2937" }}>
              {preview.title}
            </span>
            <div className="flex gap-1 ml-2 flex-shrink-0">
              <button
                onClick={() => {
                  onSelectNote(preview.path);
                  setPreview(null);
                }}
                className="px-2.5 py-1 text-xs rounded-md bg-accent text-white hover:bg-green-600 transition-colors"
              >
                Open
              </button>
              <button
                onClick={() => setPreview(null)}
                className="px-2 py-1 text-xs rounded-md transition-colors"
                style={{
                  color: darkMode ? "#9CA3AF" : "#6B7280",
                  backgroundColor: darkMode ? "#2a2a4a" : "#F3F4F6",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5"
            style={{ color: darkMode ? "#D1D5DB" : "#374151" }}
          >
            {renderPreviewContent(preview.content)}
            {preview.content.split("\n").length > 30 && (
              <p className="text-[10px] text-gray-500 italic mt-2">...more content</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface MinimapProps {
  nodes: Node[];
  edges: Edge[];
  bounds: { x: number; y: number; w: number; h: number };
  viewBox: { x: number; y: number; w: number; h: number };
  darkMode: boolean;
  onCenter: (x: number, y: number) => void;
  onZoom: (factor: number, x: number, y: number) => void;
}

/** Small overview of the whole graph; click or drag to move the view, scroll to zoom. */
function Minimap({ nodes, edges, bounds, viewBox, darkMode, onCenter, onZoom }: MinimapProps) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const W = 180, H = 130;

  // Show both the graph and the current view, so the view rectangle never leaves the map.
  const minX = Math.min(bounds.x, viewBox.x);
  const minY = Math.min(bounds.y, viewBox.y);
  const maxX = Math.max(bounds.x + bounds.w, viewBox.x + viewBox.w);
  const maxY = Math.max(bounds.y + bounds.h, viewBox.y + viewBox.h);
  let w = maxX - minX, h = maxY - minY;
  if (w / h < W / H) w = h * (W / H); else h = w / (W / H);
  const area = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
  const unit = area.w / W; // graph units per minimap pixel

  const toGraph = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: area.x + ((clientX - rect.left) / rect.width) * area.w,
      y: area.y + ((clientY - rect.top) / rect.height) * area.h,
    };
  };

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      onZoom(Math.exp(delta * (e.ctrlKey ? 0.01 : 0.002)), viewBox.x + viewBox.w / 2, viewBox.y + viewBox.h / 2);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [onZoom, viewBox]);

  return (
    <div
      className="absolute bottom-3 right-3 z-10 rounded-lg border overflow-hidden shadow-lg"
      style={{
        backgroundColor: darkMode ? "rgba(22,22,42,0.9)" : "rgba(255,255,255,0.9)",
        borderColor: darkMode ? "#333355" : "#D1D5DB",
      }}
    >
      <svg
        ref={ref}
        width={W}
        height={H}
        viewBox={`${area.x} ${area.y} ${area.w} ${area.h}`}
        className="block cursor-pointer"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          dragging.current = true;
          const p = toGraph(e.clientX, e.clientY);
          onCenter(p.x, p.y);
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return;
          const p = toGraph(e.clientX, e.clientY);
          onCenter(p.x, p.y);
        }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {edges.map((e, i) => (
          <line
            key={i}
            x1={nodes[e.source].x}
            y1={nodes[e.source].y}
            x2={nodes[e.target].x}
            y2={nodes[e.target].y}
            stroke={darkMode ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}
            strokeWidth={unit * 0.6}
          />
        ))}
        {nodes.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={unit * (n.type === "tag" ? 3 : 1.6)}
            fill={n.type === "tag" ? "#22C55E" : darkMode ? "#8B8B9E" : "#6B7280"}
          />
        ))}
        <rect
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.w}
          height={viewBox.h}
          fill="rgba(34,197,94,0.08)"
          stroke="#22C55E"
          strokeWidth={unit * 1.5}
        />
      </svg>
    </div>
  );
}
