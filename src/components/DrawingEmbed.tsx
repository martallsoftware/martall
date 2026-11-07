import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToSvg } from "@excalidraw/excalidraw";
import { isObsidianDrawingPath, parseScene, type EmbedSize } from "../utils/drawing";
import { parseDrawingFile } from "../utils/drawingImport";
import { findPage, pageElements, pageFrames } from "../utils/pages";

const CARD_KEY = "martall_drawing_card";

function loadCard(): boolean {
  try {
    return localStorage.getItem(CARD_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  path: string;
  title: string;
  dark: boolean;
  onOpen?: () => void;
  /** From `![[Name|300]]` etc.: a compact picture without the header bar. */
  size?: EmbedSize | null;
  /** From `![[Name#Page]]`: show only that page (frame), by name or number. */
  page?: string;
}

/** Read-only picture of a `.excalidraw` file, shown for `![[Drawing]]` in notes. */
export default function DrawingEmbed({ path, title, dark, onOpen, size, page }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // White card: light picture on the drawing's own background (like Obsidian),
  // instead of following the app theme. One setting for all previews.
  const [card, setCard] = useState(loadCard);
  useEffect(() => {
    const sync = () => setCard(loadCard());
    window.addEventListener("martall:drawing-card", sync);
    return () => window.removeEventListener("martall:drawing-card", sync);
  }, []);
  const toggleCard = () => {
    try {
      localStorage.setItem(CARD_KEY, card ? "0" : "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("martall:drawing-card"));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const note = await invoke<{ content: string }>("read_note", { path });
        const scene = isObsidianDrawingPath(path)
          ? (() => {
              const s = parseDrawingFile(path, note.content);
              return { elements: s.elements, appState: JSON.parse(s.json).appState, files: s.files };
            })()
          : parseScene(note.content);
        let live = scene.elements.filter((e) => !e.isDeleted);
        if (live.length === 0) {
          if (!cancelled) setError("Empty drawing");
          return;
        }
        let frame: any = null;
        if (page) {
          frame = findPage(pageFrames(live), page);
          if (!frame) {
            if (!cancelled) setError(`No page “${page}” in this drawing`);
            return;
          }
          live = pageElements(live, frame);
        }
        const el = await exportToSvg({
          elements: live,
          exportingFrame: frame,
          appState: card
            ? { viewBackgroundColor: "#ffffff", ...scene.appState, exportBackground: true, exportWithDarkMode: false, exportPadding: 16 }
            : { ...scene.appState, exportBackground: false, exportWithDarkMode: dark, exportPadding: 16 },
          files: scene.files,
        });
        el.removeAttribute("width");
        el.removeAttribute("height");
        el.style.width = "100%";
        el.style.height = "auto";
        el.style.display = "block";
        if (size?.maxHeight) el.style.maxHeight = size.maxHeight;
        if (!cancelled) {
          setSvg(el.outerHTML);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, dark, card, size?.maxHeight, page]);

  const cardButton = (
    <button
      onClick={toggleCard}
      className="hover:text-accent"
      title={card ? "Show previews in the app theme" : "Show previews on a white card"}
    >
      {card ? "◐ Theme" : "▢ White card"}
    </button>
  );

  // Sized (`![[Name|300]]`): just the picture; controls appear on hover.
  if (size) {
    return (
      <span className="group relative inline-block my-2 align-top max-w-full" style={{ width: size.width }}>
        {error ? (
          <span className="block p-2 text-xs text-gray-400 border border-gray-300/50 dark:border-gray-700/60 rounded">{error}</span>
        ) : svg ? (
          <span
            className={`block cursor-pointer rounded overflow-hidden ${card ? "bg-white p-1" : ""}`}
            onDoubleClick={onOpen}
            title={`${title} — double-click to edit`}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="block p-2 text-xs text-gray-400 animate-pulse">Rendering…</span>
        )}
        <span className="absolute top-1 right-1 hidden group-hover:flex items-center gap-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-gray-200">
          {cardButton}
          {onOpen && (
            <button onClick={onOpen} className="text-accent hover:underline">
              Open
            </button>
          )}
        </span>
      </span>
    );
  }

  return (
    <div className="my-3 group relative rounded-lg border border-gray-300/50 dark:border-gray-700/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-300/40 dark:border-gray-700/40">
        <span>✏️ {title}</span>
        <span className="flex items-center gap-3">
          {cardButton}
          {onOpen && (
            <button onClick={onOpen} className="text-accent hover:underline">
              Open drawing
            </button>
          )}
        </span>
      </div>
      {error ? (
        <div className="p-4 text-xs text-gray-400">{error}</div>
      ) : svg ? (
        <div
          className={`p-2 cursor-pointer ${card ? "bg-white" : ""}`}
          onDoubleClick={onOpen}
          title="Double-click to edit"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-4 text-center text-xs text-gray-400 animate-pulse">Rendering drawing…</div>
      )}
    </div>
  );
}
