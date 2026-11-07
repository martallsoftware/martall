import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToCanvas,
  exportToSvg,
  MainMenu,
  getCommonBounds,
  convertToExcalidrawElements,
  getSceneVersion,
  newElementWith,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import LaserOverlay from "./LaserOverlay";
import "@excalidraw/excalidraw/index.css";
import { drawingMeta, parseScene, withDrawingMeta } from "../utils/drawing";
import { bytesToBase64, canvasesToPdf, canvasToPdf } from "../utils/pdf";
import { pageElements, pageFrames, pageTitle } from "../utils/pages";
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
  updateObsidianMarkdown,
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

type ExportKind = "excalidraw" | "obsidian" | "png" | "svg" | "pdf" | "pdf-pages";

const EXPORTS: Record<ExportKind, { label: string; ext: string; suffix: string }> = {
  excalidraw: { label: "Excalidraw drawing", ext: "excalidraw", suffix: ".excalidraw" },
  obsidian: { label: "Obsidian Excalidraw note", ext: "md", suffix: ".excalidraw.md" },
  png: { label: "PNG image", ext: "png", suffix: ".png" },
  svg: { label: "SVG image", ext: "svg", suffix: ".svg" },
  pdf: { label: "PDF document", ext: "pdf", suffix: ".pdf" },
  "pdf-pages": { label: "PDF document", ext: "pdf", suffix: ".pdf" },
};

