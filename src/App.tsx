import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings, useTree, useNote, useNodeOps } from "./hooks/useTauri";
import { useSearch, useTags } from "./hooks/useSearch";
import TreeView from "./components/TreeView";
import Editor from "./components/Editor";
import Preview from "./components/Preview";
import SettingsModal from "./components/SettingsModal";
import InputDialog from "./components/InputDialog";
import ShareMenu from "./components/ShareMenu";
import SearchBar from "./components/SearchBar";
import TagList from "./components/TagList";
import IconRail, { type SidebarPanel } from "./components/IconRail";
import HomePanel from "./components/HomePanel";
import RecentPanel from "./components/RecentPanel";
import FavoritesPanel from "./components/FavoritesPanel";
import GraphView from "./components/GraphView";
import ImportDialog from "./components/ImportDialog";
import VaultPicker from "./components/VaultPicker";
import type { TreeNode } from "./types";

type ViewMode = "edit" | "preview" | "split";

function countTree(nodes: TreeNode[]): { notes: number; folders: number } {
  let notes = 0;
  let folders = 0;
  for (const n of nodes) {
    if (n.is_folder) {
      folders++;
      const sub = countTree(n.children);
      notes += sub.notes;
      folders += sub.folders;
    } else {
      notes++;
    }
  }
  return { notes, folders };
}

