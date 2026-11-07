// Importing Excalidraw content: drawing files (.excalidraw / .excalidraw.json),
// Obsidian Excalidraw notes (.excalidraw.md) and shape libraries (.excalidrawlib).
// Kept free of Excalidraw imports so it can run from the main bundle.

import { compressToBase64, decompressFromBase64 } from "lz-string";
import { invoke } from "@tauri-apps/api/core";
import { DRAWING_EXT } from "./drawing";

const DRAWING_SUFFIXES = [".excalidraw.md", ".excalidraw.json", ".excalidraw"];
const LIBRARY_SUFFIX = ".excalidrawlib";

export function isDrawingImportPath(path: string): boolean {
  const p = path.toLowerCase();
  return DRAWING_SUFFIXES.some((s) => p.endsWith(s));
}

export function isLibraryPath(path: string): boolean {
  return path.toLowerCase().endsWith(LIBRARY_SUFFIX);
}

/** File name without folder and without the Excalidraw / library extension. */
export function importBaseName(path: string): string {
  const file = path.split(/[/\\]/).pop() ?? path;
  const lower = file.toLowerCase();
  for (const s of [...DRAWING_SUFFIXES, LIBRARY_SUFFIX]) {
    if (lower.endsWith(s)) return file.slice(0, -s.length);
  }
  return file.replace(/\.[^.]+$/, "");
}

export interface ImportedScene {
  /** Scene JSON ready to save as a `.excalidraw` file. */
  json: string;
  elements: any[];
  files: Record<string, any>;
  /** Problems worth telling the user about (e.g. Obsidian images left behind). */
  warnings: string[];
}

/**
 * Obsidian's Excalidraw plugin keeps the scene in a ```json or
 * ```compressed-json (lz-string, base64, line-wrapped) block under "# Drawing".
 */
function sceneFromObsidian(md: string, warnings: string[]): unknown {
  const heading = md.search(/^#+\s*Drawing\s*$/m);
  const tail = heading >= 0 ? md.slice(heading) : md;
  const block = tail.match(/```(compressed-json|json)[ \t]*\n([\s\S]*?)\n?```/);
  if (!block) throw new Error("No drawing found in this Obsidian note");
  let raw = block[2];
  if (block[1] === "compressed-json") {
    raw = decompressFromBase64(raw.replace(/\s+/g, "")) ?? "";
    if (!raw) throw new Error("Could not decompress the Obsidian drawing");
  }
  if (/^#+\s*Embedded files\s*$/im.test(md)) {
    warnings.push("embedded images stay in Obsidian and are shown as empty boxes");
  }
  return JSON.parse(raw);
}

/** Parse a drawing file's text into a scene. Throws with a readable message. */
export function parseDrawingFile(path: string, text: string): ImportedScene {
  const warnings: string[] = [];
  let doc: any;
  try {
    doc = path.toLowerCase().endsWith(".md") ? sceneFromObsidian(text, warnings) : JSON.parse(text);
  } catch (err) {
    throw new Error(err instanceof SyntaxError ? "Not valid Excalidraw JSON" : String((err as Error).message ?? err));
  }
  if (!doc || !Array.isArray(doc.elements)) throw new Error("Not an Excalidraw drawing (no elements)");
  const elements = doc.elements.filter((e: any) => e && !e.isDeleted);
  const files = doc.files && typeof doc.files === "object" ? doc.files : {};
  const json = JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "martall",
      elements,
      appState: { gridSize: doc.appState?.gridSize ?? 20, viewBackgroundColor: doc.appState?.viewBackgroundColor ?? "#ffffff" },
      files,
    },
    null,
    2,
  );
  return { json, elements, files, warnings };
}

/**
 * Scene JSON as an Obsidian Excalidraw note (`.excalidraw.md`): text elements
 * listed for Obsidian search/links, the scene as compressed JSON.
 */
function obsidianTextElements(sceneJson: string): string {
  const doc = JSON.parse(sceneJson);
  return (doc.elements ?? [])
    .filter((e: any) => e.type === "text" && !e.isDeleted && String(e.text ?? "").trim())
    // originalText is the text as typed; `text` has the automatic line wraps.
    .map((e: any) => `${String(e.originalText ?? e.text).replace(/\n/g, " ")} ^${e.id}`)
    .join("\n\n");
}

function obsidianCompressed(sceneJson: string): string {
  return (compressToBase64(sceneJson).match(/.{1,256}/g) ?? []).join("\n\n");
}

/**
 * Save a scene back into an existing Obsidian drawing note: only the drawing
 * block and the "Text Elements" list change; front matter, tags, notes and
 * the "Embedded Files" section stay as they were. Falls back to a fresh note
 * if the file has no drawing block.
 */