/** Up to 3× resolution, capped so huge drawings stay a sane file size. */
const pdfDimensions = (w: number, h: number) => {
  const scale = Math.max(1, Math.min(3, 6000 / Math.max(w, h)));
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Make Excalidraw pick up a new container size (it listens for window resizes). */
function remeasure(api: ExcalidrawImperativeAPI) {
  window.dispatchEvent(new Event("resize"));
  api.refresh();
}

/** Frames are the pages (and the slides in Present). */
const slideFrames = pageFrames;

/** Default size for a new page: 16:9. */
const PAGE_W = 1600;
const PAGE_H = 900;

interface Props {
  /** Drawing name, used as the default file name when exporting. */
  name: string;
  content: string;
  darkMode: boolean;
  onChange: (content: string) => void;
  /** The file is an Obsidian drawing (`.excalidraw.md`): read and save in that format. */
  obsidian?: boolean;
}

export default function DrawingView({ name, content, darkMode, onChange, obsidian = false }: Props) {
  // Latest file text, so an Obsidian drawing is saved by patching it in place.
  const fileText = useRef(content);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);

  // Parse once per mount; the parent remounts this view per file (key = path).
  // Martall's own data in the file (e.g. Mermaid source fingerprint), kept on save.
  const meta = useMemo(() => drawingMeta(content), []); // eslint-disable-line react-hooks/exhaustive-deps

  const initialData = useMemo(() => {
    let scene = parseScene(content);
    if (obsidian) {
      try {
        const s = parseDrawingFile("drawing.excalidraw.md", content);
        scene = { elements: s.elements, appState: JSON.parse(s.json).appState, files: s.files };
      } catch (err) {
        console.error("Could not read Obsidian drawing:", err);
      }
    }
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
  // Pages = frames; keep the list in state for the Pages panel.
  const [pages, setPages] = useState<any[]>([]);
  const pagesSig = useRef("");
  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      const frames = pageFrames(elements);
      const sig = frames.map((f) => `${f.id}:${f.name ?? ""}`).join("|");
      if (sig !== pagesSig.current) {
        pagesSig.current = sig;
        setPages(frames);
      }
      const key = `${getSceneVersion(elements)}|${Object.keys(files).length}|${appState.viewBackgroundColor}|${appState.gridSize}`;
      if (lastKey.current === null) {
        lastKey.current = key; // first call is the initial load
        return;
      }
      if (key === lastKey.current) return;
      lastKey.current = key;
      const json = serializeAsJSON(elements, appState, files, "local");
      const next = obsidian ? updateObsidianMarkdown(fileText.current, json) : withDrawingMeta(json, meta);
      fileText.current = next;
      onChange(next);
    },
    [onChange, meta, obsidian],
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

  // --- Present mode: read-only, full window, laser pointer, frames as slides ---
  const [presenting, setPresenting] = useState(false);
  const [presentTool, setPresentTool] = useState<"laser" | "hand">("laser");
  const [slides, setSlides] = useState<any[]>([]);
  const [slide, setSlide] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const savedFrameRendering = useRef<any>(null);

  const showSlide = useCallback((frames: any[], i: number) => {
    const api = apiRef.current;
    if (!api) return;
    // fitToViewport (unlike fitToContent) also zooms in past 100%, so a slide fills the screen.
    const fit = { fitToViewport: true, viewportZoomFactor: 0.92, animate: true, duration: 350 } as const;
    if (frames.length === 0) {
      api.scrollToContent(undefined, fit);
      return;
    }
    const idx = Math.max(0, Math.min(frames.length - 1, i));
    setSlide(idx);
    api.scrollToContent(frames[idx], fit);
  }, []);

  // Laser is our own overlay (Excalidraw pans on drag in view mode, even with
  // its laser tool); hand leaves the pointer to Excalidraw, which pans.
  const choosePresentTool = useCallback((tool: "laser" | "hand") => {
    setPresentTool(tool);
  }, []);

  /** Pan by screen pixels, or zoom by `factor` keeping screen point (x, y) still. */
  const panZoom = useCallback((dx: number, dy: number, factor: number | null, x?: number, y?: number) => {
    const api = apiRef.current;
    if (!api) return;
    const st = api.getAppState();
    const z = st.zoom.value;
    if (factor === null) {
      api.updateScene({ appState: { scrollX: st.scrollX - dx / z, scrollY: st.scrollY - dy / z } });
      return;
    }
    const z2 = Math.max(0.1, Math.min(30, z * factor));
    const px = (x ?? st.offsetLeft + st.width / 2) - st.offsetLeft;
    const py = (y ?? st.offsetTop + st.height / 2) - st.offsetTop;
    api.updateScene({
      appState: {
        zoom: { value: z2 as any },
        scrollX: st.scrollX + px * (1 / z2 - 1 / z),
        scrollY: st.scrollY + py * (1 / z2 - 1 / z),
      },
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const next = !(await win.isFullscreen());
      await win.setFullscreen(next);
      setFullscreen(next);
      setTimeout(() => apiRef.current && remeasure(apiRef.current), 300);
    } catch (err) {
      setNotice(`Full screen is not available: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const startPresenting = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const frames = slideFrames(api.getSceneElements());
    setSlides(frames);
    // Frames act as slides: clip to them and hide their outlines and titles.
    savedFrameRendering.current = api.getAppState().frameRendering;
    api.updateScene({ appState: { frameRendering: { enabled: true, clip: true, name: false, outline: false } } });
    setPresenting(true);
    setNotice(
      (frames.length ? `${frames.length} slides (frames) · ← → or Space to step\n` : "") +
        "L laser · H hand · F fit · Esc exit",
    );
    // Let view mode and the full-window layout apply (Excalidraw re-measures
    // its size on refresh), then choose the tool and frame the view.
    setTimeout(() => {
      remeasure(api);
      // The new size lands in state on the next render; frame after that.
      setTimeout(() => {
        choosePresentTool("laser");
        showSlide(frames, 0);
      }, 80);
    }, 60);
  }, [choosePresentTool, showSlide]);

  const stopPresenting = useCallback(async () => {
    const api = apiRef.current;
    setPresenting(false);
    if (api) {
      if (savedFrameRendering.current) api.updateScene({ appState: { frameRendering: savedFrameRendering.current } });
      setTimeout(() => {
        remeasure(api);
        api.setActiveTool({ type: "selection" });
      }, 60);
    }
    if (fullscreen) {
      await getCurrentWindow().setFullscreen(false).catch(() => {});
      setFullscreen(false);
    }
  }, [fullscreen]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const handled = (() => {
        switch (e.key) {
          case "ArrowRight": case "ArrowDown": case "PageDown": case " ":
            showSlide(slides, slide + 1); return true;
          case "ArrowLeft": case "ArrowUp": case "PageUp":
            showSlide(slides, slide - 1); return true;
          case "Home": showSlide(slides, 0); return true;
          case "End": showSlide(slides, slides.length - 1); return true;
          case "l": case "L": case "k": case "K": choosePresentTool("laser"); return true;
          case "h": case "H": choosePresentTool("hand"); return true;
          case "f": case "F": showSlide(slides, slide); return true;
          case "Escape": stopPresenting(); return true;
        }
        return false;
      })();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [presenting, slides, slide, showSlide, choosePresentTool, stopPresenting]);

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

  // --- Pages panel ---
  const [pagesOpen, setPagesOpen] = useState(() => {
    try {
      return localStorage.getItem("martall_pages_open") === "1";
    } catch {
      return false;
    }
  });
  const togglePages = () =>
    setPagesOpen((v) => {
      try {
        localStorage.setItem("martall_pages_open", v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  const [activePage, setActivePage] = useState(-1);

  const gotoPage = useCallback((i: number) => {
    const api = apiRef.current;
    if (!api) return;
    const frames = pageFrames(api.getSceneElements());
    if (!frames[i]) return;
    setActivePage(i);
    api.scrollToContent(frames[i], { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: 300 });
  }, []);

  /** Replace frames' names in one undoable step. */
  const renameFrames = useCallback((names: Map<string, string>) => {
    const api = apiRef.current;
    if (!api || names.size === 0) return;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e: any) =>
        names.has(e.id) && names.get(e.id) !== e.name ? newElementWith(e, { name: names.get(e.id) } as any) : e,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  const renamePage = useCallback(
    (frame: any, title: string) => {
      const num = String(frame.name ?? "").match(/^\s*(\d+(?:\.\d+)?)[.)]?\s*/)?.[1];
      const clean = title.trim();
      if (!clean) return;
      renameFrames(new Map([[frame.id, num ? `${num} ${clean}` : clean]]));
    },
    [renameFrames],
  );

  /** Move a page up/down; pages are renumbered "1 …", "2 …" so the order sticks. */
  const movePage = useCallback(
    (i: number, dir: -1 | 1) => {
      const api = apiRef.current;
      if (!api) return;
      const frames = pageFrames(api.getSceneElements());
      const j = i + dir;
      if (!frames[i] || !frames[j]) return;
      const titles = new Map(frames.map((f, k) => [f.id, pageTitle(f, k)]));
      const order = [...frames];
      [order[i], order[j]] = [order[j], order[i]];
      renameFrames(new Map(order.map((f, k) => [f.id, `${k + 1} ${titles.get(f.id)}`])));
      setActivePage(j);
    },
    [renameFrames],
  );

  /**
   * Add a page to the right of everything. The first time, what is already on
   * the canvas is put on page 1 so nothing is left outside the pages.
   */
  const addPage = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    let all = [...api.getSceneElementsIncludingDeleted()] as any[];
    const live = all.filter((e) => !e.isDeleted);
    const frames = pageFrames(live);
    const made: any[] = [];
    const frameAt = (x: number, y: number, width: number, height: number, name: string) => {
      const [f] = convertToExcalidrawElements([{ type: "frame", children: [], name } as any]);
      return newElementWith(f as any, { x, y, width, height } as any);
    };
    let n = frames.length;
    if (n === 0 && live.length > 0) {
      // Page 1 is at least the standard 16:9 page, centred on what is there.
      const [minX, minY, maxX, maxY] = getCommonBounds(live);
      const pad = 40;
      const w = Math.max(maxX - minX + 2 * pad, PAGE_W);
      const h = Math.max(maxY - minY + 2 * pad, PAGE_H);
      const first = frameAt((minX + maxX) / 2 - w / 2, (minY + maxY) / 2 - h / 2, w, h, "1 Page 1");
      all = all.map((e) => (!e.isDeleted && !e.frameId ? newElementWith(e, { frameId: first.id } as any) : e));
      made.push(first);
      n = 1;
    }
    const pagesNow = [...frames, ...made];
    const last = pagesNow[pagesNow.length - 1];
    const right = live.length || made.length ? getCommonBounds([...live, ...made])[2] : 0;
    const w = last ? last.width : PAGE_W;
    const h = last ? last.height : PAGE_H;
    made.push(frameAt(last ? right + 120 : 0, last ? last.y : 0, w, h, `${n + 1} Page ${n + 1}`));
    api.updateScene({ elements: [...all, ...made], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setPagesOpen(true);
    setTimeout(() => gotoPage(pageFrames(api.getSceneElements()).length - 1), 50);
  }, [gotoPage]);

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
        if (kind === "pdf-pages") {
          // One A4 page per frame, each cropped to its frame.
          const canvases: HTMLCanvasElement[] = [];
          for (const frame of pageFrames(elements)) {
            canvases.push(
              await exportToCanvas({
                elements: pageElements(elements, frame),
                appState: imageState,
                files,
                exportingFrame: frame,
                getDimensions: pdfDimensions,
              }),
            );
          }
          contents = bytesToBase64(await canvasesToPdf(canvases, name));
          base64 = true;
        } else if (kind === "pdf") {
          const canvas = await exportToCanvas({ elements, appState: imageState, files, getDimensions: pdfDimensions });
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
    <div
      className={
        presenting
          ? "fixed inset-0 z-[60] martall-drawing martall-presenting bg-white dark:bg-[#121212]"
          : "h-full w-full martall-drawing"
      }
    >
      <Excalidraw
        viewModeEnabled={presenting}
        zenModeEnabled={presenting}
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
        renderTopRightUI={() =>
          presenting ? null : (
            <div className="flex gap-2">
              <button
                onClick={togglePages}
                className={`whitespace-nowrap px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  pagesOpen
                    ? "border-accent text-accent bg-accent/10"
                    : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#232329] text-gray-700 dark:text-gray-200 hover:border-accent hover:text-accent"
                }`}
                title="Pages: each frame is a page"
              >
                ▤ Pages{pages.length ? ` (${pages.length})` : ""}
              </button>
              <button
                onClick={() => setMermaidOpen(true)}
                className="whitespace-nowrap px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#232329] text-gray-700 dark:text-gray-200 hover:border-accent hover:text-accent transition-colors"
                title="Convert Mermaid code into editable shapes"
              >
                Import Mermaid
              </button>
              <button
                onClick={startPresenting}
                className="whitespace-nowrap px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
                title="Read-only presentation with laser pointer; frames become slides"
              >
                ▶ Present
              </button>
            </div>
          )
        }
      >
        <MainMenu>
          {/* While presenting the drawing is read-only: no imports or clearing. */}
          {presenting ? (
            <MainMenu.Item onSelect={stopPresenting}>Exit presentation (Esc)</MainMenu.Item>
          ) : (
            <>
              <MainMenu.Item onSelect={() => setMermaidOpen(true)}>Import Mermaid…</MainMenu.Item>
              <MainMenu.Item onSelect={importFile}>Import file… (drawing or library)</MainMenu.Item>
              <MainMenu.Item onSelect={startPresenting}>▶ Present</MainMenu.Item>
            </>
          )}
          <MainMenu.Separator />
          <MainMenu.Group title="Export">
            <MainMenu.Item onSelect={() => exportAs("excalidraw")}>Excalidraw file (.excalidraw)…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("obsidian")}>Obsidian note (.excalidraw.md)…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("png")}>PNG image…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("svg")}>SVG image…</MainMenu.Item>
            <MainMenu.Item onSelect={() => exportAs("pdf")}>PDF (A4)…</MainMenu.Item>
            {pages.length > 0 && (
              <MainMenu.Item onSelect={() => exportAs("pdf-pages")}>
                PDF, one page per frame ({pages.length})…
              </MainMenu.Item>
            )}
          </MainMenu.Group>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SearchMenu />
          {!presenting && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      {pagesOpen && !presenting && (
        <PagesPanel
          pages={pages}
          active={activePage}
          onGoto={gotoPage}
          onRename={renamePage}
          onMove={movePage}
          onAdd={addPage}
          onClose={togglePages}
        />
      )}

      {presenting && presentTool === "laser" && (
        <LaserOverlay onWheel={({ dx, dy, zoom, x, y }) => panZoom(dx, dy, zoom, x, y)} />
      )}

      {presenting && (
        <PresentBar
          tool={presentTool}
          onTool={choosePresentTool}
          slide={slide}
          slideCount={slides.length}
          onPrev={() => showSlide(slides, slide - 1)}
          onNext={() => showSlide(slides, slide + 1)}
          onFit={() => showSlide(slides, slide)}
          onZoom={(factor) => panZoom(0, 0, factor)}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
          onExit={stopPresenting}
        />
      )}

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

interface PresentBarProps {
  tool: "laser" | "hand";
  onTool: (tool: "laser" | "hand") => void;
  slide: number;
  slideCount: number;
  onPrev: () => void;
  onNext: () => void;
  onFit: () => void;
  onZoom: (factor: number) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onExit: () => void;
}

/** Floating toolbar shown while presenting a drawing. */
function PresentBar(p: PresentBarProps) {
  const btn = (active = false) =>
    `h-9 min-w-9 px-2 flex items-center justify-center rounded-lg text-sm transition-colors ${
      active ? "bg-accent text-white" : "text-gray-700 dark:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-white/10"
    }`;
  const sep = <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-1 px-2 py-1.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white/95 dark:bg-[#232329]/95 shadow-xl">
      <button className={btn(p.tool === "laser")} onClick={() => p.onTool("laser")} title="Laser pointer (L)">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="14.5" cy="5.5" r="2.5" fill="currentColor" stroke="none" />
          <path d="M3 17l8.5-8.5" />
          <path d="M13 1.5v1M18.5 5.5h-1M17.5 2.5l-.7.7" />
        </svg>
      </button>
      <button className={btn(p.tool === "hand")} onClick={() => p.onTool("hand")} title="Hand: drag to pan (H)">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10V4.5a1.25 1.25 0 0 1 2.5 0V9M9.5 8.5V3.25a1.25 1.25 0 0 1 2.5 0V9M12 8.5V4.5a1.25 1.25 0 0 1 2.5 0v6.5a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2l-2.2-3.1a1.3 1.3 0 0 1 2-1.6L7 13" />
        </svg>
      </button>
      {sep}
      {p.slideCount > 0 && (
        <>
          <button className={btn()} onClick={p.onPrev} disabled={p.slide === 0} title="Previous slide (←)">◀</button>
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 px-1 select-none">
            {p.slide + 1} / {p.slideCount}
          </span>
          <button className={btn()} onClick={p.onNext} disabled={p.slide >= p.slideCount - 1} title="Next slide (→ or Space)">▶</button>
          {sep}
        </>
      )}
      <button className={btn()} onClick={() => p.onZoom(1 / 1.2)} title="Zoom out">−</button>
      <button className={btn()} onClick={p.onFit} title={p.slideCount ? "Fit slide (F)" : "Fit drawing (F)"}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>
      </button>
      <button className={btn()} onClick={() => p.onZoom(1.2)} title="Zoom in">+</button>
      {sep}
      <button className={btn(p.fullscreen)} onClick={p.onFullscreen} title="Full screen">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
          <path d="M7 17h6M10 13.5V17" />
          {p.fullscreen && <path d="M8 7l4 3M12 7l-4 3" />}
        </svg>
      </button>
      <button className={btn()} onClick={p.onExit} title="Exit presentation (Esc)">
        <span className="text-xs px-1">Exit</span>
      </button>
    </div>
  );
}

interface PagesPanelProps {
  pages: any[];
  active: number;
  onGoto: (i: number) => void;
  onRename: (frame: any, title: string) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onAdd: () => void;
  onClose: () => void;
}

/** List of the drawing's pages (frames): jump, rename, reorder, add. */
function PagesPanel({ pages, active, onGoto, onRename, onMove, onAdd, onClose }: PagesPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <div className="absolute top-16 right-3 z-20 w-60 max-h-[calc(100%-9rem)] flex flex-col rounded-xl border border-gray-300 dark:border-gray-600 bg-white/95 dark:bg-[#232329]/95 shadow-lg text-sm text-gray-700 dark:text-gray-200">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="font-semibold text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Pages</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Hide pages">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {pages.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
            No pages yet. <b>Add page</b> puts what is on the canvas on page 1 and adds page 2. Each page is a
            frame; you can also draw frames with the frame tool (F).
          </p>
        ) : (
          pages.map((f, i) => (
            <div
              key={f.id}
              className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
                i === active ? "bg-accent/15 text-accent" : "hover:bg-gray-100 dark:hover:bg-white/5"
              }`}
              onClick={() => onGoto(i)}
              onDoubleClick={() => {
                setEditing(f.id);
                setDraft(pageTitle(f, i));
              }}
              title="Click to go there · double-click to rename"
            >
              <span className="w-5 text-right text-xs tabular-nums text-gray-400">{i + 1}</span>
              {editing === f.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      onRename(f, draft);
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onBlur={() => {
                    onRename(f, draft);
                    setEditing(null);
                  }}
                  className="flex-1 min-w-0 px-1 py-0 text-sm rounded border border-accent bg-white dark:bg-[#16162a] outline-none"
                />
              ) : (
                <span className="flex-1 truncate">{pageTitle(f, i)}</span>
              )}
              <span className="hidden group-hover:flex gap-0.5 text-gray-400">
                <button
                  onClick={(e) => { e.stopPropagation(); onMove(i, -1); }}
                  disabled={i === 0}
                  className="px-1 hover:text-accent disabled:opacity-30"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onMove(i, 1); }}
                  disabled={i === pages.length - 1}
                  className="px-1 hover:text-accent disabled:opacity-30"
                  title="Move down"
                >
                  ↓
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      <button
        onClick={onAdd}
        className="m-2 px-3 py-1.5 text-xs rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:border-accent hover:text-accent"
      >
        + Add page
      </button>
    </div>
  );
}
