// Pages in a drawing: each Excalidraw frame is a page (and a slide in Present).
// No Excalidraw import here, so notes can use it without loading the editor.

const isFrame = (e: any) => (e.type === "frame" || e.type === "magicframe") && !e.isDeleted;

const leadingNumber = (f: any) => parseFloat(String(f.name ?? "").match(/^\s*(\d+(?:\.\d+)?)/)?.[1] ?? "NaN");

/**
 * Frames in page order: by a leading number in their name when every frame
 * has one ("1 Intro", "2 Flow"…), otherwise reading order (rows, then left→right).
 */
export function pageFrames(elements: readonly any[]): any[] {
  const frames = elements.filter(isFrame);
  if (frames.length > 1 && frames.every((f) => !Number.isNaN(leadingNumber(f)))) {
    return frames.sort((a, b) => leadingNumber(a) - leadingNumber(b));
  }
  const rowHeight = Math.max(100, Math.min(...frames.map((f) => f.height)) / 2);
  return frames.sort((a, b) => Math.round(a.y / rowHeight) - Math.round(b.y / rowHeight) || a.x - b.x);
}

/** Frame name without its leading order number: "2 Data flow" → "Data flow". */
export function pageTitle(frame: any, index: number): string {
  const name = String(frame.name ?? "").replace(/^\s*\d+(?:\.\d+)?[.)]?\s*/, "").trim();
  return name || `Page ${index + 1}`;
}

/**
 * The page a reference like `#Data flow`, `#2` or `#2 Data flow` points to
 * (case-insensitive), or null.
 */
export function findPage(frames: any[], ref: string): any | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  if (/^\d+$/.test(r)) return frames[Number(r) - 1] ?? null;
  return (
    frames.find((f, i) => String(f.name ?? "").trim().toLowerCase() === r || pageTitle(f, i).toLowerCase() === r) ??
    null
  );
}

/** A page's frame plus everything inside it (and labels bound to those shapes). */
export function pageElements(elements: readonly any[], frame: any): any[] {
  const inside = new Set<string>([frame.id]);
  for (const e of elements) if (!e.isDeleted && e.frameId === frame.id) inside.add(e.id);
  return elements.filter((e) => !e.isDeleted && (inside.has(e.id) || (e.containerId && inside.has(e.containerId))));
}

/** "Name#Page" → ["Name", "Page"] (page empty when there is no #). */
export function splitPageRef(target: string): [string, string] {
  const i = target.indexOf("#");
  return i < 0 ? [target, ""] : [target.slice(0, i).trim(), target.slice(i + 1).trim()];
}

// ---------------------------------------------------------------------------
// Presentation path: a line or arrow whose points are the stops of a tour.
// ---------------------------------------------------------------------------

export const isPathCandidate = (e: any) => (e.type === "line" || e.type === "arrow") && !e.isDeleted;

/** The line/arrow marked as presentation path (customData.presentationPath). */
export function markedPath(elements: readonly any[]): any | null {
  return elements.find((e) => isPathCandidate(e) && e.customData?.presentationPath) ?? null;
}

type Box = [number, number, number, number]; // minX, minY, maxX, maxY

/** Axis-aligned box of a shape (rotation ignored: close enough to pick a stop). */
function boxOf(e: any): Box {
  if (Array.isArray(e.points) && e.points.length) {
    const xs = e.points.map((p: number[]) => e.x + p[0]);
    const ys = e.points.map((p: number[]) => e.y + p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [e.x, e.y, e.x + e.width, e.y + e.height];
}

/**
 * What to show at each point of `path`: the smallest shape or frame under the
 * point; if there is none, the shapes within `radius` of it; if still none,
 * an area of `radius` around the point (a tiny invisible stand-in box).
 */
export function pathStops(path: any, elements: readonly any[], radius = 250): any[][] {
  const others = elements.filter(
    (e) => !e.isDeleted && e.id !== path.id && !e.containerId && e.type !== "selection",
  );
  return (path.points as number[][]).map(([px, py]) => {
    const x = path.x + px;
    const y = path.y + py;
    // Connectors and pen strokes run across things; never stop "on" them.
    const under = others
      .filter((e) => !isPathCandidate(e) && e.type !== "freedraw")
      .map((e) => ({ e, b: boxOf(e) }))
      .filter(({ b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
      .sort((a, b) => (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) - (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]));
    if (under.length) return [under[0].e];
    const near = others.filter((e) => {
      const b = boxOf(e);
      const dx = Math.max(b[0] - x, 0, x - b[2]);
      const dy = Math.max(b[1] - y, 0, y - b[3]);
      return dx * dx + dy * dy <= radius * radius;
    });
    if (near.length) return near;
    return [{ id: `stop-${px}-${py}`, type: "rectangle", x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius, angle: 0, isDeleted: false }];
  });
}
