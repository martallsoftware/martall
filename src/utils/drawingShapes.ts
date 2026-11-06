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
    label: { text, fontSize: 16, fontFamily: FONT_FAMILY.Nunito, strokeColor: p.stroke },
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
      label: { text: "Process", fontSize: 16, fontFamily: FONT_FAMILY.Nunito, strokeColor: p.stroke },
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
      fontFamily: FONT_FAMILY.Nunito,
      strokeColor: p.stroke,
      groupIds: [g],
    } as ExcalidrawElementSkeleton,
  ];
}

const SHAPES: { name: string; build: (p: Palette, g: string) => ExcalidrawElementSkeleton[] }[] = [
  { name: "Process", build: processShape },
  { name: "Database", build: cylinder },
  { name: "Document", build: documentShape },
  { name: "Files", build: documentsShape },
  { name: "Group", build: containerShape },
];

let cachedLibrary: LibraryItem[] | null = null;

/** Built-in library: each shape in the four diagram colours. */
export function builtinLibrary(): LibraryItem[] {
  if (cachedLibrary) return cachedLibrary;
  const items: LibraryItem[] = [];
  for (const shape of SHAPES) {
    for (const p of PALETTES) {
      const id = `martall-${shape.name.toLowerCase()}-${p.name}`;
      items.push({
        id,
        status: "published",
        name: `${shape.name} (${p.name})`,
        created: 1,
        elements: convertToExcalidrawElements(shape.build(p, id)) as LibraryItem["elements"],
      });
    }
  }
  cachedLibrary = items;
  return items;
}
