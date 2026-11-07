import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToCanvas,
  exportToSvg,
  MainMenu,
  getCommonBounds,
  getSceneVersion,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@excalidraw/excalidraw/index.css";
import { drawingMeta, parseScene, withDrawingMeta } from "../utils/drawing";
import { bytesToBase64, canvasToPdf } from "../utils/pdf";
import { builtinLibrary, DEFAULT_APP_STATE, mermaidToElements } from "../utils/drawingShapes";
import {
  addToUserLibrary,
  INSERT_SCENE_EVENT,
  isLibraryPath,
  LIBRARY_EVENT,
  loadUserLibrary,
  parseDrawingFile,
  parseLibraryFile,
  saveUserLibrary,
  toObsidianMarkdown,
} from "../utils/drawingImport";

// Fonts are bundled in public/excalidraw-assets so drawing works offline.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  window.location.origin + "/excalidraw-assets/";

/**
 * Give pasted-in elements fresh ids (and group ids) so importing the same
 * drawing twice, or into itself, never clashes; bindings follow the new ids.
 */
function withFreshIds(elements: readonly any[]): any[] {
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  const fresh = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  for (const el of elements) ids.set(el.id, fresh());
  const id = (v: string | null | undefined) => (v && ids.get(v)) || v;
  const group = (g: string) => {
    if (!groups.has(g)) groups.set(g, fresh());
    return groups.get(g)!;
  };
  return elements.map((el) => ({
    ...el,
    id: ids.get(el.id),
    groupIds: (el.groupIds ?? []).map(group),
    containerId: id(el.containerId) ?? null,
    frameId: id(el.frameId) ?? null,
    boundElements: el.boundElements?.map((b: any) => ({ ...b, id: id(b.id) })) ?? null,
    startBinding: el.startBinding ? { ...el.startBinding, elementId: id(el.startBinding.elementId) } : el.startBinding,
    endBinding: el.endBinding ? { ...el.endBinding, elementId: id(el.endBinding.elementId) } : el.endBinding,
  }));
}

type ExportKind = "excalidraw" | "obsidian" | "png" | "svg" | "pdf";

