import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

interface Props {
  onSelectNote: (path: string) => void;
}

type SortBy = "updated" | "created" | "title";

function formatDate(unix: number): string {
  if (unix === 0) return "—";
  const d = new Date(unix * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const noteDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (today.getTime() - noteDay.getTime()) / 86400000,
  );

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return `${diffDays}d ago ${time}`;

  return d.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  }) + ` ${time}`;
}

export default function RecentPanel({ onSelectNote }: Props) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("updated");
  const [ascending, setAscending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<NoteInfo[]>("get_all_notes_sorted", {
        sortBy,
        ascending,
      });
      setNotes(result);
    } catch (err) {
      console.error("Failed to get notes:", err);
    }
  }, [sortBy, ascending]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header with sort controls */}
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          All Notes ({notes.length})
        </span>
        <div className="flex gap-1">
          {(
            [
              ["updated", "Modified"],
              ["created", "Created"],
              ["title", "Name"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                if (sortBy === key) {
                  setAscending(!ascending);
                } else {
                  setSortBy(key);
                  setAscending(key === "title");
                }
              }}
              className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                sortBy === key
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {label}
              {sortBy === key && (
                <span className="ml-0.5">{ascending ? "↑" : "↓"}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto py-1">
        {notes.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            No notes yet.
          </div>
        )}
        {notes.map((n) => (
          <button
            key={n.path}
            onClick={() => onSelectNote(n.path)}
            className="w-full text-left px-3 py-2 hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors border-b border-gray-100 dark:border-gray-800/30 last:border-0"
          >
            <div className="flex items-center gap-1.5">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400 flex-shrink-0"
              >
                <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
                <path d="M6 5h4M6 8h4M6 11h2" />
              </svg>
              <span className="text-xs font-medium truncate">{n.title}</span>
            </div>
            <div className="flex gap-3 mt-0.5 ml-5">
              <span className="text-[10px] text-gray-400">
                <span className="text-gray-400/60">Created </span>
                {formatDate(n.created_at)}
              </span>
              <span className="text-[10px] text-gray-400">
                <span className="text-gray-400/60">Modified </span>
                {formatDate(n.updated_at)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