export function updateObsidianMarkdown(original: string, sceneJson: string): string {
  const block = /(#+\s*Drawing\s*\n```)(compressed-json|json)[ \t]*\n[\s\S]*?\n?```/;
  const m = original.match(block);
  if (!m) return toObsidianMarkdown(sceneJson);
  // Keep the format the file already uses (plugin setting: compressed or not).
  const data = m[2] === "json" ? JSON.stringify(JSON.parse(sceneJson), null, "\t") : obsidianCompressed(sceneJson);
  let out = original.replace(block, (_all, head: string, kind: string) => `${head}${kind}\n${data}\n\`\`\``);
  const texts = obsidianTextElements(sceneJson);
  out = out.replace(/(#+\s*Text Elements[ \t]*\n)([\s\S]*?)(?=\n#+\s|\n%%|$)/, (_all, head: string) => `${head}${texts}\n`);
  return out;
}

export function toObsidianMarkdown(sceneJson: string): string {
  const texts = obsidianTextElements(sceneJson);
  const compressed = obsidianCompressed(sceneJson);
  return [
    "---",
    "",
    "excalidraw-plugin: parsed",
    "tags: [excalidraw]",
    "",
    "---",
    "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==",
    "",
    "",
    "# Excalidraw Data",
    "",
    "## Text Elements",
    texts,
    "",
    "%%",
    "## Drawing",
    "```compressed-json",
    compressed,
    "```",
    "%%",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

export const LIBRARY_KEY = "martall_drawing_library";
export const LIBRARY_EVENT = "martall:library-added";
/** Event to add a scene (from a dropped file) to the open drawing. */
export const INSERT_SCENE_EVENT = "martall:drawing-insert";

export function loadUserLibrary(): any[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function saveUserLibrary(items: readonly any[]) {
  // Built-in shapes are re-added on every load; only store the user's own.
  const own = items.filter((i) => !String(i.id).startsWith("martall-"));
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(own));
  } catch {
    /* storage full or unavailable */
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** Library items from an `.excalidrawlib` file (format v1 or v2). */
export function parseLibraryFile(text: string): any[] {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("Not valid Excalidraw library JSON");
  }
  const now = Date.now();
  if (Array.isArray(doc?.libraryItems)) {
    return doc.libraryItems
      .filter((i: any) => Array.isArray(i?.elements) && i.elements.length)
      .map((i: any) => ({ ...i, id: i.id || randomId(), status: i.status || "unpublished", created: i.created || now }));
  }
  if (Array.isArray(doc?.library)) {
    return doc.library
      .filter((els: any) => Array.isArray(els) && els.length)
      .map((elements: any[]) => ({ id: randomId(), status: "unpublished", created: now, elements }));
  }
  throw new Error("Not an Excalidraw library (no items)");
}

/** Add library items to the stored user library (skips ids already present). */
export function addToUserLibrary(items: any[]): number {
  const current = loadUserLibrary();
  const ids = new Set(current.map((i) => i.id));
  const fresh = items.filter((i) => !ids.has(i.id));
  saveUserLibrary([...fresh, ...current]);
  // Tell an open drawing to show them right away.
  window.dispatchEvent(new CustomEvent(LIBRARY_EVENT, { detail: fresh }));
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Into the vault
// ---------------------------------------------------------------------------

/** Create `<name>.excalidraw` in `dir`, adding " 2", " 3"… if the name is taken. */
export async function createDrawingUnique(dir: string, name: string, content: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${name} ${i}`;
    try {
      return await invoke<string>("create_drawing", { parentDir: dir, name: candidate, content });
    } catch (err) {
      if (i > 50 || !String(err).includes("already exists")) throw err;
    }
  }
}

export interface DrawingImportResult {
  imported: { name: string; path: string }[];
  libraryItems: number;
  skipped: string[];
}

/** Import drawing and library files; drawings are created in `targetDir`. */
export async function importExcalidrawFiles(paths: string[], targetDir: string): Promise<DrawingImportResult> {
  const result: DrawingImportResult = { imported: [], libraryItems: 0, skipped: [] };
  for (const path of paths) {
    const name = importBaseName(path);
    try {
      const { content } = await invoke<{ content: string }>("read_note", { path });
      if (isLibraryPath(path)) {
        result.libraryItems += addToUserLibrary(parseLibraryFile(content));
        continue;
      }
      const scene = parseDrawingFile(path, content);
      const created = await createDrawingUnique(targetDir, name, scene.json);
      const createdName = (created.split(/[/\\]/).pop() ?? name).replace(new RegExp(`\\${DRAWING_EXT}$`, "i"), "");
      result.imported.push({ name: createdName, path: created });
      for (const w of scene.warnings) result.skipped.push(`${name}: ${w}`);
    } catch (err) {
      result.skipped.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
