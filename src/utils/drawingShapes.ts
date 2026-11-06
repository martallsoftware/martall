// Excalidraw-dependent drawing helpers: defaults, Mermaid import, shape library.

import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { LibraryItem } from "@excalidraw/excalidraw/types";
import { stripMermaidFence } from "./drawing";

/** Clean, Visio-like defaults: sharp lines, sans-serif text. */
export const DEFAULT_APP_STATE = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemStrokeWidth: 1,
  currentItemRoundness: "sharp" as const,
};

/** Convert Mermaid source (flowchart, sequence, class…) into Excalidraw elements. */
export async function mermaidToElements(code: string) {
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const { elements, files } = await parseMermaidToExcalidraw(stripMermaidFence(code), {
    themeVariables: { fontSize: "16px" },
  });
  // Mermaid labels use <br/> for line breaks; Excalidraw text uses "\n".
  // `@{ label: "a<br/>b" }` labels arrive with the break dropped ("ab"),
  // so map those back to the source text.
  const BR = /<br\s*\/?>/gi;
  const restored = new Map<string, string>();
  for (const m of stripMermaidFence(code).matchAll(/"([^"\n]*<br\s*\/?>[^"\n]*)"/gi)) {
    restored.set(m[1].replace(BR, ""), m[1].replace(BR, "\n"));
  }
  const br = (t: string) => restored.get(t) ?? t.replace(BR, "\n");
  const skeletons = elements.map((e: any) => {
    // Mermaid sized its boxes for a plain sans-serif font; the default
    // hand-drawn font is wider and would overflow them.
    const font = FONT_FAMILY.Helvetica;
    const el = { roughness: 0, ...e };
    if (typeof el.text === "string") Object.assign(el, { text: br(el.text), fontFamily: font });
    if (el.label && typeof el.label.text === "string") {
      el.label = { ...el.label, text: br(el.label.text), fontFamily: font };
    }
    return el;
  });
  applyLinkStyles(stripMermaidFence(code), skeletons.filter((e: any) => e.type === "arrow"));
  const converted = convertToExcalidrawElements(skeletons as ExcalidrawElementSkeleton[], {
    regenerateIds: false,
  });
  return { elements: converted, files: files ?? {} };
}

/**
 * The converter ignores `linkStyle`; apply its stroke colour/width ourselves.
 * Arrows come out in definition order, which is what linkStyle indexes refer to.
 */
function applyLinkStyles(code: string, arrows: any[]) {
  for (const m of code.matchAll(/^\s*linkStyle\s+([\d,\s]+|default)\s+(.+?);?\s*$/gm)) {
    const targets = m[1].trim() === "default"
      ? arrows
      : m[1].split(",").map((n) => arrows[parseInt(n.trim(), 10)]).filter(Boolean);
    for (const decl of m[2].split(",")) {
      const [prop, value] = decl.split(":").map((s) => s.trim());
      for (const a of targets) {
        if (prop === "stroke") a.strokeColor = value;
        if (prop === "stroke-width") a.strokeWidth = Math.max(1, Math.min(4, parseFloat(value) || 2));
        if (prop === "stroke-dasharray") a.strokeStyle = "dashed";
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shape library: shapes Excalidraw lacks (cylinder, documents) built from a
// filled outline + an invisible labelled rectangle on top, grouped together.
// Arrows bind to the rectangle, so connectors stick to the shape.
// ---------------------------------------------------------------------------

type Pt = [number, number];

interface Palette {
  name: string;
  fill: string;
  stroke: string;
  dashed?: boolean;
}

const PALETTES: Palette[] = [
  { name: "ready", fill: "#dcfce7", stroke: "#15803d" },
  { name: "todo", fill: "#fef3c7", stroke: "#b45309", dashed: true },
  { name: "external", fill: "#f3f4f6", stroke: "#6b7280", dashed: true },
  { name: "info", fill: "#dbeafe", stroke: "#1d4ed8" },
];

const W = 160;
const H = 80;
// A system font: its width is known immediately, so text never gets cut off
// (a web font like Nunito may still be loading when the shapes are measured).
const FONT = FONT_FAMILY.Helvetica;

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 12): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });
}

function wave(x0: number, x1: number, y: number, amp: number, steps = 16): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [x0 + (x1 - x0) * t, y + amp * Math.sin(t * 2 * Math.PI)] as Pt;
  });
}

