export interface TreeNode {
  name: string;
  path: string;
  is_folder: boolean;
  children: TreeNode[];
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
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
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
