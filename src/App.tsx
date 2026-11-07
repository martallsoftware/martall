import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings, useTree, useNote, useNodeOps } from "./hooks/useTauri";
import { useSearch, useTags } from "./hooks/useSearch";
import TreeView from "./components/TreeView";
import Editor, { type EditorHandle } from "./components/Editor";
import DashboardView, { isDashboardNote } from "./components/DashboardView";
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
import QuickSwitcher from "./components/QuickSwitcher";
import CalendarPanel from "./components/CalendarPanel";
import TasksPanel from "./components/TasksPanel";
import type { TreeNode } from "./types";
import { DRAWING_TEMPLATE, drawingMeta, isDrawingPath, linkDrawingInNote, mermaidKey, mermaidToElements, sceneJson, withDrawingMeta } from "./utils/drawing";
import {
  addToUserLibrary,
  createDrawingUnique,
  importExcalidrawFiles,
  INSERT_SCENE_EVENT,
  isDrawingImportPath,
  isLibraryPath,
  parseDrawingFile,
  parseLibraryFile,
} from "./utils/drawingImport";
import CloseDrawingDialog, { type CloseDrawingChoice } from "./components/CloseDrawingDialog";

// Excalidraw is large; load the drawing editor only when a drawing opens.
const DrawingView = lazy(() => import("./components/DrawingView"));

