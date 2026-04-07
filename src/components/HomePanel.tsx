import type { TagInfo, Vault } from "../types";
import type { SidebarPanel } from "./IconRail";
import pkg from "../../package.json";

interface Props {
  noteCount: number;
  folderCount: number;
  tags: TagInfo[];
  activeVault: Vault | undefined;
  onNewNote: () => void;
  onNewFolder: () => void;
  onImport: () => void;
  onPanel: (panel: SidebarPanel) => void;
  onSelectTag?: (tag: string) => void;
}

export default function HomePanel({
  noteCount,
  folderCount,
  tags,
  activeVault,
  onNewNote,
  onNewFolder,
  onImport,
  onPanel,
  onSelectTag,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Welcome */}
      <div className="mb-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold text-accent">Martall</h2>
          <span className="text-[10px] text-gray-400">v{pkg.version}</span>
        </div>
        <p className="text-xs text-gray-400">Your notes, organized.</p>
      </div>

      {/* Active vault */}
      <button
        onClick={() => onPanel("vaults")}
        className="w-full flex items-center gap-2.5 p-3 mb-5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:bg-accent/5 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
          <rect x="2" y="3" width="16" height="14" rx="2" />
          <path d="M2 7h16" />
          <circle cx="5" cy="5" r="0.5" fill="currentColor" />
          <circle cx="7.5" cy="5" r="0.5" fill="currentColor" />
          <path d="M6 11h8M6 14h5" />
        </svg>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium truncate">{activeVault?.name || "No vault"}</p>
          <p className="text-[10px] text-gray-400 truncate">{activeVault?.path || ""}</p>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-400 flex-shrink-0">
          <path d="M4.5 2L8.5 6L4.5 10" />
        </svg>
      </button>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <button
          onClick={onNewNote}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:bg-accent/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="4" y="2" width="12" height="16" rx="2" />
            <path d="M10 7v6M7 10h6" />
          </svg>
          <span className="text-[10px] font-medium">New Note</span>
        </button>
        <button
          onClick={onNewFolder}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:bg-accent/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 5h5l2 2h7v9H3V5z" />
            <path d="M10 9v4M8 11h4" />
          </svg>
          <span className="text-[10px] font-medium">New Folder</span>
        </button>
        <button
          onClick={onImport}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:bg-accent/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 13v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
            <path d="M10 3v10" />
            <path d="M6 9l4 4 4-4" />
          </svg>
          <span className="text-[10px] font-medium">Import</span>
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 mb-5">
        <button
          onClick={() => onPanel("notes")}
          className="flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors text-center"
        >
          <p className="text-lg font-bold text-accent">{noteCount}</p>
          <p className="text-[10px] text-gray-400">Notes</p>
        </button>
        <button
          onClick={() => onPanel("notes")}
          className="flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors text-center"
        >
          <p className="text-lg font-bold text-accent">{folderCount}</p>
          <p className="text-[10px] text-gray-400">Folders</p>
        </button>
        <button
          onClick={() => onPanel("tags")}
          className="flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors text-center"
        >
          <p className="text-lg font-bold text-accent">{tags.length}</p>
          <p className="text-[10px] text-gray-400">Tags</p>
        </button>
      </div>

      {/* Quick links */}
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Quick Access</p>
        <button
          onClick={() => onPanel("notes")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0"><path d="M2 4h5l1.5 2H14v7H2V4z" /></svg>
          Browse Notes
        </button>
        <button
          onClick={() => onPanel("tags")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0"><path d="M2 10V3.5A1.5 1.5 0 013.5 2H10l8 8-6 6-8-8z" /><circle cx="6" cy="6" r="1.5" fill="currentColor" /></svg>
          Tag Cloud
        </button>
        <button
          onClick={() => onPanel("search")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-400 flex-shrink-0"><circle cx="6.5" cy="6.5" r="5" /><path d="M10.5 10.5L14 14" /></svg>
          Search Notes
        </button>
        <button
          onClick={() => onPanel("vaults")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 7h16" /><circle cx="5" cy="5" r="0.5" fill="currentColor" /><circle cx="7.5" cy="5" r="0.5" fill="currentColor" /></svg>
          Switch Vault
        </button>
      </div>

      {/* Recent tags */}
      {tags.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Top Tags</p>
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 10).map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  onPanel("tags");
                  onSelectTag?.(t.name);
                }}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-full bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
              >
                #{t.name}
                <span className="opacity-50">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