/** Closed filled polyline; points are relative to (x, y). */
function outline(points: Pt[], p: Palette, groupId: string, x = 0, y = 0): ExcalidrawElementSkeleton {
  const closed = [...points, points[0]];
  return {
    type: "line",
    x,
    y,
    points: closed,
    backgroundColor: p.fill,
    strokeColor: p.stroke,
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    strokeStyle: p.dashed ? "dashed" : "solid",
    groupIds: [groupId],
  } as ExcalidrawElementSkeleton;
}

function labelBox(x: number, y: number, w: number, h: number, text: string, p: Palette, groupId: string): ExcalidrawElementSkeleton {
  return {
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    roughness: 0,
    groupIds: [groupId],
    label: { text, fontSize: 16, fontFamily: FONT, strokeColor: p.stroke },
  } as ExcalidrawElementSkeleton;
}

function cylinder(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const ry = 10;
  // Left side down, bottom front arc left→right, right side up, top back arc right→left.
  const pts: Pt[] = [
    [0, ry],
    ...arc(W / 2, H - ry, W / 2, ry, Math.PI, 0),
    [W, ry],
    ...arc(W / 2, ry, W / 2, ry, 0, -Math.PI).slice(1),
  ];
  return [
    outline(pts, p, g),
    {
      type: "ellipse",
      x: 0,
      y: 0,
      width: W,
      height: 2 * ry,
      backgroundColor: p.fill,
      strokeColor: p.stroke,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      strokeStyle: p.dashed ? "dashed" : "solid",
      groupIds: [g],
    } as ExcalidrawElementSkeleton,
    labelBox(0, 2 * ry, W, H - 3 * ry, "Database", p, g),
  ];
}

function docShape(dx: number, dy: number): Pt[] {
  return [[dx, dy], [dx + W, dy], ...wave(dx + W, dx, dy + H - 8, -6)];
}

function documentShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [outline(docShape(0, 0), p, g), labelBox(0, 0, W, H - 14, "Document", p, g)];
}

function documentsShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    outline(docShape(12, 0), p, g),
    outline(docShape(6, 6), p, g),
    outline(docShape(0, 12), p, g),
    labelBox(0, 12, W, H - 14, "Files", p, g),
  ];
}

function processShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width: W,
      height: H,
      backgroundColor: p.fill,
      strokeColor: p.stroke,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      strokeStyle: p.dashed ? "dashed" : "solid",
      groupIds: [g],
      label: { text: "Process", fontSize: 16, fontFamily: FONT, strokeColor: p.stroke },
    } as ExcalidrawElementSkeleton,
  ];
}

function containerShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width: 360,
      height: 220,
      backgroundColor: p.fill,
      strokeColor: p.stroke,
      fillStyle: "solid",
      opacity: 40,
      strokeWidth: 1,
      roughness: 0,
      groupIds: [g],
    } as ExcalidrawElementSkeleton,
    {
      type: "text",
      x: 12,
      y: 8,
      text: "Group title",
      fontSize: 16,
      fontFamily: FONT,
      strokeColor: p.stroke,
      groupIds: [g],
    } as ExcalidrawElementSkeleton,
  ];
}

// --- more developer shapes -------------------------------------------------

const NEUTRAL: Palette = { name: "neutral", fill: "#ffffff", stroke: "#374151" };
const NOTE: Palette = { name: "note", fill: "#fef9c3", stroke: "#a16207" };

/** Filled rectangle / ellipse / diamond, optionally with a centred label. */
function box(
  type: "rectangle" | "ellipse" | "diamond",
  x: number, y: number, w: number, h: number,
  p: Palette, g: string,
  extra: Record<string, unknown> = {},
): ExcalidrawElementSkeleton {
  return {
    type, x, y, width: w, height: h,
    backgroundColor: p.fill, strokeColor: p.stroke, fillStyle: "solid",
    strokeWidth: 1, roughness: 0, strokeStyle: p.dashed ? "dashed" : "solid",
    groupIds: [g], ...extra,
  } as ExcalidrawElementSkeleton;
}

function label(text: string, p: Palette, fontSize = 16) {
  return { text, fontSize, fontFamily: FONT, strokeColor: p.stroke };
}

/** Open polyline (not filled). */
function stroke(points: Pt[], p: Palette, g: string, x = 0, y = 0, width = 1): ExcalidrawElementSkeleton {
  return {
    type: "line", x, y, points, strokeColor: p.stroke, backgroundColor: "transparent",
    strokeWidth: width, roughness: 0, groupIds: [g],
  } as ExcalidrawElementSkeleton;
}

