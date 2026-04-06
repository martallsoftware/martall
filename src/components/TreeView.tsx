import { useState, useCallback } from "react";
import type { TreeNode } from "../types";
import type { MenuItem } from "./ContextMenu";
import ContextMenu from "./ContextMenu";
import InputDialog from "./InputDialog";
import ConfirmDialog from "./ConfirmDialog";
import MoveDialog, { collectFolders } from "./MoveDialog";

/** Count all notes (non-folder items) recursively under a node */
function countNotes(node: TreeNode): number {
  if (!node.is_folder) return 0;
  let count = 0;
  for (const child of node.children) {
    if (child.is_folder) {
      count += countNotes(child);
    } else {
      count++;
    }
  }
  return count;
}

interface Props {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectNote: (path: string) => void;
  onCreateNote: (parentDir: string, name: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRename: (path: string, newName: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onMove: (source: string, destDir: string) => Promise<void>;
  rootDir: string;
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  onSelectNote: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingPath: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  toggleExpand,
  onSelectNote,
  onContextMenu,
  renamingPath,
  renameValue,
  setRenameValue,
  onRenameSubmit,
  onRenameCancel,
}: NodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = node.path === selectedPath;
  const isRenaming = node.path === renamingPath;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded-md text-sm transition-colors group ${
          isSelected
            ? "bg-accent/15 text-accent"
            : "hover:bg-gray-200/60 dark:hover:bg-gray-700/40"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.is_folder) {
            toggleExpand(node.path);
          } else {
            onSelectNote(node.path);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {node.is_folder ? (
          <span
            className={`text-gray-400 w-3 flex-shrink-0 transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 1.5L7 5L3 8.5" />
            </svg>
          </span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        <span className="flex-shrink-0 text-gray-400">
          {node.is_folder ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              {isExpanded ? (
                <><path d="M2 4h5l1.5 2H14v7H2V4z" /><path d="M2 7h12" /></>
              ) : (
                <path d="M2 4h5l1.5 2H14v7H2V4z" />
              )}
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
              <path d="M6 5h4M6 8h4M6 11h2" />
            </svg>
          )}
        </span>

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit();
              if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameCancel}
            className="flex-1 min-w-0 px-1 py-0 text-sm bg-white dark:bg-[#16162a] border border-accent rounded outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{node.name}</span>
        )}

        {/* Note count badge for folders */}
        {node.is_folder && !isRenaming && (
          <span className="text-[10px] text-gray-400/70 flex-shrink-0 ml-auto tabular-nums">
            {countNotes(node)}
          </span>
        )}
      </div>

      {node.is_folder && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              onSelectNote={onSelectNote}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type DialogState =
  | null
  | {
      type: "input";
      title: string;
      placeholder: string;
      onConfirm: (val: string) => void;
    }
  | { type: "confirm"; title: string; message: string; onConfirm: () => void }
  | { type: "move"; sourcePath: string; sourceName: string };

export default function TreeView({
  nodes,
  selectedPath,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  rootDir,
}: Props) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode | null;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node: null });
    }
  }, []);

  const startRename = useCallback((path: string, currentName: string) => {
    setRenamingPath(path);
    setRenameValue(currentName);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (renamingPath && renameValue.trim()) {
      await onRename(renamingPath, renameValue.trim());
    }
    setRenamingPath(null);
    setRenameValue("");
  }, [renamingPath, renameValue, onRename]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
    setRenameValue("");
  }, []);

  const getContextMenuItems = useCallback((): MenuItem[] => {
    const node = contextMenu?.node;

    if (!node) {
      return [
        {
          label: "New Note",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Note",
              placeholder: "Note name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateNote(rootDir, name);
              },
            });
          },
        },
        {
          label: "New Folder",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Folder",
              placeholder: "Folder name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateFolder(`${rootDir}/${name}`);
              },
            });
          },
        },
      ];
    }

    if (node.is_folder) {
      return [
        {
          label: "New Note",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Note",
              placeholder: "Note name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateNote(node.path, name);
                setExpandedPaths((prev) => new Set(prev).add(node.path));
              },
            });
          },
        },
        {
          label: "New Subfolder",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Subfolder",
              placeholder: "Folder name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateFolder(`${node.path}/${name}`);
                setExpandedPaths((prev) => new Set(prev).add(node.path));
              },
            });
          },
        },
        {
          label: "Rename",
          onClick: () => startRename(node.path, node.name),
        },
        {
          label: "Move to...",
          onClick: () => {
            setDialog({
              type: "move",
              sourcePath: node.path,
              sourceName: node.name,
            });
          },
        },
        {
          label: "Delete",
          danger: true,
          onClick: () => {
            setDialog({
              type: "confirm",
              title: "Delete Folder",
              message: `Delete folder "${node.name}" and all its contents?`,
              onConfirm: async () => {
                setDialog(null);
                await onDelete(node.path);
              },
            });
          },
        },
      ];
    }

    // Note (file)
    return [
      {
        label: "Rename",
        onClick: () => startRename(node.path, node.name),
      },
      {
        label: "Move to...",
        onClick: () => {
          setDialog({
            type: "move",
            sourcePath: node.path,
            sourceName: node.name,
          });
        },
      },
      {
        label: "Delete",
        danger: true,
        onClick: () => {
          setDialog({
            type: "confirm",
            title: "Delete Note",
            message: `Delete "${node.name}"?`,
            onConfirm: async () => {
              setDialog(null);
              await onDelete(node.path);
            },
          });
        },
      },
    ];
  }, [contextMenu, rootDir, onCreateNote, onCreateFolder, onDelete, startRename]);

  // Build folder list for move dialog, excluding the source's own subtree
  const getMoveTargetFolders = useCallback(
    (sourcePath: string) => {
      const allFolders = collectFolders(nodes);
      // Filter out the source itself and any children of the source (if it's a folder)
      return allFolders.filter(
        (f) => f.path !== sourcePath && !f.path.startsWith(sourcePath + "/"),
      );
    },
    [nodes],
  );

  return (
    <div
      className="flex-1 overflow-y-auto py-1"
      onContextMenu={handleRootContextMenu}
    >
      {nodes.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          No notes yet.
          <br />
          Right-click to create one.
        </div>
      )}
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
          onSelectNote={onSelectNote}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={handleRenameCancel}
        />
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {dialog?.type === "input" && (
        <InputDialog
          title={dialog.title}
          placeholder={dialog.placeholder}
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === "confirm" && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel="Delete"
          danger
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === "move" && (
        <MoveDialog
          sourceName={dialog.sourceName}
          folders={getMoveTargetFolders(dialog.sourcePath)}
          onConfirm={async (destDir) => {
            const actualDest = destDir === "__root__" ? rootDir : destDir;
            setDialog(null);
            await onMove(dialog.sourcePath, actualDest);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