const EXPORTS: Record<ExportKind, { label: string; ext: string; suffix: string }> = {
  excalidraw: { label: "Excalidraw drawing", ext: "excalidraw", suffix: ".excalidraw" },
  obsidian: { label: "Obsidian Excalidraw note", ext: "md", suffix: ".excalidraw.md" },
  png: { label: "PNG image", ext: "png", suffix: ".png" },
  svg: { label: "SVG image", ext: "svg", suffix: ".svg" },
  pdf: { label: "PDF document", ext: "pdf", suffix: ".pdf" },
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

interface Props {
  /** Drawing name, used as the default file name when exporting. */
  name: string;
  content: string;
  darkMode: boolean;
  onChange: (content: string) => void;
}

export default function DrawingView({ name, content, darkMode, onChange }: Props) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);

  // Parse once per mount; the parent remounts this view per file (key = path).
  // Martall's own data in the file (e.g. Mermaid source fingerprint), kept on save.
  const meta = useMemo(() => drawingMeta(content), []); // eslint-disable-line react-hooks/exhaustive-deps

  const initialData = useMemo(() => {
    const scene = parseScene(content);
    const own = loadUserLibrary();
    const ownIds = new Set(own.map((i) => i.id));
    return {
      elements: scene.elements,
      appState: { ...DEFAULT_APP_STATE, ...scene.appState },
      files: scene.files,
      libraryItems: [...own, ...builtinLibrary().filter((i) => !ownIds.has(i.id))],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only write when something that is saved actually changed (not on every
  // pointer move / selection change, which also fire onChange).
  const lastKey = useRef<string | null>(null);
  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      const key = `${getSceneVersion(elements)}|${Object.keys(files).length}|${appState.viewBackgroundColor}|${appState.gridSize}`;
      if (lastKey.current === null) {
        lastKey.current = key; // first call is the initial load
        return;
      }
      if (key === lastKey.current) return;
      lastKey.current = key;
      onChange(withDrawingMeta(serializeAsJSON(elements, appState, files, "local"), meta));
    },
    [onChange, meta],
  );

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Add elements next to what is already on the canvas and zoom to them. */
  const insertElements = useCallback((elements: readonly any[], files: Record<string, any>) => {
    const api = apiRef.current;
    if (!api || elements.length === 0) return;
    const existing = api.getSceneElements();
    // Place the new diagram to the right of what is already on the canvas.
    let dx = 0;
    if (existing.length > 0 && elements.length > 0) {
      const [, , maxX] = getCommonBounds(existing);
      const [minX] = getCommonBounds(elements);
      dx = maxX + 120 - minX;
    }
    const shifted = elements.map((el) => ({ ...el, x: el.x + dx }));
    const fileList = Object.values(files);
    if (fileList.length) api.addFiles(fileList as any);
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...shifted],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent(shifted, { fitToContent: true, animate: true });
  }, []);

  const insertMermaid = useCallback(
    async (code: string) => {
      const { elements, files } = await mermaidToElements(code);
      insertElements(elements, files);
    },
    [insertElements],
  );

  /** A drawing file's elements, restored to the current format with fresh ids. */
  const insertScene = useCallback(
    (elements: readonly any[], files: Record<string, any>) => {
      insertElements(withFreshIds(restoreElements(elements as any, null)), files);
    },
    [insertElements],
  );

  // Files dropped on the app while this drawing is open, and libraries
  // imported from anywhere, arrive as window events.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const { elements, files } = (e as CustomEvent).detail;
      insertScene(elements, files ?? {});
    };
    const onLibrary = (e: Event) => {
      const items = (e as CustomEvent).detail as any[];
      if (items?.length) apiRef.current?.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true });
    };
    window.addEventListener(INSERT_SCENE_EVENT, onInsert);
    window.addEventListener(LIBRARY_EVENT, onLibrary);
    return () => {
      window.removeEventListener(INSERT_SCENE_EVENT, onInsert);
      window.removeEventListener(LIBRARY_EVENT, onLibrary);
    };
  }, [insertScene]);

  // "Browse libraries" is a link to a new tab, which the app window can't open.
  // Open the site in the system browser instead; downloaded .excalidrawlib
  // files are then dropped on the app (or picked via ☰ → Import file…).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.("a.library-menu-browse-button");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      openUrl(`https://libraries.excalidraw.com/?theme=${darkMode ? "dark" : "light"}`).catch((err) =>
        console.error("Could not open browser:", err),
      );
      setNotice(
        "Opened libraries.excalidraw.com in your browser.\nClick Download on a library, then drop the .excalidrawlib file here.",
      );
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [darkMode]);

  /** ☰ → Export: write the drawing (or a picture of it) to a file the user picks. */
  const exportAs = useCallback(
    async (kind: ExportKind) => {
      const api = apiRef.current;
      if (!api) return;
      const elements = api.getSceneElements();
      if (elements.length === 0) {
        setNotice("Nothing to export yet");
        return;
      }
      const spec = EXPORTS[kind];
      const path = await saveFileDialog({
        defaultPath: `${name}${spec.suffix}`,
        filters: [{ name: spec.label, extensions: [spec.ext] }],
      });
      if (!path) return;
      try {
        const appState = api.getAppState();
        const files = api.getFiles();
        // Pictures use the canvas background and the current theme.
        const imageState = { ...appState, exportBackground: true, exportWithDarkMode: darkMode, exportPadding: 20 };
        let contents: string;
        let base64 = false;
        if (kind === "pdf") {
          // Up to 3× resolution, capped so huge drawings stay a sane file size.
          const canvas = await exportToCanvas({
            elements,
            appState: imageState,
            files,
            getDimensions: (w: number, h: number) => {
              const scale = Math.max(1, Math.min(3, 6000 / Math.max(w, h)));
              return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
            },
          });
          contents = bytesToBase64(await canvasToPdf(canvas, name));
          base64 = true;
        } else if (kind === "png") {
          const blob = await exportToBlob({
            elements,
            appState: imageState,
            files,
            mimeType: "image/png",
            getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
          });
          contents = await blobToBase64(blob);
          base64 = true;
        } else if (kind === "svg") {
          contents = (await exportToSvg({ elements, appState: imageState, files })).outerHTML;
        } else {
          const json = serializeAsJSON(elements, appState, files, "local");
          contents = kind === "obsidian" ? toObsidianMarkdown(json) : json;
        }
        await invoke("write_export_file", { path, contents, base64 });
        setNotice(`Exported ${path.split(/[/\\]/).pop()}`);
      } catch (err) {
        setNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [name, darkMode],
  );

  /** ☰ → Import file…: a drawing is added to this canvas, a library to the Library panel. */
  const importFile = useCallback(async () => {
    const picked = await openFileDialog({
      multiple: true,
      filters: [
        { name: "Excalidraw", extensions: ["excalidraw", "md", "json", "excalidrawlib"] },
      ],
    });
    const paths = (Array.isArray(picked) ? picked : picked ? [picked] : []).filter(
      (p): p is string => typeof p === "string",
    );
    const messages: string[] = [];
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() ?? path;
      try {
        const { content } = await invoke<{ content: string }>("read_note", { path });
        if (isLibraryPath(path)) {
          const n = addToUserLibrary(parseLibraryFile(content));
          messages.push(`${name}: ${n} shape${n === 1 ? "" : "s"} added to the library`);
        } else {
          const scene = parseDrawingFile(path, content);
          insertScene(scene.elements, scene.files);
          messages.push(`${name}: added`, ...scene.warnings.map((w) => `${name}: ${w}`));
        }
      } catch (err) {
        messages.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (messages.length) setNotice(messages.join("\n"));
  }, [insertScene]);

  return (
    <div className="h-full w-full martall-drawing">
      <Excalidraw
        excalidrawAPI={(api) => {
          if (apiRef.current) return;
          apiRef.current = api;
          // Zoom so the whole drawing is visible when it opens.
          if (initialData.elements.length > 0) {
            setTimeout(() => api.scrollToContent(undefined, { fitToContent: true }), 50);
          }
        }}
        initialData={initialData as any}
        onChange={handleChange}
        onLibraryChange={saveUserLibrary}
        theme={darkMode ? "dark" : "light"}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: false },
        }}
        renderTopRightUI={() => (
          <button
            onClick={() => setMermaidOpen(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#232329] text-gray-700 dark:text-gray-200 hover:border-accent hover:text-accent transition-colors"
            title="Convert Mermaid code into editable shapes"
          >
            Import Mermaid
          </button>
        )}
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => setMermaidOpen(true)}>Import Mermaid…</MainMenu.Item>
          <MainMenu.Item onSelect={importFile}>Import file… (drawing or library)</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Group title="Export">
            <MainMenu.Item onSelect={() => exportAs("excalidraw")}>Excalidraw file (.excalidraw)…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("obsidian")}>Obsidian note (.excalidraw.md)…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("png")}>PNG image…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("svg")}>SVG image…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("pdf")}>PDF (A4)…</MainMenu.Item>
          </MainMenu.Group>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      {notice && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 max-w-lg whitespace-pre-line rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#232329] px-4 py-2 text-xs text-gray-700 dark:text-gray-200 shadow-lg">
          {notice}
        </div>
      )}

      {mermaidOpen && (
        <MermaidImportDialog
          onCancel={() => setMermaidOpen(false)}
          onInsert={async (code) => {
            await insertMermaid(code);
            setMermaidOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MermaidImportDialog({
  onInsert,
  onCancel,
}: {
  onInsert: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("flowchart LR\n  A[Start] --> B[(Database)]\n  B --> C[End]");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onInsert(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
      }}
    >
      <div className="w-[640px] max-w-[calc(100vw-32px)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Import Mermaid</h2>
          <p className="text-xs text-gray-500 mt-1">
            Paste a flowchart, sequence or class diagram. It becomes editable shapes and arrows.
            Colours from <code>classDef</code> and subgraphs are kept.
          </p>
        </div>
        <div className="p-5">
          <textarea
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            rows={14}
            className="w-full px-3 py-2 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
          />
          {error && <p className="mt-2 text-xs text-red-500 whitespace-pre-wrap">{error}</p>}
        </div>
        <div className="flex gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={run}
            disabled={busy || !code.trim()}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            {busy ? "Converting…" : "Insert"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
