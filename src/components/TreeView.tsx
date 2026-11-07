import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TreeNode } from "../types";
import type { MenuItem } from "./ContextMenu";
import ContextMenu from "./ContextMenu";
import InputDialog from "./InputDialog";
import ConfirmDialog from "./ConfirmDialog";
import MoveDialog, { collectFolders } from "./MoveDialog";

const REVEAL_LABEL = (() => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac|iPhone|iPad/.test(ua)) return "Show in Finder";
  if (/Windows/.test(ua)) return "Show in Explorer";
  return "Show in file manager";
})();

async function revealInFileManager(path: string) {
  try {
    await invoke("reveal_in_file_manager", { path });
  } catch (err) {
    console.error("Failed to reveal in file manager:", err);
  }
}

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

/** Icon and tint per note kind (see `note_kind` in database.rs). */
const KIND_ICONS: Record<string, { title: string; cls: string; paths: React.ReactNode }> = {
  note: {
    title: "Note",
    cls: "",
    paths: <><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M6 5h4M6 8h4M6 11h2" /></>,
  },
  tasks: {
    title: "Tasks",
    cls: "text-emerald-500/80",
    paths: <><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5.5 8l2 2 3.5-4" /></>,
  },
  daily: {
    title: "Daily note",
    cls: "text-sky-500/80",
    paths: <><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /><path d="M5 9.5h2" /></>,
  },
  template: {
    title: "Template",
    cls: "text-violet-400",
    paths: <><path d="M3 1.5h7l3 3v10H3z" strokeDasharray="2 1.5" /><path d="M6 8h4M8 6v4" /></>,
  },
  routine: {
    title: "Routine (#routine)",
    cls: "text-orange-400",
    paths: <><path d="M3 7a5 5 0 0 1 8.5-3.5L13 5" /><path d="M13 2v3h-3" /><path d="M13 9a5 5 0 0 1-8.5 3.5L3 11" /><path d="M3 14v-3h3" /></>,
  },
  metrics: {
    title: "Metrics (#metrics)",
    cls: "text-pink-400",
    paths: <><path d="M2 13.5h12" /><path d="M3 11l3-4 3 2 4-5.5" /></>,
  },
  dashboard: {
    title: "Dashboard",
    cls: "text-indigo-400",
    paths: <><rect x="2" y="2" width="5" height="6" rx="1" /><rect x="9" y="2" width="5" height="3.5" rx="1" /><rect x="2" y="10" width="5" height="4" rx="1" /><rect x="9" y="7.5" width="5" height="6.5" rx="1" /></>,
  },
  script: {
    title: "Script (lua-live)",
    cls: "text-amber-400",
    paths: <><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" /><path d="M9 3l-2 10" /></>,
  },
  diagram: {
    title: "Note with Mermaid diagram",
    cls: "text-teal-400",
    paths: <><rect x="1.5" y="2" width="5" height="3.5" rx="0.5" /><rect x="9.5" y="10.5" width="5" height="3.5" rx="0.5" /><path d="M4 5.5v4.5a2 2 0 0 0 2 2h3.5" /></>,
  },
  mermaid: {
    title: "Mermaid diagram (.mmd)",
    cls: "text-cyan-400",
    paths: <><rect x="1.5" y="1.5" width="5" height="4" rx="1" /><rect x="9.5" y="1.5" width="5" height="4" rx="1" /><path d="M8 14.5l-2.5-3h5z" /><path d="M4 5.5v2.5h8V5.5M8 8v3.5" /></>,
  },
  drawing: {
    title: "Excalidraw drawing",
    cls: "text-accent",
    paths: <><rect x="1.5" y="2.5" width="5" height="4" rx="0.5" /><circle cx="11.5" cy="11.5" r="2.5" /><path d="M6.5 4.5h3a2 2 0 0 1 2 2V9" /><path d="M2 14l3-3" /></>,
  },
};

function NoteIcon({ node }: { node: TreeNode }) {
  const kind = node.path.toLowerCase().endsWith(".excalidraw") ? "drawing" : node.kind || "note";
  const icon = KIND_ICONS[kind] ?? KIND_ICONS.note;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={icon.cls}>
      <title>{icon.title}</title>
      {icon.paths}
    </svg>
  );
}

