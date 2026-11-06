import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToSvg } from "@excalidraw/excalidraw";
import { parseScene } from "../utils/drawing";

interface Props {
  path: string;
  title: string;
  dark: boolean;
  onOpen?: () => void;
}

/** Read-only picture of a `.excalidraw` file, shown for `![[Drawing]]` in notes. */
export default function DrawingEmbed({ path, title, dark, onOpen }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const note = await invoke<{ content: string }>("read_note", { path });
        const scene = parseScene(note.content);
        const live = scene.elements.filter((e) => !e.isDeleted);
        if (live.length === 0) {
          if (!cancelled) setError("Empty drawing");
          return;
        }
        const el = await exportToSvg({
          elements: live,
          appState: { ...scene.appState, exportBackground: false, exportWithDarkMode: dark, exportPadding: 16 },
          files: scene.files,
        });
        el.removeAttribute("width");
        el.removeAttribute("height");
        el.style.width = "100%";
        el.style.height = "auto";
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
  }, [path, dark]);

  return (
    <div className="my-3 group relative rounded-lg border border-gray-300/50 dark:border-gray-700/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-300/40 dark:border-gray-700/40">
        <span>✏️ {title}</span>
        {onOpen && (
          <button onClick={onOpen} className="text-accent hover:underline">
            Open drawing
          </button>
        )}
      </div>
      {error ? (
        <div className="p-4 text-xs text-gray-400">{error}</div>
      ) : svg ? (
        <div
          className="p-2 cursor-pointer"
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