function text(x: number, y: number, t: string, p: Palette, g: string, fontSize = 16): ExcalidrawElementSkeleton {
  return { type: "text", x, y, text: t, fontSize, fontFamily: FONT, strokeColor: p.stroke, groupIds: [g] } as ExcalidrawElementSkeleton;
}

/** Cylinder with an extra band under the lid (storage / bucket, Mermaid `lin-cyl`). */
function storageShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const [body, lid, lbl] = cylinder(p, g);
  const band = stroke(arc(W / 2, 18, W / 2, 10, Math.PI, 0), p, g);
  return [body, lid, band, { ...lbl, y: 30, height: H - 36, label: label("Storage", p) } as ExcalidrawElementSkeleton];
}

/** Horizontal cylinder (queue / log / stream, Mermaid `h-cyl`). */
function queueShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const h = 60, rx = 12;
  const pts: Pt[] = [
    [rx, 0],
    [W - rx, 0],
    ...arc(W - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2).slice(1),
    [rx, h],
    ...arc(rx, h / 2, rx, h / 2, Math.PI / 2, 1.5 * Math.PI).slice(1, -1),
  ];
  return [
    outline(pts, p, g),
    box("ellipse", W - 2 * rx, 0, 2 * rx, h, p, g),
    labelBox(rx, 0, W - 3 * rx, h, "Queue / log", p, g),
  ];
}

function decisionShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [box("diamond", 0, 0, 140, 100, p, g, { label: label("Decision?", p) })];
}

function terminalShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [box("rectangle", 0, 0, W, 50, p, g, { roundness: { type: 3 }, label: label("Start / end", p) })];
}

function folderShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const pts: Pt[] = [[0, 10], [0, 0], [50, 0], [60, 10], [W, 10], [W, H], [0, H]];
  return [outline(pts, p, g), labelBox(0, 12, W, H - 14, "Folder", p, g)];
}

function apiShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const d = 20, h = 60;
  const pts: Pt[] = [[d, 0], [W - d, 0], [W, h / 2], [W - d, h], [d, h], [0, h / 2]];
  return [outline(pts, p, g), labelBox(d, 0, W - 2 * d, h, "API", p, g)];
}

function serverShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const els: ExcalidrawElementSkeleton[] = [box("rectangle", 0, 0, W, H + 10, p, g)];
  for (let i = 0; i < 3; i++) {
    els.push(stroke([[0, 0], [W - 24, 0]], p, g, 12, 12 + i * 10));
  }
  els.push(labelBox(0, 42, W, H - 34, "Server / service", p, g));
  return els;
}

function webAppShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const els: ExcalidrawElementSkeleton[] = [
    box("rectangle", 0, 0, 180, 110, p, g),
    stroke([[0, 0], [180, 0]], p, g, 0, 20),
  ];
  ["#ef4444", "#f59e0b", "#22c55e"].forEach((c, i) => {
    els.push(box("ellipse", 8 + i * 12, 6, 8, 8, { ...p, fill: c, stroke: c }, g));
  });
  els.push(labelBox(0, 22, 180, 88, "Web app", p, g));
  return els;
}

function mobileShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    box("rectangle", 0, 0, 70, 120, p, g, { roundness: { type: 3 } }),
    stroke([[0, 0], [22, 0]], p, g, 24, 108, 2),
    labelBox(4, 10, 62, 90, "Mobile", p, g),
  ];
}

function actorShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    box("ellipse", 22, 0, 26, 26, p, g),
    stroke([[0, 0], [0, 34]], p, g, 35, 26, 2),
    stroke([[0, 0], [40, 0]], p, g, 15, 38, 2),
    stroke([[-15, 30], [0, 0], [15, 30]], p, g, 35, 60, 2),
    text(18, 96, "User", p, g),
  ];
}

function cloudShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  // Bumps along the top, flat-ish bottom.
  const pts: Pt[] = [
    ...arc(30, 50, 26, 22, Math.PI / 2, 1.5 * Math.PI, 8),
    ...arc(65, 24, 32, 24, Math.PI, 2 * Math.PI, 10).slice(1),
    ...arc(110, 30, 26, 22, 1.2 * Math.PI, 2 * Math.PI, 8).slice(1),
    ...arc(140, 52, 22, 22, 1.5 * Math.PI, 2.5 * Math.PI, 8).slice(1),
  ];
  return [outline(pts, p, g), labelBox(14, 26, 132, 44, "Cloud", p, g)];
}

