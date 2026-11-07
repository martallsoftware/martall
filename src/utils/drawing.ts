// Excalidraw drawings stored in the vault as `<name>.excalidraw` (scene JSON).

// Kept free of Excalidraw imports so the main bundle stays small;
// the editor parts live in drawingShapes.ts and load on demand.

export const DRAWING_EXT = ".excalidraw";

/** Choice in the New Note template list that creates a drawing instead of a note. */
export const DRAWING_TEMPLATE = "__excalidraw__";

/** Mermaid diagram files (`.mmd`): code on the left, rendered diagram on the right. */
export function isMermaidPath(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().endsWith(".mmd");
}

/** Obsidian Excalidraw plugin drawing: markdown holding the scene. */
export function isObsidianDrawingPath(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().endsWith(".excalidraw.md");
}

export function isDrawingPath(path: string | null | undefined): boolean {
  return !!path && (path.toLowerCase().endsWith(DRAWING_EXT) || isObsidianDrawingPath(path));
}

/** File name of a drawing without folder and extension. */
export function drawingName(path: string): string {
  return (path.split(/[/\\]/).pop() ?? path).replace(/\.excalidraw(\.md)?$/i, "");
}

/** Scene JSON for a new drawing, optionally starting from `elements`. */
export function sceneJson(elements: readonly unknown[] = [], appState: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "martall",
      elements,
      appState: { gridSize: 20, ...appState },
      files: {},
    },
    null,
    2,
  );
}

/**
 * Extra data Martall keeps in a drawing file (Excalidraw ignores unknown keys;
 * DrawingView carries it over on every save). `mermaid` is a fingerprint of the
 * Mermaid code the drawing was made from, so "Edit as drawing" can reopen it.
 */
export interface DrawingMeta {
  mermaid?: string;
}

export function drawingMeta(content: string): DrawingMeta {
  try {
    const m = JSON.parse(content || "{}").martall;
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/** Add `meta` to serialized scene JSON. */
export function withDrawingMeta(json: string, meta: DrawingMeta): string {
  if (!meta || Object.keys(meta).length === 0) return json;
  return JSON.stringify({ ...JSON.parse(json), martall: meta }, null, 2);
}

/** Stable fingerprint of Mermaid code (FNV-1a over the trimmed text). */
export function mermaidKey(code: string): string {
  const text = stripMermaidFence(code).replace(/\r\n/g, "\n").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a:${(h >>> 0).toString(16)}:${text.length}`;
}

export interface ParsedScene {
  elements: readonly any[];
  appState: Record<string, unknown>;
  files: Record<string, any>;
}

export function parseScene(content: string): ParsedScene {
  try {
    const doc = JSON.parse(content || "{}");
    return {
      elements: Array.isArray(doc.elements) ? doc.elements : [],
      appState: doc.appState && typeof doc.appState === "object" ? doc.appState : {},
      files: doc.files && typeof doc.files === "object" ? doc.files : {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

/** Remove a surrounding ```mermaid fence if the user pasted the whole block. */
export function stripMermaidFence(code: string): string {
  const m = code.trim().match(/^```\s*mermaid\s*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : code).trim();
}

/**
 * Replace (or follow) the ```mermaid block whose code is `code` with `![[name]]`.
 * Returns null when no matching block is found.
 */
export function linkDrawingInNote(
  md: string,
  code: string,
  name: string,
  mode: "replace" | "append",
): string | null {
  const norm = (t: string) => t.replace(/\r\n/g, "\n").trim();
  const target = norm(code);
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) {
    if (norm(m[3]) !== target) continue;
    const embed = `${m[1]}![[${name}]]`;
    const replacement = mode === "replace" ? embed : `${m[0]}\n\n${embed}`;
    return md.slice(0, m.index) + replacement + md.slice(m.index + m[0].length);
  }
  return null;
}

/** Convert Mermaid source into Excalidraw elements (loads the editor code). */
export async function mermaidToElements(code: string) {
  const m = await import("./drawingShapes");
  return m.mermaidToElements(code);
}
