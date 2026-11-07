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
