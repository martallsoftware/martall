# Martall - Desktop Note-Taking Application

A modern markdown note-taking desktop application built with **Tauri 2**, **React 19**, **TypeScript**, and **Rust**.

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19.1 | UI framework |
| TypeScript | 5.8 | Type safety |
| Vite | 7.0 | Build tool & dev server (HMR on port 1420) |
| Tailwind CSS | 3.4 | Utility-first styling |
| react-markdown | 10.1 | Markdown rendering |
| remark-gfm | 4.0 | GitHub Flavored Markdown |
| Mermaid | 11.14 | Diagram/flowchart rendering |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Tauri | 2.x | Desktop framework & IPC |
| Rust | 1.85+ | Backend logic |
| rusqlite | 0.31 | SQLite with bundled engine |
| serde / serde_json | 1.x | Serialization |
| walkdir | 2.x | Recursive directory traversal |
| regex-lite | 0.1 | Tag extraction |
| base64 | 0.22 | Image encoding |

### Plugins
- `tauri-plugin-opener` - Open URLs in system browser
- `tauri-plugin-dialog` - Native file/folder dialogs

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Window                      │
├──────┬──────────┬───────────────────────────────────┤
│ Icon │ Sidebar  │         Main Content              │
│ Rail │ Panel    │                                    │
│      │          │  ┌─────────────┬─────────────┐    │
│  H   │  Notes   │  │   Editor    │   Preview   │    │
│  N   │  Favs    │  │  (Markdown) │  (Rendered) │    │
│  ★   │  Recent  │  │             │             │    │
│  R   │  Tags    │  │             │             │    │
│  #   │  Graph   │  │             │             │    │
│  ⊕   │  Search  │  │  ┌───────────────────┐   │    │
│  🔍  │  Vaults  │  │  │ Floating Toolbar  │   │    │
│      │          │  │  └───────────────────┘   │    │
│  ⚙   │          │  └─────────────┴─────────────┘    │
└──────┴──────────┴───────────────────────────────────┘
```

### Layout
- **Icon Rail** (48px) - Navigation icons, settings at bottom
- **Sidebar Panel** (260px) - Context-specific content (collapsible)
- **Main Content** - Editor, preview, or graph view
- **Header** (44px) - Note title, favorite star, view mode toggle, share menu

---

## Features

### 1. Note Management
- Create, edit, delete, rename notes and folders
- Move notes between folders via dialog
- Auto-save with 500ms debounce
- Hierarchical folder structure

### 2. Multi-Vault Support
- Multiple independent note repositories
- Switch vaults from sidebar or settings
- Each vault has its own SQLite index in `~/.config/martall/databases/`
- Settings stored in `~/.config/martall/settings.json`

### 3. Editor & Preview
- **Three view modes**: Edit | Split | Preview
- **Markdown features**: headings, bold, italic, code, lists, checkboxes, blockquotes, tables, horizontal rules
- **Mermaid diagrams**: rendered in preview via CDN
- **Image support**: local images loaded via Rust backend with base64 encoding, parent directory fallback for moved notes
- **Image sizing**: `![alt|100](path)`, `![alt|50%](path)`, `![alt|200x150](path)`
- **Tag pills**: `#tags` rendered as styled pills in preview
- **Floating toolbar**: Clean & Format, Insert Diagram, Insert Table, Insert Emoji

### 4. Tags
- Auto-extracted from note content (`#tagname`)
- Unicode-aware (supports Nordic characters: åäö)
- Ignores tags inside code blocks
- Tag cloud panel with click-to-filter
- Tags sync across devices via note content (no separate file needed)

### 5. Favorites
- Toggle favorite with star button in header
- Synced across devices via `martall_favorites.json` in vault root
- Favorites panel in sidebar

### 6. Search
- Full-text search powered by SQLite FTS5
- Real-time results with snippets
- Search panel in sidebar

### 7. Tag Graph
- Force-directed graph visualization
- Tag nodes (green, larger) connected to note nodes (gray, smaller)
- Interactive: drag nodes, pan, zoom (scroll wheel + buttons)
- Click note node to preview, click "Open" to edit
- Layout persisted to `localStorage`
- Obsidian-inspired dark aesthetic

### 8. Import & Export
- **Import**: Bulk import `.md` files with asset deduplication
- **Export HTML**: Styled document with green accent
- **Export PDF**: Via browser print
- **Email**: Opens mailto with note content
- **Print**: Custom CSS for printing

### 9. Theme
- Dark mode (default): `#181825` background, `#1e1e2e` sidebar
- Light mode: `#ffffff` background, `#f8f8f8` sidebar
- Accent color: `#22C55E` (green)
- Window title bar follows theme (macOS/Windows native)

---

## File Structure

```
Martall/
├── src/
│   ├── App.tsx                    # Main application (616 lines)
│   ├── types.ts                   # TypeScript interfaces
│   ├── styles.css                 # Custom CSS
│   ├── components/
│   │   ├── Editor.tsx             # Markdown editor with toolbar
│   │   ├── Preview.tsx            # Markdown preview renderer
│   │   ├── GraphView.tsx          # Interactive tag graph
│   │   ├── MermaidBlock.tsx       # Mermaid diagram renderer
│   │   ├── TreeView.tsx           # File/folder tree
│   │   ├── IconRail.tsx           # Sidebar navigation
│   │   ├── HomePanel.tsx          # Dashboard
│   │   ├── RecentPanel.tsx        # Recent notes list
│   │   ├── FavoritesPanel.tsx     # Favorite notes list
│   │   ├── TagList.tsx            # Tag cloud & filter
│   │   ├── SearchBar.tsx          # Search input
│   │   ├── VaultPicker.tsx        # Vault selector
│   │   ├── SettingsModal.tsx      # Settings dialog
│   │   ├── ShareMenu.tsx          # Export options
│   │   ├── InputDialog.tsx        # Name input dialog
│   │   ├── ImportDialog.tsx       # File import dialog
│   │   ├── EmojiPicker.tsx        # Emoji selector
│   │   └── ...                    # Other dialogs
│   └── hooks/
│       ├── useTauri.ts            # Tauri command bindings
│       └── useSearch.ts           # Search & tag hooks
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                 # Tauri commands (30+)
│   │   ├── database.rs            # SQLite operations
│   │   └── main.rs                # Entry point
│   ├── Cargo.toml                 # Rust dependencies
│   └── tauri.conf.json            # Tauri configuration
├── package.json
├── tailwind.config.js
├── vite.config.ts
└── tsconfig.json
```

