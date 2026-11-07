import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";
import { drawingName, isDrawingPath, sceneJson } from "../utils/drawing";
import { createDrawingUnique } from "../utils/drawingImport";

interface Props {
  notePath: string | null;
  onInsert: (text: string) => void;
  onClose: () => void;
}

/** Event App listens for to reload the tree after a drawing is created here. */
export const TREE_CHANGED_EVENT = "martall:tree-changed";

/**
 * Editor toolbar popover: pick an existing drawing or create a new one next
 * to the note, and insert `![[Name]]` at the caret.
 */
export default function DrawingPicker({ notePath, onInsert, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState<NoteInfo[]>([]);
  const [query, setQuery] = useState("");
  const noteTitle = (notePath?.split(/[/\\]/).pop() ?? "Note").replace(/\.md$/i, "");
  const [newName, setNewName] = useState(`${noteTitle} drawing`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<NoteInfo[]>("get_all_notes_sorted", { sortBy: "updated", ascending: false })
      .then(setAll)
      .catch(() => setAll([]));
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const drawings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((n) => isDrawingPath(n.path))
      .filter((n) => !q || drawingName(n.path).toLowerCase().includes(q))
      .slice(0, 40);
  }, [all, query]);

  /** `![[Name]]`, or `![[Name.excalidraw]]` when a note has the same name. */
  const embedFor = (name: string) => {
    const clash = all.some((n) => !isDrawingPath(n.path) && n.title.toLowerCase() === name.toLowerCase());
    return `\n![[${clash ? `${name}.excalidraw` : name}]]\n`;
  };

  const insert = (name: string) => {
    onInsert(embedFor(name));
    onClose();
  };

  const create = async () => {
    const name = newName.trim().replace(/\.excalidraw$/i, "");
    if (!name || !notePath) return;
    setBusy(true);
    setError(null);
    try {
      const dir = notePath.replace(/[/\\][^/\\]*$/, "");
      const path = await createDrawingUnique(dir, name, sceneJson());
      window.dispatchEvent(new Event(TREE_CHANGED_EVENT));
      insert(drawingName(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const folderOf = (path: string) => path.split(/[/\\]/).slice(-2, -1)[0] ?? "";

  return (
    <div
      ref={ref}
      className="absolute bottom-10 right-0 z-50 w-[340px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl flex flex-col"
      style={{ maxHeight: "460px" }}
    >
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="text-sm font-semibold mb-2">Insert drawing</div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && drawings[0]) insert(drawingName(drawings[0].path));
          }}
          placeholder="Search drawings…"
          className="w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-[60px]">
        {drawings.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">
            {query ? "No drawing matches." : "No drawings yet — create one below."}
          </div>
        ) : (
          drawings.map((d) => (
            <button
              key={d.path}
              onClick={() => insert(drawingName(d.path))}
              className="w-full text-left px-4 py-1.5 text-sm hover:bg-accent/10 flex items-baseline gap-2"
            >
              <span className="text-accent">✏️</span>
              <span className="truncate flex-1">{drawingName(d.path)}</span>
              <span className="text-[10px] text-gray-400 truncate max-w-[110px]">{folderOf(d.path)}</span>
            </button>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 mb-1.5">New drawing next to this note</div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={create}
            disabled={busy || !newName.trim() || !notePath}
            className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
          >
            Create
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
