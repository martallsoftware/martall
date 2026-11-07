import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { TreeNode } from "../types";
import { importExcalidrawFiles, isDrawingImportPath, isLibraryPath } from "../utils/drawingImport";

interface ImportResult {
  imported_count: number;
  skipped: string[];
  imported: string[];
  /** Shapes added to the drawing library from .excalidrawlib files. */
  library_items?: number;
}

interface Props {
  folders: TreeNode[];
  /** Vault root, where drawings go when no folder is chosen. */
  rootDir: string;
  onDone: () => void;
  onClose: () => void;
  /** Register a callback ref so the parent can send dropped files to this dialog */
  dropCallbackRef?: React.MutableRefObject<((files: string[]) => void) | null>;
}

/** Flatten folders from tree for the target folder picker */
function flattenFolders(
  nodes: TreeNode[],
  depth: number = 0,
): { name: string; path: string; depth: number }[] {
  const result: { name: string; path: string; depth: number }[] = [];
  for (const n of nodes) {
    if (n.is_folder) {
      result.push({ name: n.name, path: n.path, depth });
      result.push(...flattenFolders(n.children, depth + 1));
    }
  }
  return result;
}

export default function ImportDialog({ folders, rootDir, onDone, onClose, dropCallbackRef }: Props) {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [targetFolder, setTargetFolder] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const flatFolders = flattenFolders(folders);

  // Register drop callback so parent can send dropped files here
  useEffect(() => {
    if (dropCallbackRef) {
      dropCallbackRef.current = (files: string[]) => {
        setSelectedFiles((prev) => {
          const existing = new Set(prev);
          const newFiles = files.filter((f) => !existing.has(f));
          return [...prev, ...newFiles];
        });
      };
      return () => {
        dropCallbackRef.current = null;
      };
    }
  }, [dropCallbackRef]);

  const handlePickFiles = useCallback(async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [
          { name: "Notes and drawings", extensions: ["md", "excalidraw", "json", "excalidrawlib"] },
        ],
      });
      if (files) {
        const paths = Array.isArray(files) ? files : [files];
        setSelectedFiles(paths.filter((p): p is string => typeof p === "string"));
      }
    } catch (err) {
      console.error("File picker failed:", err);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setImporting(true);
    try {
      // Excalidraw drawings (incl. Obsidian's .excalidraw.md) and libraries are
      // converted here; plain .md notes go to the backend as before.
      const excalidraw = selectedFiles.filter((f) => isDrawingImportPath(f) || isLibraryPath(f));
      const notes = selectedFiles.filter((f) => !excalidraw.includes(f));
      const res: ImportResult = notes.length
        ? await invoke<ImportResult>("import_notes", { filePaths: notes, targetFolder: targetFolder || null })
        : { imported_count: 0, skipped: [], imported: [] };
      if (excalidraw.length) {
        const d = await importExcalidrawFiles(excalidraw, targetFolder || rootDir);
        res.imported_count += d.imported.length;
        res.imported.push(...d.imported.map((i) => `${i.name} (drawing)`));
        res.skipped.push(...d.skipped);
        res.library_items = d.libraryItems;
      }
      setResult(res);
      onDone();
    } catch (err) {
      console.error("Import failed:", err);
      setResult({
        imported_count: 0,
        skipped: [String(err)],
        imported: [],
      });
    }
    setImporting(false);
  }, [selectedFiles, targetFolder, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[440px] max-h-[520px] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold">Import notes and drawings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {result ? (
          /* Results view */
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <div className="flex items-center gap-2">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-green-500"
              >
                <circle cx="10" cy="10" r="8" />
                <path d="M6.5 10l2.5 2.5 5-5" />
              </svg>
              <span className="text-sm font-medium">
                {result.imported_count} file{result.imported_count !== 1 ? "s" : ""} imported
                {result.library_items ? ` · ${result.library_items} shapes added to the drawing library` : ""}
              </span>
            </div>

            {result.imported.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                  Imported
                </p>
                {result.imported.map((name, i) => (
                  <p key={i} className="text-xs text-gray-600 dark:text-gray-400 py-0.5">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="inline mr-1.5 text-gray-400"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M6 5h4M6 8h4M6 11h2" /></svg>
                    {name}
                  </p>
                ))}
              </div>
            )}

            {result.skipped.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-red-400 mb-1">
                  Skipped
                </p>
                {result.skipped.map((reason, i) => (
                  <p key={i} className="text-xs text-red-400 py-0.5">
                    {reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* File selection view */
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* File picker */}
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-2">
                Select .md notes, Excalidraw drawings (.excalidraw, Obsidian .excalidraw.md) or libraries (.excalidrawlib)
              </label>
              <button
                onClick={handlePickFiles}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-accent/50 hover:bg-accent/5 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                  <rect x="3" y="2" width="14" height="16" rx="2" />
                  <path d="M10 7v6M7 10h6" />
                </svg>
                <span className="text-xs text-gray-500">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected`
                    : "Click to browse files"}
                </span>
              </button>

              {/* Show selected files */}
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-0.5 max-h-28 overflow-y-auto">
                  {selectedFiles.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-xs text-gray-500 py-0.5"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-gray-400 flex-shrink-0"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M6 5h4M6 8h4M6 11h2" /></svg>
                      <span className="truncate">
                        {f.split(/[/\\]/).pop()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Target folder */}
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-2">
                Import to folder
              </label>
              <select
                value={targetFolder}
                onChange={(e) => setTargetFolder(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50"
              >
                <option value="">/ (root)</option>
                {flatFolders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {"  ".repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          {result ? (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={selectedFiles.length === 0 || importing}
                className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? "Importing..." : `Import ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