type ViewMode = "edit" | "preview" | "split" | "dashboard";

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
  const { note, saving, openNote, updateContent, closeNote } = useNote(() => {
    refreshTags();
    refreshTree(); // a note's type (icon) can change when it is edited
    setTasksRefreshKey((k) => k + 1);
  });
  const { createFolder, createNote, renameNode, deleteNode, moveNode } =
    useNodeOps(refreshTree);
  const { query, setQuery, results, searching, clearSearch, scope, setScope } = useSearch();

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sidebar width: drag the handle on its right edge; double-click resets.
  const SIDEBAR_DEFAULT = 240;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const w = Number(localStorage.getItem("martall_sidebar_width"));
      return w >= 180 && w <= 640 ? w : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const saveSidebarWidth = (w: number) => {
    try {
      localStorage.setItem("martall_sidebar_width", String(w));
    } catch {
      /* ignore */
    }
  };
  const startSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let last = startW;
    setResizingSidebar(true);
    const onMove = (ev: MouseEvent) => {
      last = Math.min(640, Math.max(180, startW + ev.clientX - startX));
      setSidebarWidth(last);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingSidebar(false);
      saveSidebarWidth(last);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  const isDashboard = useMemo(
    () => (note ? isDashboardNote(note.content) : false),
    [note],
  );

  // Auto-switch to dashboard view when a dashboard note opens,
  // and back to split when a non-dashboard note opens.
  useEffect(() => {
    if (isDashboard && viewMode !== "dashboard") setViewMode("dashboard");
    if (!isDashboard && viewMode === "dashboard") setViewMode("split");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDashboard, note?.path]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favRefreshKey, setFavRefreshKey] = useState(0);
  const [dailyRefreshKey, setDailyRefreshKey] = useState(0);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Hydrate split ratio from settings once loaded
  useEffect(() => {
    if (loaded && typeof settings.split_ratio === "number") {
      setSplitRatio(settings.split_ratio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const persistSplitRatio = useCallback(
    (ratio: number) => {
      updateSettings({ ...settingsRef.current, split_ratio: ratio });
    },
    [updateSettings],
  );

  const startSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let lastRatio = splitRatio;
    const onMove = (ev: MouseEvent) => {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      lastRatio = Math.min(0.85, Math.max(0.15, ratio));
      setSplitRatio(lastRatio);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistSplitRatio(lastRatio);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [splitRatio, persistSplitRatio]);
  const [activePanel, setActivePanel] = useState<SidebarPanel>("notes");
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    placeholder: string;
    withTemplates?: boolean;
    onConfirm: (val: string, template?: string, answers?: Record<string, string>) => void;
  } | null>(null);

  // Refs for drag-drop handler to access latest state
  const noteRef = useRef(note);
  noteRef.current = note;
  const showImportRef = useRef(showImport);
  showImportRef.current = showImport;
  // Callback ref: when import dialog is open, it registers here to receive dropped files
  const importDropCallback = useRef<((files: string[]) => void) | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  // The drop handler below is set up before handleSelectNote exists.
  const handleSelectNoteRef = useRef<(path: string) => Promise<void>>(async () => {});

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
      const excalidrawFiles: string[] = [];

      for (const filePath of event.payload.paths) {
        const lower = filePath.toLowerCase();
        // Before ".md": Obsidian drawings end in ".excalidraw.md".
        if (isDrawingImportPath(filePath) || isLibraryPath(filePath)) {
          excalidrawFiles.push(filePath);
        } else if (lower.endsWith(".md")) {
          mdFiles.push(filePath);
        } else if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          imageFiles.push(filePath);
        }
      }

      // Import dialog open: it collects every dropped file.
      if (showImportRef.current && importDropCallback.current && excalidrawFiles.length > 0) {
        importDropCallback.current(excalidrawFiles);
      } else if (excalidrawFiles.length > 0) {
        const current = noteRef.current;
        if (current && isDrawingPath(current.path)) {
          // A drawing is open: drawings go onto its canvas, libraries into its Library.
          for (const filePath of excalidrawFiles) {
            try {
              const { content } = await invoke<{ content: string }>("read_note", { path: filePath });
              if (isLibraryPath(filePath)) {
                addToUserLibrary(parseLibraryFile(content));
              } else {
                const scene = parseDrawingFile(filePath, content);
                window.dispatchEvent(
                  new CustomEvent(INSERT_SCENE_EVENT, { detail: { elements: scene.elements, files: scene.files } }),
                );
              }
            } catch (err) {
              console.error("Failed to import", filePath, err);
            }
          }
        } else {
          // Otherwise: new drawings in the vault root; open the first one.
          try {
            const res = await importExcalidrawFiles(excalidrawFiles, settingsRef.current.notes_directory);
            await refreshTree();
            refreshTags();
            if (res.imported.length > 0) await handleSelectNoteRef.current(res.imported[0].path);
            if (res.skipped.length) console.warn("Excalidraw import:", res.skipped);
          } catch (err) {
            console.error("Failed to import drawings:", err);
          }
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
      // (not into drawings: their content is scene JSON, not markdown)
      if (imageFiles.length > 0 && noteRef.current && !isDrawingPath(noteRef.current.path)) {
        for (const filePath of imageFiles) {
          try {
            const relativePath = await invoke<string>("copy_image_to_assets", {
              sourcePath: filePath,
              notePath: noteRef.current.path,
            });
            const markdown = `\n![](${relativePath})\n`;
            if (editorRef.current) {
              editorRef.current.insertAtCursor(markdown);
            } else {
              updateContent(noteRef.current.content + markdown);
            }
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

  // Sync index when app gets focus (catches changes from other devices).
  // Uses the incremental `sync_index` rather than `rebuild_index` so we don't
  // re-stamp every note's updated_at on each focus event (which would destroy
  // sort-by-updated ordering).
  useEffect(() => {
    const handleFocus = async () => {
      try {
        await invoke("sync_index");
        await refreshTree();
        await refreshTags();
      } catch (err) {
        console.error("Sync on focus failed:", err);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshTree, refreshTags]);

  // Global Cmd/Ctrl+P: toggle the quick switcher
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowQuickSwitcher((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // Breadcrumb click → show that folder/note in the tree.
  const [treeReveal, setTreeReveal] = useState<{ path: string; key: number } | null>(null);
  const revealInTree = useCallback((path: string) => {
    setActivePanel("notes");
    setSidebarOpen(true);
    setTreeReveal({ path, key: Date.now() });
  }, []);

  // Back navigation: paths of previously open notes, most recent last.
  const [backStack, setBackStack] = useState<string[]>([]);

  const handleSelectNote = useCallback(
    async (path: string, opts?: { fromBack?: boolean }) => {
      const current = noteRef.current?.path;
      if (!opts?.fromBack && current && current !== path) {
        setBackStack((s) => [...s.filter((p) => p !== current), current].slice(-50));
      }
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

  // Drawings made with "Edit as drawing": drawing path → the note + Mermaid code
  // they came from, so closing can offer to put the drawing into the note.
  const drawingOrigins = useRef(new Map<string, { notePath: string; code: string }>());
  const [closeDrawingPrompt, setCloseDrawingPrompt] = useState<{
    drawingPath: string;
    notePath: string;
    code: string;
  } | null>(null);

  /** Go back to the previous note; with no history, just close the current one. */
  const goBack = useCallback(async (opts?: { skipPrompt?: boolean }) => {
    const current = noteRef.current?.path;
    const origin = current ? drawingOrigins.current.get(current) : undefined;
    if (current && origin && !opts?.skipPrompt) {
      setCloseDrawingPrompt({ drawingPath: current, ...origin });
      return;
    }
    const prev = backStack[backStack.length - 1];
    if (!prev) {
      closeNote();
      return;
    }
    setBackStack((s) => s.slice(0, -1));
    await handleSelectNote(prev, { fromBack: true });
  }, [backStack, handleSelectNote, closeNote]);

  // Cmd/Ctrl+[ goes back (like a browser). Not in drawings: there Excalidraw
  // uses it for "send backward"; use the Back / Close buttons instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDrawingPath(noteRef.current?.path)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "[") {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  handleSelectNoteRef.current = (path) => handleSelectNote(path);

  const handleSelectSearchResult = useCallback(
    async (result: import("./types").SearchResult) => {
      const target = result.vault_path;
      if (target && target !== settingsRef.current.notes_directory) {
        try {
          await invoke("switch_vault", { path: target });
          closeNote();
          const s = await invoke<import("./types").Settings>("get_settings");
          await updateSettings(s);
          await refreshTree();
          await refreshTags();
        } catch (err) {
          console.error("Failed to switch vault:", err);
          return;
        }
      }
      await handleSelectNote(result.path);
    },
    [handleSelectNote, closeNote, updateSettings, refreshTree, refreshTags],
  );

  const handleSelectDay = useCallback(
    async (date: string) => {
      try {
        const path = await invoke<string>("open_or_create_daily_note", { date });
        await handleSelectNote(path);
        await refreshTree();
        setDailyRefreshKey((k) => k + 1);
      } catch (err) {
        console.error("Failed to open daily note:", err);
      }
    },
    [handleSelectNote, refreshTree],
  );

  // Global Cmd/Ctrl+Shift+D: jump to today's daily note
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const d = new Date();
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        handleSelectDay(ymd);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSelectDay]);

  const handleCreateNote = useCallback(
    async (parentDir: string, name: string, template?: string, answers?: Record<string, string>) => {
      // "✏️ Excalidraw drawing" in the template list: a drawing, not a note.
      if (template === DRAWING_TEMPLATE) {
        const path = await createDrawingUnique(parentDir, name.replace(/\.(md|excalidraw)$/i, ""), sceneJson());
        await refreshTree();
        await handleSelectNote(path);
        return;
      }
      const newPath = await createNote(parentDir, name, template, answers);
      await openNote(newPath);
      refreshTags();
    },
    [createNote, openNote, refreshTags, refreshTree, handleSelectNote],
  );

  /** Create `<name>.excalidraw` (adding " 2", " 3"… if taken) and open it. */
  const handleCreateDrawing = useCallback(
    async (parentDir: string, name: string, content = sceneJson()) => {
      const path = await createDrawingUnique(parentDir, name, content);
      await refreshTree();
      await handleSelectNote(path);
      return path;
    },
    [refreshTree, handleSelectNote],
  );

  const treeRef = useRef(tree);
  treeRef.current = tree;

  /**
   * "Edit as drawing" on a mermaid block: reopen the drawing made earlier from
   * the same Mermaid code (same folder), or create one next to the note.
   */
  const handleMermaidToDrawing = useCallback(
    async (code: string) => {
      const current = noteRef.current;
      if (!current) return;
      const dir = current.path.replace(/[/\\][^/\\]*$/, "");
      const title = current.path.split(/[/\\]/).pop()!.replace(/\.md$/i, "");
      const key = mermaidKey(code);

      const siblings = (function find(nodes: TreeNode[]): TreeNode[] | null {
        if (dir === settingsRef.current.notes_directory.replace(/[/\\]+$/, "")) return nodes;
        for (const n of nodes) {
          if (!n.is_folder) continue;
          if (n.path === dir) return n.children;
          const r = find(n.children);
          if (r) return r;
        }
        return null;
      })(treeRef.current) ?? [];
      for (const n of siblings) {
        if (n.is_folder || !isDrawingPath(n.path)) continue;
        try {
          const { content } = await invoke<{ content: string }>("read_note", { path: n.path });
          if (drawingMeta(content).mermaid === key) {
            drawingOrigins.current.set(n.path, { notePath: current.path, code });
            await handleSelectNote(n.path);
            return;
          }
        } catch {
          /* unreadable file: skip */
        }
      }

      const { elements, files } = await mermaidToElements(code);
      const content = withDrawingMeta(
        JSON.stringify({ ...JSON.parse(sceneJson(elements)), files }),
        { mermaid: key },
      );
      const drawingPath = await handleCreateDrawing(dir, `${title} diagram`, content);
      drawingOrigins.current.set(drawingPath, { notePath: current.path, code });
    },
    [handleCreateDrawing, handleSelectNote],
  );

  /** Answer to the "Update note?" prompt shown when closing such a drawing. */
  const finishCloseDrawing = useCallback(
    async (choice: CloseDrawingChoice) => {
      const prompt = closeDrawingPrompt;
      setCloseDrawingPrompt(null);
      if (!prompt) return;
      drawingOrigins.current.delete(prompt.drawingPath);
      if (choice !== "close") {
        try {
          const name = prompt.drawingPath.split(/[/\\]/).pop()!.replace(/\.excalidraw$/i, "");
          const { content } = await invoke<{ content: string }>("read_note", { path: prompt.notePath });
          const updated = linkDrawingInNote(content, prompt.code, name, choice);
          // If the Mermaid block was edited meanwhile, add the drawing at the end instead.
          const next = updated ?? `${content.replace(/\s*$/, "")}\n\n![[${name}]]\n`;
          await invoke("save_note", { path: prompt.notePath, content: next });
        } catch (err) {
          console.error("Failed to update note with drawing:", err);
        }
      }
      // Return to the note (it is normally the top of the back stack).
      setBackStack((s) => (s[s.length - 1] === prompt.notePath ? s.slice(0, -1) : s));
      await handleSelectNote(prompt.notePath, { fromBack: true });
    },
    [closeDrawingPrompt, handleSelectNote],
  );

  const handleRename = useCallback(
    async (oldPath: string, newName: string) => {
      const newPath = await renameNode(oldPath, newName);
      setBackStack((s) => s.map((p) => (p === oldPath ? newPath : p)));
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
      setBackStack((s) => s.filter((p) => p !== path && !p.startsWith(path + "/")));
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
      withTemplates: true,
      onConfirm: async (name, template, answers) => {
        setInputDialog(null);
        await handleCreateNote(currentFolder, name, template, answers);
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
        className={`relative flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#1e1e2e] ${
          resizingSidebar ? "" : "transition-all duration-200"
        } ${sidebarOpen ? "" : "overflow-hidden"}`}
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        {/* Resize handle */}
        {sidebarOpen && (
          <div
            onMouseDown={startSidebarDrag}
            onDoubleClick={() => {
              setSidebarWidth(SIDEBAR_DEFAULT);
              saveSidebarWidth(SIDEBAR_DEFAULT);
            }}
            title="Drag to resize — double-click to reset"
            className={`absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/50 ${
              resizingSidebar ? "bg-accent/60" : ""
            }`}
          />
        )}
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
              reveal={treeReveal}
              onSetWeights={async (updates) => {
                await invoke("set_weights", { updates });
                await refreshTree();
              }}
              onCreateDrawing={async (dir, name) => { await handleCreateDrawing(dir, name); }}
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

        {/* Panel: Calendar */}
        {activePanel === "calendar" && (
          <CalendarPanel
            onSelectDay={handleSelectDay}
            refreshKey={dailyRefreshKey}
          />
        )}

        {/* Panel: Tasks */}
        {activePanel === "tasks" && (
          <TasksPanel
            onSelectNote={handleSelectNote}
            refreshKey={tasksRefreshKey}
          />
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
              onSelect={handleSelectSearchResult}
              onClear={clearSearch}
              scope={scope}
              setScope={setScope}
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

          {/* Back to the previous note */}
          {note && backStack.length > 0 && activePanel !== "graph" && (
            <button
              onClick={() => goBack()}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-accent transition-colors flex-shrink-0"
              title={`Back to ${backStack[backStack.length - 1].split(/[\\/]/).pop()?.replace(/\.(md|excalidraw)$/, "")} (⌘[)`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
              Back
            </button>
          )}

          {/* Note title / breadcrumb */}
          {activePanel === "graph" && !note ? (
            <span className="text-sm font-medium truncate">Tag Graph</span>
          ) : note ? (
            (() => {
              const root = settings.notes_directory;
              let rel = note.path;
              if (root && rel.startsWith(root)) {
                rel = rel.slice(root.length).replace(/^[\\/]+/, "");
              }
              const parts = rel.split(/[\\/]/);
              const filename = (parts.pop() || "").replace(/\.(md|excalidraw)$/, "");
              return (
                <div className="flex items-center gap-1 min-w-0 text-sm truncate">
                  {parts.map((folder, i) => (
                    <span key={i} className="flex items-center gap-1 text-gray-400 dark:text-gray-500 truncate">
                      <button
                        onClick={() => revealInTree(`${root.replace(/[\\/]+$/, "")}/${parts.slice(0, i + 1).join("/")}`)}
                        className="truncate hover:text-accent hover:underline transition-colors"
                        title={`Show “${folder}” in the tree`}
                      >
                        {folder}
                      </button>
                      <span className="text-gray-300 dark:text-gray-600">›</span>
                    </span>
                  ))}
                  <button
                    onClick={() => revealInTree(note.path)}
                    className="font-medium truncate hover:text-accent transition-colors"
                    title="Show in the tree"
                  >
                    {filename}
                  </button>
                </div>
              );
            })()
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

          {/* Refresh data button */}
          <button
            onClick={async () => {
              if (refreshing) return;
              setRefreshing(true);
              try {
                await invoke("rebuild_index");
                await refreshTree();
                await refreshTags();
                setFavRefreshKey((k) => k + 1);
                if (noteRef.current) {
                  await openNote(noteRef.current.path);
                }
              } catch (err) {
                console.error("Refresh failed:", err);
              } finally {
                setRefreshing(false);
              }
            }}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
            title="Refresh — reload files and index from disk"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""}
            >
              <path d="M3 10a7 7 0 0 1 12-4.9L17 7" />
              <path d="M17 3v4h-4" />
              <path d="M17 10a7 7 0 0 1-12 4.9L3 13" />
              <path d="M3 17v-4h4" />
            </svg>
          </button>

          {/* Saving indicator */}
          {saving && (
            <span className="text-xs text-gray-400 animate-pulse">
              Saving...
            </span>
          )}

          {/* View mode toggle */}
          {note && activePanel !== "graph" && !isDrawingPath(note.path) && (
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              {((isDashboard
                ? (["edit", "split", "preview", "dashboard"] as ViewMode[])
                : (["edit", "split", "preview"] as ViewMode[])
              )).map((mode) => (
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
                      : mode === "dashboard"
                        ? "Dashboard"
                        : "Split"}
                </button>
              ))}
            </div>
          )}

          {/* Share menu */}
          {note && activePanel !== "graph" && !isDrawingPath(note.path) && (
            <ShareMenu
              onPrint={handlePrint}
              onEmail={handleEmail}
              onExportHtml={handleExportHtml}
              onExportPdf={handleExportPdf}
            />
          )}

          {/* Close a drawing: back to the note it was opened from */}
          {note && activePanel !== "graph" && isDrawingPath(note.path) && (
            <button
              onClick={() => goBack()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:border-accent hover:text-accent transition-colors"
              title={backStack.length ? "Close and go back to the previous note" : "Close drawing"}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
              Close
            </button>
          )}
        </header>

        {/* Editor / Preview / Graph */}
        <main className="flex-1 overflow-hidden">
          {activePanel === "graph" ? (
            <GraphView onSelectNote={(path) => {
              handleSelectNote(path);
              setActivePanel("notes");
            }} darkMode={settings.dark_theme} />
          ) : note && isDrawingPath(note.path) ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading drawing…</div>
              }
            >
              <DrawingView
                key={note.path}
                name={note.path.split(/[/\\]/).pop()!.replace(/\.excalidraw$/i, "")}
                content={note.content}
                darkMode={settings.dark_theme}
                onChange={updateContent}
              />
            </Suspense>
          ) : note && viewMode === "dashboard" ? (
            <DashboardView
              content={note.content}
              notePath={note.path}
              darkMode={settings.dark_theme}
            />
          ) : note ? (
            <div ref={splitContainerRef} className="flex h-full">
              {/* Editor pane */}
              {(viewMode === "edit" || viewMode === "split") && (
                <div
                  className="h-full overflow-auto"
                  style={{ width: viewMode === "split" ? `${splitRatio * 100}%` : "100%" }}
                >
                  <Editor
                    ref={editorRef}
                    content={note.content}
                    onChange={updateContent}
                    notePath={note.path}
                  />
                </div>
              )}

              {/* Draggable splitter */}
              {viewMode === "split" && (
                <div
                  onMouseDown={startSplitDrag}
                  onDoubleClick={() => { setSplitRatio(0.5); persistSplitRatio(0.5); }}
                  title="Drag to resize — double-click to reset"
                  className="w-1 cursor-col-resize bg-gray-200 dark:bg-gray-700/50 hover:bg-accent/60 transition-colors flex-shrink-0"
                />
              )}

              {/* Preview pane */}
              {(viewMode === "preview" || viewMode === "split") && (
                <div
                  className="h-full overflow-auto"
                  style={{ width: viewMode === "split" ? `${(1 - splitRatio) * 100}%` : "100%" }}
                >
                  <Preview content={note.content} notePath={note.path} darkMode={settings.dark_theme} onOpenNote={handleSelectNote} onContentChange={updateContent} onMermaidToDrawing={handleMermaidToDrawing} />
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

      {/* "Update note?" when closing a drawing made from a Mermaid block */}
      {closeDrawingPrompt && (
        <CloseDrawingDialog
          drawingName={closeDrawingPrompt.drawingPath.split(/[/\\]/).pop()!.replace(/\.excalidraw$/i, "")}
          noteName={closeDrawingPrompt.notePath.split(/[/\\]/).pop()!.replace(/\.md$/i, "")}
          onChoose={finishCloseDrawing}
          onCancel={() => setCloseDrawingPrompt(null)}
        />
      )}

      {/* Input dialog */}
      {inputDialog && (
        <InputDialog
          title={inputDialog.title}
          placeholder={inputDialog.placeholder}
          withTemplates={inputDialog.withTemplates}
          onConfirm={inputDialog.onConfirm}
          onCancel={() => setInputDialog(null)}
        />
      )}

      {/* Quick switcher (Cmd/Ctrl+P) */}
      {showQuickSwitcher && (
        <QuickSwitcher
          vaultRoot={settings.notes_directory}
          onSelectNote={handleSelectNote}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {/* Import dialog */}
      {showImport && (
        <ImportDialog
          folders={tree}
          rootDir={settings.notes_directory}
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