function scheduleShape(p: Palette, g: string): ExcalidrawElementSkeleton[] {
  return [
    box("ellipse", 0, 0, 60, 60, p, g),
    stroke([[0, 0], [0, -18], [0, 0], [14, 8]], p, g, 30, 30, 2),
    text(70, 20, "Scheduled job", p, g),
  ];
}

function noteShape(_p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const pts: Pt[] = [[0, 0], [W - 20, 0], [W, 20], [W, H], [0, H]];
  return [
    outline(pts, NOTE, g),
    stroke([[W - 20, 0], [W - 20, 20], [W, 20]], NOTE, g),
    labelBox(6, 6, W - 30, H - 12, "Note / comment", NOTE, g),
  ];
}

function arrowShape(kind: "call" | "async" | "flow") {
  return (_p: Palette, g: string): ExcalidrawElementSkeleton[] => {
    const green = PALETTES[0].stroke;
    const opts = {
      call: { text: "request", color: "#374151", width: 1, style: "solid" },
      async: { text: "event / async", color: "#374151", width: 1, style: "dashed" },
      flow: { text: "① data flow", color: green, width: 3, style: "solid" },
    }[kind];
    return [
      {
        type: "arrow", x: 0, y: 0, width: 220, height: 0, points: [[0, 0], [220, 0]],
        strokeColor: opts.color, strokeWidth: opts.width, strokeStyle: opts.style, roughness: 0,
        groupIds: [g],
        label: { text: opts.text, fontSize: 14, fontFamily: FONT, strokeColor: opts.color },
      } as ExcalidrawElementSkeleton,
    ];
  };
}

function legendShape(_p: Palette, g: string): ExcalidrawElementSkeleton[] {
  const names = ["Ready / in place", "Decision / to do", "External", "Records"];
  const els: ExcalidrawElementSkeleton[] = [box("rectangle", 0, 0, 200, 132, NEUTRAL, g)];
  PALETTES.forEach((p, i) => {
    els.push(box("rectangle", 12, 12 + i * 28, 24, 18, p, g));
    els.push(text(46, 12 + i * 28, names[i], NEUTRAL, g, 14));
  });
  return els;
}

/** Shapes offered in each of the four diagram colours (one library row each). */
const SHAPES: { name: string; build: (p: Palette, g: string) => ExcalidrawElementSkeleton[] }[] = [
  { name: "Process", build: processShape },
  { name: "Database", build: cylinder },
  { name: "Storage", build: storageShape },
  { name: "Queue", build: queueShape },
  { name: "Document", build: documentShape },
  { name: "Files", build: documentsShape },
  { name: "Folder", build: folderShape },
  { name: "API", build: apiShape },
  { name: "Decision", build: decisionShape },
  { name: "Terminal", build: terminalShape },
  { name: "Group", build: containerShape },
];

/** Single-colour developer extras (recolour them with the properties panel). */
const EXTRAS: { name: string; build: (p: Palette, g: string) => ExcalidrawElementSkeleton[] }[] = [
  { name: "Server", build: serverShape },
  { name: "Web app", build: webAppShape },
  { name: "Mobile", build: mobileShape },
  { name: "User", build: actorShape },
  { name: "Cloud", build: cloudShape },
  { name: "Scheduled job", build: scheduleShape },
  { name: "Note", build: noteShape },
  { name: "Legend", build: legendShape },
  { name: "Call arrow", build: arrowShape("call") },
  { name: "Async arrow", build: arrowShape("async") },
  { name: "Data flow arrow", build: arrowShape("flow") },
];

let cachedLibrary: LibraryItem[] | null = null;

function libraryItem(id: string, name: string, elements: ExcalidrawElementSkeleton[]): LibraryItem {
  return {
    id,
    status: "published",
    name,
    created: 1,
    elements: convertToExcalidrawElements(elements) as LibraryItem["elements"],
  };
}

/** Built-in library: core shapes in the four diagram colours, then developer extras. */
export function builtinLibrary(): LibraryItem[] {
  if (cachedLibrary) return cachedLibrary;
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const items: LibraryItem[] = [];
  for (const shape of SHAPES) {
    for (const p of PALETTES) {
      const id = `martall-${slug(shape.name)}-${p.name}`;
      items.push(libraryItem(id, `${shape.name} (${p.name})`, shape.build(p, id)));
    }
  }
  for (const shape of EXTRAS) {
    const id = `martall-${slug(shape.name)}`;
    items.push(libraryItem(id, shape.name, shape.build(NEUTRAL, id)));
  }
  cachedLibrary = items;
  return items;
}