/** Path of the note New Note would have created (for "Open it" when the name is taken). */
export function existingNotePath(dir: string, name: string, template?: string): string {
  const mermaid = /\.mmd$/i.test(name) || /\.mmd$/i.test(template ?? "");
  const stem = name.replace(/\.(md|mmd)$/i, "");
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${stem}.${mermaid ? "mmd" : "md"}`;
}

/** Compare paths ignoring "\\" vs "/" and a trailing slash. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** Nodes from the top level down to the node at `path`, or null if not in the tree. */
function pathChain(nodes: TreeNode[], path: string): TreeNode[] | null {
  for (const n of nodes) {
    if (samePath(n.path, path)) return [n];
    if (n.is_folder) {
      const rest = pathChain(n.children, path);
      if (rest) return [n, ...rest];
    }
  }
  return null;
}

/** The list a node sits in (its parent's children, or the top level). */
function siblingsOf(nodes: TreeNode[], path: string): TreeNode[] | null {
  if (nodes.some((n) => n.path === path)) return nodes;
  for (const n of nodes) {
    if (n.is_folder) {
      const found = siblingsOf(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

interface Props {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectNote: (path: string) => void;
  onCreateNote: (
    parentDir: string,
    name: string,
    template?: string,
    answers?: Record<string, string>,
  ) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onCreateDrawing: (parentDir: string, name: string) => Promise<void>;
  /** Save pin weights (absolute path → weight, 0 = unpin) and refresh the tree. */
  onSetWeights: (updates: Record<string, number>) => Promise<void>;
  onRename: (path: string, newName: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onMove: (source: string, destDir: string) => Promise<void>;
  rootDir: string;
  /** Expand the folders down to `path`, scroll to it and flash it (e.g. from the breadcrumb). */
  reveal?: { path: string; key: number } | null;
}

// Last reveal handled, so a remount (switching sidebar panels) doesn't replay it.
let lastRevealKey = 0;

interface NodeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  highlightPath: string | null;
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
  highlightPath,
  toggleExpand,
  onSelectNote,
  onContextMenu,
  renamingPath,
  renameValue,
  setRenameValue,
  onRenameSubmit,
  onRenameCancel,
}: NodeProps) {
  const isHighlighted = node.path === highlightPath;
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
        }${isHighlighted ? " ring-2 ring-accent/70 bg-accent/10" : ""}`}
        data-tree-path={node.path}
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
            <NoteIcon node={node} />
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

        {/* Pinned to the top of its folder */}
        {(node.weight ?? 0) > 0 && !isRenaming && (
          <span className="flex-shrink-0 text-accent/70" title="Pinned to top (right-click to move or unpin)">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3.5-1.5 1.5-3-3-4 4-.5-.5 4-4-3-3L4 6l3.5.5L10 4z" />
            </svg>
          </span>
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
              highlightPath={highlightPath}
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
      withTemplates?: boolean;
      onConfirm: (val: string, template?: string, answers?: Record<string, string>) => void | Promise<void>;
      onOpenExisting?: (val: string, template?: string) => void;
    }
  | { type: "confirm"; title: string; message: string; onConfirm: () => void }
  | { type: "move"; sourcePath: string; sourceName: string };

export default function TreeView({
  nodes,
  selectedPath,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onCreateDrawing,
  onSetWeights,
  onRename,
  onDelete,
  onMove,
  rootDir,
  reveal,
}: Props) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reveal: open every folder from the vault root down to the target.
  // Paths are matched slash-insensitively and the tree's own paths are used,
  // because on Windows tree paths use "\" while callers may build them with "/".
  useEffect(() => {
    if (!reveal || reveal.key === lastRevealKey) return;
    lastRevealKey = reveal.key;
    const chain = pathChain(nodes, reveal.path);
    if (!chain) return;
    const target = chain[chain.length - 1];
    const folders = chain.filter((n) => n.is_folder).map((n) => n.path);
    setExpandedPaths((prev) => new Set([...prev, ...folders]));
    setHighlightPath(target.path);
    // Scroll once the expanded folders have rendered.
    const scroll = setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-tree-path="${CSS.escape(target.path)}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    const t = setTimeout(() => setHighlightPath(null), 2000);
    return () => {
      clearTimeout(scroll);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.key]);
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

  /** Pin / move / unpin items for a node, among siblings of the same kind (folder or file). */
  const pinMenuItems = useCallback(
    (node: TreeNode): MenuItem[] => {
      const group = (siblingsOf(nodes, node.path) ?? []).filter((n) => n.is_folder === node.is_folder);
      const pinned = group.filter((n) => (n.weight ?? 0) > 0); // already sorted, highest first
      const idx = pinned.findIndex((n) => n.path === node.path);
      // Rewrite the whole pinned list as n..1 so weights stay small and tidy.
      const save = (order: TreeNode[]) =>
        onSetWeights(Object.fromEntries(order.map((n, i) => [n.path, order.length - i])));
      if (idx === -1) {
        return [{ label: "📌 Pin to top", onClick: () => save([node, ...pinned]) }];
      }
      const items: MenuItem[] = [];
      if (idx > 0) {
        items.push({
          label: "↑ Move up",
          onClick: () => {
            const order = [...pinned];
            [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
            save(order);
          },
        });
      }
      if (idx < pinned.length - 1) {
        items.push({
          label: "↓ Move down",
          onClick: () => {
            const order = [...pinned];
            [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
            save(order);
          },
        });
      }
      items.push({
        label: "Unpin",
        onClick: () =>
          onSetWeights({ [node.path]: 0, ...Object.fromEntries(pinned.filter((n) => n.path !== node.path).map((n, i, a) => [n.path, a.length - i])) }),
      });
      return items;
    },
    [nodes, onSetWeights],
  );

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
              withTemplates: true,
              onConfirm: async (name, template, answers) => {
                // Close only once created: an error (name taken) keeps the dialog open.
                await onCreateNote(rootDir, name, template, answers);
                setDialog(null);
              },
              onOpenExisting: (name, template) => {
                setDialog(null);
                onSelectNote(existingNotePath(rootDir, name, template));
              },
            });
          },
        },
        {
          label: "New Drawing",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Drawing",
              placeholder: "Drawing name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateDrawing(rootDir, name);
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
        {
          label: REVEAL_LABEL,
          onClick: () => revealInFileManager(rootDir),
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
              withTemplates: true,
              onConfirm: async (name, template, answers) => {
                await onCreateNote(node.path, name, template, answers);
                setDialog(null);
                setExpandedPaths((prev) => new Set(prev).add(node.path));
              },
              onOpenExisting: (name, template) => {
                setDialog(null);
                onSelectNote(existingNotePath(node.path, name, template));
              },
            });
          },
        },
        {
          label: "New Drawing",
          onClick: () => {
            setDialog({
              type: "input",
              title: "New Drawing",
              placeholder: "Drawing name",
              onConfirm: async (name) => {
                setDialog(null);
                await onCreateDrawing(node.path, name);
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
        ...pinMenuItems(node),
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
          label: REVEAL_LABEL,
          onClick: () => revealInFileManager(node.path),
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
      ...pinMenuItems(node),
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
        label: REVEAL_LABEL,
        onClick: () => revealInFileManager(node.path),
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
  }, [contextMenu, rootDir, onCreateNote, onCreateFolder, onCreateDrawing, onDelete, startRename, pinMenuItems]);

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
      ref={containerRef}
      className="flex-1 overflow-y-auto py-1"
      onContextMenu={handleRootContextMenu}
    >
      {nodes.length > 0 && (
        <div className="flex items-center justify-end px-2 pb-1">
          <button
            onClick={() => setExpandedPaths(new Set())}
            disabled={expandedPaths.size === 0}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400 hover:text-accent disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
            title="Collapse all folders"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4-3 4 3" />
              <path d="M4 10l4 3 4-3" />
            </svg>
            Collapse all
          </button>
        </div>
      )}
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
          highlightPath={highlightPath}
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
          withTemplates={dialog.withTemplates}
          onConfirm={dialog.onConfirm}
          onOpenExisting={dialog.onOpenExisting}
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