export default function App() {
  const { settings, updateSettings, loaded } = useSettings();
  const { tree, refreshTree } = useTree();
  const { tags, activeTag, selectTag, tagResults, refreshTags } = useTags();
  const { note, saving, openNote, updateContent, closeNote } = useNote(refreshTags);
  const { createFolder, createNote, renameNode, deleteNode, moveNode } =
    useNodeOps(refreshTree);
  const { query, setQuery, results, searching, clearSearch } = useSearch();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favRefreshKey, setFavRefreshKey] = useState(0);
  const [activePanel, setActivePanel] = useState<SidebarPanel>("notes");
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    placeholder: string;
    onConfirm: (val: string) => void;
  } | null>(null);

  // Refs for drag-drop handler to access latest state
  const noteRef = useRef(note);
  noteRef.current = note;
  const showImportRef = useRef(showImport);
  showImportRef.current = showImport;
  // Callback ref: when import dialog is open, it registers here to receive dropped files
  const importDropCallback = useRef<((files: string[]) => void) | null>(null);

  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"];

  // Global drag-drop handler: .md files get imported, images get inserted
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;

    const promise = appWindow.onDragDropEvent(async (event) => {
      if (cancelled) return;
      if (event.payload.type !== "drop") return;

      const mdFiles: string[] = [];
      const imageFiles: string[] = [];

      for (const filePath of event.payload.paths) {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".md")) {
          mdFiles.push(filePath);
        } else if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          imageFiles.push(filePath);
        }
      }

      // If import dialog is open, send .md files to it instead of auto-importing
      if (mdFiles.length > 0) {
        if (showImportRef.current && importDropCallback.current) {
          importDropCallback.current(mdFiles);
        } else {
          // Auto-import to root
          try {
            await invoke("import_notes", {
              filePaths: mdFiles,
              targetFolder: null,
            });
            await refreshTree();
            await refreshTags();
          } catch (err) {
            console.error("Failed to import notes:", err);
          }
        }
      }

      // Insert images into current note
      if (imageFiles.length > 0 && noteRef.current) {
        for (const filePath of imageFiles) {
          try {
            const relativePath = await invoke<string>("copy_image_to_assets", {
              sourcePath: filePath,
              notePath: noteRef.current.path,
            });
            const markdown = `\n![](${relativePath})\n`;
            updateContent(noteRef.current.content + markdown);
          } catch (err) {
            console.error("Failed to copy image:", err);
          }
        }
      }
    });

    return () => {
      cancelled = true;
      promise.then((unlisten) => unlisten());
    };
  }, [refreshTree, refreshTags, updateContent]);

  // Sync index when app gets focus (catches changes from other devices)
  useEffect(() => {
    const handleFocus = async () => {
      try {
        await invoke("rebuild_index");
        await refreshTree();
        await refreshTags();
      } catch (err) {
        console.error("Sync on focus failed:", err);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshTree, refreshTags]);

  // Apply theme
  useEffect(() => {
    if (settings.dark_theme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    getCurrentWindow().setTheme(settings.dark_theme ? "dark" : "light");
  }, [settings.dark_theme]);

  // Refresh tree when settings change (notes directory might change)
  useEffect(() => {
    if (loaded) refreshTree();
  }, [loaded, settings.notes_directory, refreshTree]);

  const handleSelectNote = useCallback(
    async (path: string) => {
      await openNote(path);
      try {
        const fav = await invoke<boolean>("is_favorite", { path });
        setIsFavorite(fav);
      } catch {
        setIsFavorite(false);
      }
    },
    [openNote],
  );

  const handleCreateNote = useCallback(
    async (parentDir: string, name: string) => {
      const newPath = await createNote(parentDir, name);
      await openNote(newPath);
      refreshTags();
    },
    [createNote, openNote, refreshTags],
  );

  const handleRename = useCallback(
    async (oldPath: string, newName: string) => {
      const newPath = await renameNode(oldPath, newName);
      if (note && note.path === oldPath) {
        await openNote(newPath);
      }
      refreshTags();
    },
    [renameNode, note, openNote, refreshTags],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      await deleteNode(path);
      refreshTags();
      if (note && note.path === path) {
        closeNote();
      }
    },
    [deleteNode, note, closeNote],
  );

  const handleMove = useCallback(
    async (source: string, destDir: string) => {
      const newPath = await moveNode(source, destDir);
      if (note && note.path === source) {
        await openNote(newPath);
      }
    },
    [moveNode, note, openNote, refreshTags],
  );

  const getPreviewHtml = useCallback(() => {
    const previewEl = document.querySelector(".markdown-body");
    if (!previewEl) return null;
    const title = note?.path.split(/[/\\]/).pop()?.replace(".md", "") || "Note";
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  h3 { font-size: 1.25em; }
  code { background: #f4f4f4; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 1em; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #22C55E; padding-left: 1em; margin-left: 0; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f8f8f8; font-weight: 600; }
  img { max-width: 100%; border-radius: 8px; }
  a { color: #22C55E; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${title}</h1>
${previewEl.innerHTML}
</body>
</html>`;
    return html;
  }, [note]);

  const handlePrint = useCallback(() => {
    // Use the webview's native print directly
    window.print();
  }, []);

  const handleEmail = useCallback(async () => {
    if (!note) return;
    const title = note.path.split(/[/\\]/).pop()?.replace(".md", "") || "Note";
    const body = encodeURIComponent(note.content);
    const subject = encodeURIComponent(title);
    // Use Tauri's opener plugin to open mailto URL
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(`mailto:?subject=${subject}&body=${body}`);
    } catch (err) {
      console.error("Failed to open email:", err);
    }
  }, [note]);

  const handleExportHtml = useCallback(async () => {
    const html = getPreviewHtml();
    if (!html || !note) return;
    const exportPath = note.path.replace(/\.md$/, ".html");
    try {
      await invoke("export_html", { path: exportPath, html });
      // Open the exported file in the default browser
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(exportPath);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [getPreviewHtml, note]);

  const handleExportPdf = useCallback(async () => {
    const html = getPreviewHtml();
    if (!html || !note) return;
    const pdfPath = note.path.replace(/\.md$/, ".pdf");
    try {
      await invoke("export_pdf", { html, pdfPath });
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(pdfPath);
    } catch {
      // Backend PDF generation not available - fall back to browser print
      // which allows "Save as PDF" on all platforms
      window.print();
    }
  }, [getPreviewHtml, note]);

  const treeCounts = useMemo(() => countTree(tree), [tree]);

  // Determine the "current folder" based on the open note
  const currentFolder = useMemo(() => {
    if (!note) return settings.notes_directory;
    const lastSlash = Math.max(note.path.lastIndexOf("/"), note.path.lastIndexOf("\\"));
    if (lastSlash >= 0) {
      return note.path.substring(0, lastSlash);
    }
    return settings.notes_directory;
  }, [note, settings.notes_directory]);

  const triggerNewNote = useCallback(() => {
    setInputDialog({
      title: "New Note",
      placeholder: "Note name",
      onConfirm: async (name) => {
        setInputDialog(null);
        await handleCreateNote(currentFolder, name);
      },
    });
  }, [currentFolder, handleCreateNote]);

  const triggerNewFolder = useCallback(() => {
    setInputDialog({
      title: "New Folder",
      placeholder: "Folder name",
      onConfirm: async (name) => {
        setInputDialog(null);
        await createFolder(`${currentFolder}/${name}`);
      },
    });
  }, [currentFolder, createFolder]);

  if (!loaded) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#181825] dark:text-gray-100 select-none-ui">
      {/* Icon Rail */}
      <IconRail
        active={activePanel}
        onSelect={(panel) => {
          setActivePanel(panel);
          if (!sidebarOpen) setSidebarOpen(true);
        }}
        onSettings={() => setShowSettings(true)}
      />

      {/* Sidebar Panel */}
      <aside
        className={`flex flex-col border-r border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#1e1e2e] transition-all duration-200 ${
          sidebarOpen ? "w-60" : "w-0 overflow-hidden"
        }`}
      >
        {/* Panel: Home */}
        {activePanel === "home" && (
          <HomePanel
            noteCount={treeCounts.notes}
            folderCount={treeCounts.folders}
            tags={tags}
            activeVault={settings.vaults.find((v) => v.path === settings.notes_directory)}
            onNewNote={triggerNewNote}
            onNewFolder={triggerNewFolder}
            onImport={() => setShowImport(true)}
            onPanel={(p) => setActivePanel(p)}
            onSelectTag={(tag) => selectTag(tag)}
          />
        )}

        {/* Panel: Notes */}
        {activePanel === "notes" && (
          <>
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Notes</span>
              <div className="flex items-center gap-0.5">
                <button onClick={triggerNewNote} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors" title="New note">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v10M3 8h10" /></svg>
                </button>
                <button onClick={triggerNewFolder} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors" title="New folder">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h5l1.5 2H14v7H2V4z" /><path d="M8 7v4M6 9h4" /></svg>
                </button>
                <button onClick={() => setShowImport(true)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors" title="Import notes">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10v3h10v-3" /><path d="M8 2v8" /><path d="M5 7l3 3 3-3" /></svg>
                </button>
              </div>
            </div>
            <TreeView
              nodes={tree}
              selectedPath={note?.path ?? null}
              onSelectNote={handleSelectNote}
              onCreateNote={handleCreateNote}
              onCreateFolder={createFolder}
              onRename={handleRename}
              onDelete={handleDelete}
              onMove={handleMove}
              rootDir={settings.notes_directory}
            />
          </>
        )}

        {/* Panel: Favorites */}
        {activePanel === "favorites" && (
          <FavoritesPanel onSelectNote={handleSelectNote} refreshKey={favRefreshKey} />
        )}

        {/* Panel: Recent */}
        {activePanel === "recent" && (
          <RecentPanel onSelectNote={handleSelectNote} />
        )}

        {/* Panel: Tags */}
        {activePanel === "tags" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</span>
              <button
                onClick={async () => {
                  await invoke("rebuild_index");
                  await refreshTags();
                }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="Refresh"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 10a7 7 0 0113.4-2.8M17 10a7 7 0 01-13.4 2.8" />
                  <path d="M3 4v4h4M17 16v-4h-4" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <TagList
                tags={tags}
                activeTag={activeTag}
                onSelectTag={selectTag}
                tagResults={tagResults}
                onSelectNote={handleSelectNote}
              />
            </div>
          </div>
        )}

        {/* Panel: Search */}
        {activePanel === "search" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Search</span>
            </div>
            <SearchBar
              query={query}
              setQuery={setQuery}
              results={results}
              searching={searching}
              onSelect={handleSelectNote}
              onClear={clearSearch}
            />
          </div>
        )}

        {/* Panel: Vaults */}
        {activePanel === "vaults" && (
          <VaultPicker
            vaults={settings.vaults}
            activeVault={settings.notes_directory}
            onSwitch={async () => {
              // Reload settings, tree, tags, close current note
              closeNote();
              const s = await invoke<import("./types").Settings>("get_settings");
              await updateSettings(s);
              await refreshTree();
              await refreshTags();
              clearSearch();
            }}
          />
        )}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#1e1e2e]">
          {/* Hamburger */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Toggle sidebar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M3 5h12M3 9h12M3 13h12" />
            </svg>
          </button>

          {/* Note title */}
          {activePanel === "graph" && !note ? (
            <span className="text-sm font-medium truncate">Tag Graph</span>
          ) : note ? (
            <span className="text-sm font-medium truncate">
              {note.path.split(/[/\\]/).pop()?.replace(".md", "")}
            </span>
          ) : (
            <span className="text-sm text-gray-400">No note selected</span>
          )}

          {/* Favorite toggle */}
          {note && activePanel !== "graph" && (
            <button
              onClick={async () => {
                try {
                  const nowFav = await invoke<boolean>("toggle_favorite", { path: note.path });
                  setIsFavorite(nowFav);
                  setFavRefreshKey((k) => k + 1);
                } catch (err) {
                  console.error("Failed to toggle favorite:", err);
                }
              }}
              className="p-1 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill={isFavorite ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.5"
                className={isFavorite ? "text-yellow-400" : "text-gray-400"}
              >
                <path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.3L10 14l-5 2.9 1-5.3-4-3.9 5.6-.8z" />
              </svg>
            </button>
          )}

          <div className="flex-1" />

          {/* Saving indicator */}
          {saving && (
            <span className="text-xs text-gray-400 animate-pulse">
              Saving...
            </span>
          )}

          {/* View mode toggle */}
          {note && activePanel !== "graph" && (
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1 text-xs transition-colors ${
                    viewMode === mode
                      ? "bg-accent text-white"
                      : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {mode === "edit"
                    ? "Edit"
                    : mode === "preview"
                      ? "Preview"
                      : "Split"}
                </button>
              ))}
            </div>
          )}

          {/* Share menu */}
          {note && activePanel !== "graph" && (
            <ShareMenu
              onPrint={handlePrint}
              onEmail={handleEmail}
              onExportHtml={handleExportHtml}
              onExportPdf={handleExportPdf}
            />
          )}
        </header>

        {/* Editor / Preview / Graph */}
        <main className="flex-1 overflow-hidden">
          {activePanel === "graph" ? (
            <GraphView onSelectNote={(path) => {
              handleSelectNote(path);
              setActivePanel("notes");
            }} darkMode={settings.dark_theme} />
          ) : note ? (
            <div className="flex h-full">
              {/* Editor pane */}
              {(viewMode === "edit" || viewMode === "split") && (
                <div
                  className={`h-full overflow-auto ${
                    viewMode === "split"
                      ? "w-1/2 border-r border-gray-200 dark:border-gray-700/50"
                      : "w-full"
                  }`}
                >
                  <Editor
                    content={note.content}
                    onChange={updateContent}
                    notePath={note.path}
                  />
                </div>
              )}

              {/* Preview pane */}
              {(viewMode === "preview" || viewMode === "split") && (
                <div
                  className={`h-full overflow-auto ${
                    viewMode === "split" ? "w-1/2" : "w-full"
                  }`}
                >
                  <Preview content={note.content} notePath={note.path} darkMode={settings.dark_theme} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mb-4 opacity-30"
              >
                <rect x="8" y="6" width="32" height="36" rx="3" />
                <path d="M16 16h16M16 22h16M16 28h10" />
              </svg>
              <p className="text-sm">Select or create a note to begin</p>
              <p className="text-xs mt-1 text-gray-400/60">
                Right-click in the sidebar to create notes and folders
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={async (s) => {
            await updateSettings(s);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Input dialog */}
      {inputDialog && (
        <InputDialog
          title={inputDialog.title}
          placeholder={inputDialog.placeholder}
          onConfirm={inputDialog.onConfirm}
          onCancel={() => setInputDialog(null)}
        />
      )}

      {/* Import dialog */}
      {showImport && (
        <ImportDialog
          folders={tree}
          onDone={() => {
            refreshTree();
            refreshTags();
          }}
          onClose={() => setShowImport(false)}
          dropCallbackRef={importDropCallback}
        />
      )}
    </div>
  );
}