---

## Data Models

```typescript
interface TreeNode {
  name: string;
  path: string;
  is_folder: boolean;
  children: TreeNode[];
}

interface NoteContent {
  path: string;
  content: string;
}

interface TagInfo {
  name: string;
  count: number;
}

interface NoteInfo {
  path: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

interface TagGraph {
  tags: string[];
  notes: { path: string; title: string }[];
  edges: { tag_index: number; note_index: number }[];
}

interface Settings {
  notes_directory: string;
  dark_theme: boolean;
  vaults: Vault[];
}
```

---

## Database Schema (SQLite)

```sql
-- Note index
CREATE TABLE notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rel_path    TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    modified_at INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT 0
);

-- Tags
CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Note-Tag relationships
CREATE TABLE note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

-- Full-text search
CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, content, content=notes, content_rowid=id
);

-- Auto-sync triggers for FTS
CREATE TRIGGER notes_ai AFTER INSERT ON notes ...
CREATE TRIGGER notes_ad AFTER DELETE ON notes ...
CREATE TRIGGER notes_au AFTER UPDATE ON notes ...
```

---

## Tauri Commands (API)

### Settings & Vaults
| Command | Description |
|---|---|
| `get_settings()` | Load app settings |
| `update_settings(newSettings)` | Save settings |
| `get_vaults()` | List all vaults |
| `add_vault(name, path)` | Add a vault |
| `remove_vault(path)` | Remove a vault |
| `switch_vault(path)` | Switch active vault |

### File Operations
| Command | Description |
|---|---|
| `read_tree()` | Get folder/file tree |
| `read_note(path)` | Read note content |
| `save_note(path, content)` | Save note (triggers index update) |
| `create_note(parentDir, name)` | Create new note |
| `create_folder(path)` | Create folder |
| `rename_node(oldPath, newName)` | Rename file/folder |
| `delete_node(path)` | Delete file/folder |
| `move_node(source, destDir)` | Move file/folder |

### Search & Tags
| Command | Description |
|---|---|
| `search_notes(query)` | Full-text search |
| `get_all_tags()` | All tags with counts |
| `get_notes_by_tag(tag)` | Notes filtered by tag |
| `get_note_tags(path)` | Tags for a note |
| `get_tag_graph()` | Tag-note relationship graph |
| `rebuild_index()` | Force full re-index |

### Favorites
| Command | Description |
|---|---|
| `is_favorite(path)` | Check if note is favorited |
| `toggle_favorite(path)` | Toggle favorite status |
| `get_favorite_notes()` | List all favorites |

### Media & Export
| Command | Description |
|---|---|
| `copy_image_to_assets(sourcePath, notePath)` | Copy image to note's assets |
| `read_image_base64(path)` | Read image as data URL |
| `export_html(path, html)` | Export note as HTML |
| `export_pdf(html, pdfPath)` | Export note as PDF |
| `import_notes(filePaths, targetFolder)` | Bulk import .md files |

### Discovery
| Command | Description |
|---|---|
| `get_recent_notes(limit?)` | Recently modified notes |
| `get_all_notes_sorted(sortBy?, ascending?)` | Sorted note list |

---

## Cross-Platform Sync

### Notes
Markdown files (`.md`) stored in vault directory. Sync via iCloud, Dropbox, or any cloud storage.

### Favorites
Stored in `martall_favorites.json` in vault root. Same file read by iOS, macOS, and Avalonia apps.

```json
[
  { "rel_path": "Folder/Note.md", "added_at": 1712345678 }
]
```

### Tags
Derived from note content — no sync file needed. Each app extracts `#tags` independently after syncing notes.

### Database
Local SQLite index in `~/.config/martall/databases/`. NOT synced — each device builds its own index from the shared notes.

---

## Development

### Prerequisites
- Node.js 18+
- Rust 1.86+
- npm or pnpm

### Commands
```bash
# Install dependencies
npm install

# Development with hot reload
npm run tauri dev

# Build for production
npm run tauri build

# TypeScript type check
npx tsc --noEmit

# Frontend only (no Tauri)
npm run dev
```

### Debugging
- **Frontend**: Open DevTools with `Cmd+Shift+I` in the Tauri window
- **Rust**: Use VS Code with CodeLLDB extension and the included `.vscode/launch.json`
- **Quick debug**: Add `debugger;` in TypeScript code with DevTools open

---

## Related Projects

| Project | Platform | Tech |
|---|---|---|
| **Martall** (this) | Desktop (macOS/Windows/Linux) | Tauri + React + Rust |
| **Martall_App** | iOS + macOS | SwiftUI (shared codebase) |
| **MartallAvalonia** | Desktop (cross-platform) | Avalonia + C# |

All three share the same vault folder, favorites file, and note format.
