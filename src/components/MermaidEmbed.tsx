import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MermaidBlock from "./MermaidBlock";
import type { EmbedSize } from "../utils/drawing";

interface Props {
  path: string;
  title: string;
  dark: boolean;
  onOpen?: () => void;
  /** From `![[Name|300]]` etc.: a compact diagram without the header bar. */
  size?: EmbedSize | null;
}

/** A `.mmd` file shown inside a note for `![[Name]]`. */
export default function MermaidEmbed({ path, title, dark, onOpen, size }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<{ content: string }>("read_note", { path })
      .then((n) => !cancelled && setCode(n.content))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (size) {
    return (
      <span
        className="martall-sized-embed inline-block my-2 align-top max-w-full cursor-pointer"
        style={{ width: size.width, ["--embed-max-h" as string]: size.maxHeight ?? "none" }}
        onDoubleClick={onOpen}
        title={`${title} — double-click to open`}
      >
        {error ? <span className="text-xs text-red-400">{error}</span> : code !== null && <MermaidBlock chart={code} dark={dark} />}
      </span>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-gray-300/50 dark:border-gray-700/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-300/40 dark:border-gray-700/40">
        <span>⇄ {title}</span>
        {onOpen && (
          <button onClick={onOpen} className="text-accent hover:underline">
            Open diagram
          </button>
        )}
      </div>
      <div className="px-2">
        {error ? (
          <div className="p-4 text-xs text-red-400">{error}</div>
        ) : code === null ? (
          <div className="p-4 text-center text-xs text-gray-400 animate-pulse">Loading diagram…</div>
        ) : (
          <MermaidBlock chart={code} dark={dark} />
        )}
      </div>
    </div>
  );
}
