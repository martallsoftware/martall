import type { TagInfo, SearchResult } from "../types";

interface Props {
  tags: TagInfo[];
  activeTag: string | null;
  onSelectTag: (tag: string | null) => void;
  tagResults: SearchResult[];
  onSelectNote: (path: string) => void;
}

export default function TagList({
  tags,
  activeTag,
  onSelectTag,
  tagResults,
  onSelectNote,
}: Props) {
  if (tags.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-gray-400">
        No tags yet.
        <br />
        Add #tags in your notes.
      </div>
    );
  }

  return (
    <div className="p-2">
      {/* Tag pills */}
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <button
            key={tag.name}
            onClick={() =>
              onSelectTag(activeTag === tag.name ? null : tag.name)
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors ${
              activeTag === tag.name
                ? "bg-accent text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            <span>#</span>
            <span>{tag.name}</span>
            <span className="text-[9px] opacity-60">{tag.count}</span>
          </button>
        ))}
      </div>

      {/* Tag filter results */}
      {activeTag && (
        <div className="mt-3 space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 px-1">
            Notes tagged #{activeTag}
          </p>
          {tagResults.length === 0 ? (
            <p className="text-[10px] text-gray-400 px-1">No notes with this tag</p>
          ) : (
            tagResults.map((r) => (
              <button
                key={r.path}
                onClick={() => onSelectNote(r.path)}
                className="w-full text-left px-2 py-1.5 text-xs rounded-md hover:bg-gray-200/60 dark:hover:bg-gray-700/40 truncate transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1.5 text-gray-400 flex-shrink-0"><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M6 5h4M6 8h4M6 11h2" /></svg>{r.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
