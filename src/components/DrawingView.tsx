import { useCallback, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  getCommonBounds,
  getSceneVersion,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { drawingMeta, parseScene, withDrawingMeta } from "../utils/drawing";
import { builtinLibrary, DEFAULT_APP_STATE, mermaidToElements } from "../utils/drawingShapes";

// Fonts are bundled in public/excalidraw-assets so drawing works offline.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  window.location.origin + "/excalidraw-assets/";

const LIBRARY_KEY = "martall_drawing_library";

function loadUserLibrary(): LibraryItems {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserLibrary(items: LibraryItems) {
  // Built-in shapes are re-added on every load; only store the user's own.
  const own = items.filter((i) => !i.id.startsWith("martall-"));
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(own));
  } catch {
    /* storage full or unavailable */
  }
}

interface Props {
  content: string;
  darkMode: boolean;
  onChange: (content: string) => void;
}

export default function DrawingView({ content, darkMode, onChange }: Props) {
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

  const insertMermaid = useCallback(async (code: string) => {
    const api = apiRef.current;
    if (!api) return;
    const { elements, files } = await mermaidToElements(code);
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
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

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
