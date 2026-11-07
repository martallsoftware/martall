export interface TreeNode {
  name: string;
  path: string;
  is_folder: boolean;
  children: TreeNode[];
  /** Note type for the icon: note, tasks, daily, template, routine, metrics, dashboard, script, diagram, drawing. */
  kind?: string;
  /** > 0: pinned to the top of its folder (higher first). */
  weight?: number;
}

export interface NoteContent {
  path: string;
  content: string;
}

export interface Vault {
  name: string;
  path: string;
}

export interface Settings {
  notes_directory: string;
  dark_theme: boolean;
  vaults: Vault[];
  split_ratio: number;
  trusted_scripts: string[];
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  vault?: string;
  vault_path?: string;
}

export interface TagInfo {
  name: string;
  count: number;
}

export interface NoteInfo {
  path: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface TagGraph {
  tags: string[];
  notes: { path: string; title: string }[];
  edges: { tag_index: number; note_index: number }[];
}
