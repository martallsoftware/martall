import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

interface Props {
  onSelectNote: (path: string) => void;
  refreshKey?: number;
}

export default function FavoritesPanel({ onSelectNote, refreshKey }: Props) {
  const [favorites, setFavorites] = useState<NoteInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<NoteInfo[]>("get_favorite_notes");
      setFavorites(result);
    } catch (err) {
      console.error("Failed to get favorites:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Favorites ({favorites.length})
        </span>
        <button
          onClick={refresh}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 10a7 7 0 0113.4-2.8M17 10a7 7 0 01-13.4 2.8" />
            <path d="M3 4v4h4M17 16v-4h-4" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {favorites.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-gray-400 space-y-1">
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className="mx-auto mb-2 opacity-40">
              <path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.3L10 14l-5 2.9 1-5.3-4-3.9 5.6-.8z" />
            </svg>
            <div>No favorites yet</div>
            <div className="text-gray-500">Click the star on a note to add it</div>
          </div>
        )}
        {favorites.map((n) => (
          <button
            key={n.path}
            onClick={() => onSelectNote(n.path)}
            className="w-full text-left px-3 py-2 hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors border-b border-gray-100 dark:border-gray-800/30 last:border-0"
          >
            <div className="flex items-center gap-1.5">
              <svg
                width="12"
                height="12"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="text-yellow-400 flex-shrink-0"
              >
                <path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.3L10 14l-5 2.9 1-5.3-4-3.9 5.6-.8z" />
              </svg>
              <span className="text-xs font-medium truncate">{n.title}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
