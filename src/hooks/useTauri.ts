import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TreeNode, NoteContent, Settings } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({
    notes_directory: "",
    dark_theme: true,
    vaults: [],
    split_ratio: 0.5,
    trusted_scripts: [],
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        setSettings(s);
        setLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoaded(true); // Still mark as loaded so UI renders
      });
  }, []);

  const updateSettings = useCallback(async (s: Settings) => {
    try {
      await invoke("update_settings", { newSettings: s });
      setSettings(s);
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  }, []);

  return { settings, updateSettings, loaded };
}

export function useTree() {
  const [tree, setTree] = useState<TreeNode[]>([]);

  const refreshTree = useCallback(async () => {
    try {
      const nodes = await invoke<TreeNode[]>("read_tree");
      setTree(nodes);
    } catch (err) {
      console.error("Failed to read tree:", err);
    }
  }, []);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  return { tree, refreshTree };
}

export function useNote(onAfterSave?: () => void) {
  const [note, setNote] = useState<NoteContent | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<NoteContent | null>(null);
  const onAfterSaveRef = useRef(onAfterSave);
  onAfterSaveRef.current = onAfterSave;

  // Keep ref in sync
  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  const openNote = useCallback(async (path: string) => {
    try {
      const n = await invoke<NoteContent>("read_note", { path });
      setNote(n);
    } catch (err) {
      console.error("Failed to open note:", err);
    }
  }, []);

  const updateContent = useCallback((content: string) => {
    setNote((prev) => (prev ? { ...prev, content } : null));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const current = noteRef.current;
      if (current) {
        setSaving(true);
        try {
          await invoke("save_note", { path: current.path, content });
          onAfterSaveRef.current?.();
        } catch (err) {
          console.error("Failed to save note:", err);
        }
        setSaving(false);
      }
    }, 500);
  }, []);

  const saveNow = useCallback(async () => {
    const current = noteRef.current;
    if (!current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      await invoke("save_note", { path: current.path, content: current.content });
    } catch (err) {
      console.error("Failed to save note:", err);
    }
    setSaving(false);
  }, []);

  const closeNote = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setNote(null);
  }, []);

  return { note, saving, openNote, updateContent, saveNow, closeNote };
}

export function useNodeOps(refreshTree: () => Promise<void>) {
  const createFolder = useCallback(
    async (path: string) => {
      await invoke("create_folder", { path });
      await refreshTree();
    },
    [refreshTree],
  );

  const createNote = useCallback(
    async (parentDir: string, name: string): Promise<string> => {
      const newPath = await invoke<string>("create_note", { parentDir, name });
      await refreshTree();
      return newPath;
    },
    [refreshTree],
  );

  const renameNode = useCallback(
    async (oldPath: string, newName: string): Promise<string> => {
      const newPath = await invoke<string>("rename_node", { oldPath, newName });
      await refreshTree();
      return newPath;
    },
    [refreshTree],
  );

  const deleteNode = useCallback(
    async (path: string) => {
      await invoke("delete_node", { path });
      await refreshTree();
    },
    [refreshTree],
  );

  const moveNode = useCallback(
    async (source: string, destDir: string): Promise<string> => {
      const newPath = await invoke<string>("move_node", { source, destDir });
      await refreshTree();
      return newPath;
    },
    [refreshTree],
  );

  return { createFolder, createNote, renameNode, deleteNode, moveNode };
}
