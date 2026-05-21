import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

interface Props {
  vaultRoot: string;
  onSelectNote: (path: string) => void;
  onClose: () => void;
}

/**
 * Score a title against a query. Lower is better; null means no match.
 * Order of preference: exact, prefix, substring, then subsequence.
 */
function score(title: string, query: string): number | null {
  if (!query) return 0;
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return -1000;
  if (t.startsWith(q)) return -500 + (t.length - q.length);
  const sub = t.indexOf(q);
  if (sub !== -1) return -100 + sub;

  let ti = 0;
  let qi = 0;
  let firstMatch = -1;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (firstMatch < 0) firstMatch = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return null;
  return firstMatch;
}

function relativeFolder(absPath: string, root: string): string {
  let p = absPath;
  if (root && p.startsWith(root)) p = p.slice(root.length).replace(/^[\\/]+/, "");
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash > 0 ? p.slice(0, lastSlash) : "";
}

export default function QuickSwitcher({ vaultRoot, onSelectNote, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [recents, setRecents] = useState<NoteInfo[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<NoteInfo[]>("get_all_notes_sorted", { sortBy: "title", ascending: true })
      .then(setNotes)
      .catch(() => setNotes([]));
    invoke<NoteInfo[]>("get_recent_notes", { limit: 8 })
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<NoteInfo[]>(() => {
    const q = query.trim();
    if (!q) return recents;
    const ranked: { n: NoteInfo; s: number }[] = [];
    for (const n of notes) {
      const s = score(n.title, q);
      if (s !== null) ranked.push({ n, s });
    }
    ranked.sort((a, b) => a.s - b.s || a.n.title.localeCompare(b.n.title));
    return ranked.slice(0, 30).map((r) => r.n);
  }, [notes, recents, query]);

  useEffect(() => {
    if (index >= results.length) setIndex(0);
  }, [results.length, index]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-qs-index="${index}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const accept = (n: NoteInfo) => {
    onSelectNote(n.path);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : Math.min(i + 1, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[index]) accept(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,90vw)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#252538] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={recents.length > 0 && !query ? "Find a note — recents shown below" : "Find a note..."}
          spellCheck={false}
          className="w-full px-4 py-3 bg-transparent outline-none text-base text-gray-800 dark:text-gray-200 placeholder-gray-400 border-b border-gray-200 dark:border-gray-700"
        />

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No matches</div>
          ) : (
            results.map((n, i) => {
              const folder = relativeFolder(n.path, vaultRoot);
              const active = i === index;
              return (
                <button
                  key={n.path}
                  data-qs-index={i}
                  onMouseEnter={() => setIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(n)}
                  className={`block w-full text-left px-4 py-2 transition-colors ${
                    active
                      ? "bg-accent/15"
                      : "hover:bg-gray-100 dark:hover:bg-gray-700/50"
                  }`}
                >
                  <div
                    className={`text-sm truncate ${
                      active
                        ? "text-accent font-medium"
                        : "text-gray-800 dark:text-gray-200"
                    }`}
                  >
                    {n.title}
                  </div>
                  {folder && (
                    <div className="text-xs text-gray-400 truncate">{folder}</div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-200 dark:border-gray-700 flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
