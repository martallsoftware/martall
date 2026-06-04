import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SearchResult, TagInfo } from "../types";

export type SearchScope = "current" | "all";

export function useSearch() {
  const [query, setQuery] = useState("");
  const [scope, setScopeState] = useState<SearchScope>("current");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setScope = useCallback((next: SearchScope) => {
    setScopeState((prev) => {
      if (next === prev) return prev;
      if (next === "all") {
        invoke("sync_all_vault_indexes").catch((err) =>
          console.error("Failed to sync inactive vault indexes:", err),
        );
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    const cmd = scope === "all" ? "search_all_vaults" : "search_notes";
    timerRef.current = setTimeout(async () => {
      try {
        const res = await invoke<SearchResult[]>(cmd, { query: query.trim() });
        setResults(res);
      } catch (err) {
        console.error("Search failed:", err);
        setResults([]);
      }
      setSearching(false);
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, scope]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
  }, []);

  return { query, setQuery, results, searching, clearSearch, scope, setScope };
}

export function useTags() {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);

  const refreshTags = useCallback(async () => {
    try {
      const t = await invoke<TagInfo[]>("get_all_tags");
      setTags(t);
    } catch (err) {
      console.error("Failed to get tags:", err);
    }
  }, []);

  useEffect(() => {
    refreshTags();
  }, [refreshTags]);

  const selectTag = useCallback(async (tag: string | null) => {
    setActiveTag((prev) => {
      if (tag === prev || !tag) {
        setTagResults([]);
        return null;
      }
      invoke<SearchResult[]>("get_notes_by_tag", { tag })
        .then((res) => setTagResults(res))
        .catch((err) => {
          console.error("Failed to get notes by tag:", err);
          setTagResults([]);
        });
      return tag;
    });
  }, []);

  return { tags, activeTag, selectTag, tagResults, refreshTags };
}
