import { useRef, useEffect } from "react";
import type { SearchResult } from "../types";

interface Props {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  searching: boolean;
  onSelect: (path: string) => void;
  onClear: () => void;
}

export default function SearchBar({
  query,
  setQuery,
  results,
  searching,
  onSelect,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        onClear();
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClear]);

  const showResults = query.trim().length > 0;

  return (
    <div className="px-2 pt-2 pb-1">
      <div className="relative">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        >
          <circle cx="6.5" cy="6.5" r="5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes... (Cmd+K)"
          className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder-gray-400"
        />
        {query && (
          <button
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
          >
            &times;
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showResults && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#252538] shadow-lg">
          {searching && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400 text-center animate-pulse">
              Searching...
            </div>
          )}
          {!searching && results.length === 0 && query.trim() && (
            <div className="px-3 py-3 text-xs text-gray-400 text-center">
              No results found
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.path}
              onClick={() => {
                onSelect(r.path);
                onClear();
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700/50 last:border-0"
            >
              <p className="text-xs font-medium truncate">{r.title}</p>
              <p
                className="text-[10px] text-gray-400 mt-0.5 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
