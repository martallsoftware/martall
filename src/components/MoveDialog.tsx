import { useState } from "react";
import type { TreeNode } from "../types";

interface Props {
  sourceName: string;
  folders: FolderEntry[];
  onConfirm: (destDir: string) => void;
  onCancel: () => void;
}

export interface FolderEntry {
  name: string;
  path: string;
  depth: number;
}

/** Flatten tree into a list of folders with depth for indentation */
export function collectFolders(
  nodes: TreeNode[],
  depth: number = 0,
): FolderEntry[] {
  const result: FolderEntry[] = [];
  for (const node of nodes) {
    if (node.is_folder) {
      result.push({ name: node.name, path: node.path, depth });
      result.push(...collectFolders(node.children, depth + 1));
    }
  }
  return result;
}

export default function MoveDialog({
  sourceName,
  folders,
  onConfirm,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[360px] max-h-[480px] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold">
            Move "{sourceName}"
          </h2>
          <p className="text-xs text-gray-400 mt-1">Select destination folder</p>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Root option */}
          <button
            onClick={() => setSelected("__root__")}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selected === "__root__"
                ? "bg-accent/15 text-accent"
                : "hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M2 4h5l1.5 2H14v7H2V4z" />
            </svg>
            / (root)
          </button>

          {folders.map((folder) => (
            <button
              key={folder.path}
              onClick={() => setSelected(folder.path)}
              className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === folder.path
                  ? "bg-accent/15 text-accent"
                  : "hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
              }`}
              style={{ paddingLeft: `${folder.depth * 16 + 12}px` }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M2 4h5l1.5 2H14v7H2V4z" />
              </svg>
              {folder.name}
            </button>
          ))}

          {folders.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">
              No folders. Create one first.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (selected) onConfirm(selected);
            }}
            disabled={!selected}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
