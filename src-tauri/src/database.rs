use regex_lite::Regex;
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteInfo {
    pub path: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: i64,
}

/// Get the local database directory for a vault.
/// The database is stored in the app's config directory, NOT inside the vault.
/// This prevents sync conflicts when the vault is in iCloud/Dropbox.
fn local_db_dir(notes_dir: &str) -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join("martall").join("databases");

    // Use a hash of the vault path to create a unique dir per vault
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    notes_dir.hash(&mut hasher);
    let hash = hasher.finish();

    app_dir.join(format!("vault_{:x}", hash))
}

/// Open or create the database and initialize schema.
/// Database is stored locally, not inside the vault folder.
pub fn open_db(notes_dir: &str) -> Result<Connection, String> {
    let db_dir = local_db_dir(notes_dir);
    fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;

    let db_path = db_dir.join("martall_index.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;

    init_schema(&conn)?;
    migrate(&conn);
    Ok(conn)
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            rel_path    TEXT NOT NULL UNIQUE,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            modified_at INTEGER NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS note_tags (
            note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (note_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS note_links (
            source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target         TEXT NOT NULL,
            PRIMARY KEY (source_note_id, target)
        );

        CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target);
        CREATE INDEX IF NOT EXISTS idx_note_links_target_lower ON note_links(LOWER(target));

        CREATE TABLE IF NOT EXISTS favorites (
            rel_path TEXT NOT NULL UNIQUE,
            added_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            content,
            content=notes,
            content_rowid=id
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
        END;
        ",
    )
    .map_err(|e| e.to_string())
}

/// Add columns to existing databases that were created before created_at/updated_at
fn migrate(conn: &Connection) {
    // Check if created_at column exists
    let has_created: bool = conn
        .prepare("SELECT created_at FROM notes LIMIT 0")
        .is_ok();
    if !has_created {
        let now = now_unix();
        let _ = conn.execute_batch(&format!(
            "ALTER TABLE notes ADD COLUMN created_at INTEGER NOT NULL DEFAULT {};
             ALTER TABLE notes ADD COLUMN updated_at INTEGER NOT NULL DEFAULT {};",
            now, now
        ));
    }

    // Repair `updated_at` / `created_at` rows written by an earlier version
    // that used wall-clock now() instead of the file's mtime. Idempotent: on
    // subsequent runs nothing matches the WHERE clauses.
    let _ = conn.execute(
        "UPDATE notes SET updated_at = modified_at WHERE updated_at <> modified_at AND modified_at > 0",
        [],
    );
    let _ = conn.execute(
        "UPDATE notes SET created_at = modified_at WHERE created_at > modified_at AND modified_at > 0",
        [],
    );

    // First run after wiki-link feature lands: if any indexed note contains
    // `[[…]]` syntax but the links table is empty, force a re-sync so existing
    // notes get their links extracted. Once indexed, this becomes a no-op.
    let links_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM note_links", [], |r| r.get(0))
        .unwrap_or(0);
    if links_count == 0 {
        let has_wiki_syntax: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM notes WHERE content LIKE '%[[%' LIMIT 1)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if has_wiki_syntax {
            let _ = conn.execute("UPDATE notes SET modified_at = 0", []);
        }
    }
}

/// Extract #tags from markdown content, ignoring code blocks
pub fn extract_tags(content: &str) -> Vec<String> {
    // Strip fenced code blocks first
    let code_block_re = Regex::new(r"```[\s\S]*?```").unwrap();
    let stripped = code_block_re.replace_all(content, "");

    // Also strip inline code
    let inline_code_re = Regex::new(r"`[^`]+`").unwrap();
    let stripped = inline_code_re.replace_all(&stripped, "");

    // Manual extraction to support Unicode letters (åäö, etc.)
    let mut tags: Vec<String> = Vec::new();
    let chars: Vec<char> = stripped.chars().collect();
    let len = chars.len();
    let mut i = 0;
    while i < len {
        if chars[i] == '#' {
            // Check preceding char is whitespace, start of string, or '('
            let valid_start = i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(';
            if valid_start && i + 1 < len && chars[i + 1].is_alphabetic() {
                let start = i + 1;
                let mut end = start;
                while end < len && (chars[end].is_alphanumeric() || chars[end] == '_' || chars[end] == '-' || chars[end] == '/') {
                    end += 1;
                }
                let tag: String = chars[start..end].iter().collect::<String>().to_lowercase();
                if !tag.is_empty() {
                    tags.push(tag);
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    tags.sort();
    tags.dedup();
    tags
}

/// Extract `[[wiki link]]` targets from markdown content, ignoring code blocks.
/// `[[Target|Display]]` returns just `Target`.
pub fn extract_wiki_links(content: &str) -> Vec<String> {
    let code_block_re = Regex::new(r"```[\s\S]*?```").unwrap();
    let stripped = code_block_re.replace_all(content, "");
    let inline_code_re = Regex::new(r"`[^`]+`").unwrap();
    let stripped = inline_code_re.replace_all(&stripped, "");

    let wiki_re = Regex::new(r"\[\[([^\]\n]+?)\]\]").unwrap();
    let mut out: Vec<String> = Vec::new();
    for cap in wiki_re.captures_iter(&stripped) {
        if let Some(m) = cap.get(1) {
            let raw = m.as_str();
            let target = match raw.find('|') {
                Some(i) => raw[..i].trim().to_string(),
                None => raw.trim().to_string(),
            };
            if !target.is_empty() {
                out.push(target);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Get file modification time as unix timestamp
fn file_mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or(0)
}

/// Compute relative path from notes_dir
fn rel_path(file_path: &Path, notes_dir: &Path) -> Option<String> {
    file_path
        .strip_prefix(notes_dir)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Full sync: scan all .md files, index new/changed, remove deleted
pub fn sync_index(conn: &Connection, notes_dir: &str) {
    let root = Path::new(notes_dir);
    let mut seen_paths: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "md"))
    {
        let path = entry.path();

        // Skip files inside database/ folder
        if let Some(rp) = rel_path(path, root) {
            if rp.starts_with("database/") || rp.starts_with("database\\") {
                continue;
            }
            seen_paths.insert(rp.clone());

            let mtime = file_mtime(path);

            // Check if already indexed with same mtime
            let existing_mtime: Option<i64> = conn
                .query_row(
                    "SELECT modified_at FROM notes WHERE rel_path = ?",
                    params![&rp],
                    |row| row.get(0),
                )
                .ok();

            if existing_mtime == Some(mtime) {
                continue; // Not changed
            }

            if let Ok(content) = fs::read_to_string(path) {
                let title = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                upsert_note(conn, &rp, &title, &content, mtime);
            }
        }
    }

    // Remove DB entries for files that no longer exist
    let mut stmt = conn
        .prepare("SELECT rel_path FROM notes")
        .unwrap();
    let db_paths: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for db_path in db_paths {
        if !seen_paths.contains(&db_path) {
            let _ = conn.execute("DELETE FROM notes WHERE rel_path = ?", params![&db_path]);
        }
    }

    cleanup_orphan_tags(conn);
}

/// Insert or update a note in the index.
///
/// `updated_at` and `created_at` are derived from the file's `mtime` rather
/// than wall-clock time, so:
///   - Cross-device sync (e.g. iCloud) produces the same values everywhere.
///   - Re-indexing (focus handler, `rebuild_index`) doesn't destroy ordering.
///   - Sort-by-updated reflects real file edits, not indexer activity.
pub fn upsert_note(conn: &Connection, rp: &str, title: &str, content: &str, mtime: i64) {
    let _ = conn.execute(
        "INSERT INTO notes (rel_path, title, content, modified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(rel_path) DO UPDATE SET title=excluded.title, content=excluded.content, modified_at=excluded.modified_at, updated_at=excluded.modified_at",
        params![rp, title, content, mtime, mtime, mtime],
    );

    // Get note id
    if let Ok(note_id) = conn.query_row(
        "SELECT id FROM notes WHERE rel_path = ?",
        params![rp],
        |row| row.get::<_, i64>(0),
    ) {
        sync_note_tags(conn, note_id, content);
        sync_note_links(conn, note_id, content);
    }
}

/// Sync wiki link targets for a specific note
fn sync_note_links(conn: &Connection, note_id: i64, content: &str) {
    let links = extract_wiki_links(content);
    let _ = conn.execute("DELETE FROM note_links WHERE source_note_id = ?", params![note_id]);
    for target in &links {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO note_links (source_note_id, target) VALUES (?, ?)",
            params![note_id, target],
        );
    }
}

/// Sync tags for a specific note
fn sync_note_tags(conn: &Connection, note_id: i64, content: &str) {
    let tags = extract_tags(content);

    // Remove old tags
    let _ = conn.execute("DELETE FROM note_tags WHERE note_id = ?", params![note_id]);

    for tag_name in &tags {
        // Ensure tag exists
        let _ = conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?)",
            params![tag_name],
        );
        if let Ok(tag_id) = conn.query_row(
            "SELECT id FROM tags WHERE name = ?",
            params![tag_name],
            |row| row.get::<_, i64>(0),
        ) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
                params![note_id, tag_id],
            );
        }
    }
}

/// Remove tags that have no associated notes
fn cleanup_orphan_tags(conn: &Connection) {
    let _ = conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)",
        [],
    );
}

/// Delete a note from the index by relative path
pub fn delete_note_index(conn: &Connection, rp: &str) {
    let _ = conn.execute("DELETE FROM notes WHERE rel_path = ?", params![rp]);
    cleanup_orphan_tags(conn);
}

/// Delete all notes under a folder prefix
pub fn delete_folder_index(conn: &Connection, folder_rp: &str) {
    let pattern = format!("{}%", folder_rp);
    let _ = conn.execute("DELETE FROM notes WHERE rel_path LIKE ?", params![&pattern]);
    cleanup_orphan_tags(conn);
}

/// Rename a note in the index
pub fn rename_note_index(conn: &Connection, old_rp: &str, new_rp: &str, new_title: &str) {
    let _ = conn.execute(
        "UPDATE notes SET rel_path = ?, title = ? WHERE rel_path = ?",
        params![new_rp, new_title, old_rp],
    );
}

/// Move a note: update its rel_path
pub fn move_note_index(conn: &Connection, old_rp: &str, new_rp: &str) {
    let _ = conn.execute(
        "UPDATE notes SET rel_path = ? WHERE rel_path = ?",
        params![new_rp, old_rp],
    );
}

/// Full-text search
pub fn search(conn: &Connection, notes_dir: &str, query: &str) -> Vec<SearchResult> {
    // Sanitize query: wrap each word in quotes to avoid FTS syntax errors
    let sanitized: String = query
        .split_whitespace()
        .map(|w| {
            let clean: String = w.chars().filter(|c| c.is_alphanumeric() || *c == '#' || *c == '_' || *c == '-').collect();
            if clean.is_empty() {
                String::new()
            } else {
                format!("\"{}\"", clean)
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if sanitized.is_empty() {
        return Vec::new();
    }

    let mut stmt = conn
        .prepare(
            "SELECT n.rel_path, n.title, snippet(notes_fts, 1, '<mark>', '</mark>', '...', 48) as snippet
             FROM notes_fts
             JOIN notes n ON n.id = notes_fts.rowid
             WHERE notes_fts MATCH ?
             ORDER BY rank
             LIMIT 50",
        )
        .unwrap();

    let root = Path::new(notes_dir);
    stmt.query_map(params![&sanitized], |row| {
        let rp: String = row.get(0)?;
        let title: String = row.get(1)?;
        let snippet: String = row.get(2)?;
        let full_path = root.join(&rp).to_string_lossy().to_string();
        Ok(SearchResult {
            path: full_path,
            title,
            snippet,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Get all tags with counts
pub fn get_all_tags(conn: &Connection) -> Vec<TagInfo> {
    let mut stmt = conn
        .prepare(
            "SELECT t.name, COUNT(nt.note_id) as count
             FROM tags t
             JOIN note_tags nt ON t.id = nt.tag_id
             GROUP BY t.id
             ORDER BY count DESC, t.name ASC",
        )
        .unwrap();

    stmt.query_map([], |row| {
        Ok(TagInfo {
            name: row.get(0)?,
            count: row.get(1)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Get notes by tag
pub fn get_notes_by_tag(conn: &Connection, notes_dir: &str, tag: &str) -> Vec<SearchResult> {
    let root = Path::new(notes_dir);
    let mut stmt = conn
        .prepare(
            "SELECT n.rel_path, n.title, substr(n.content, 1, 200) as snippet
             FROM notes n
             JOIN note_tags nt ON n.id = nt.note_id
             JOIN tags t ON t.id = nt.tag_id
             WHERE t.name = ?
             ORDER BY n.title",
        )
        .unwrap();

    stmt.query_map(params![tag], |row| {
        let rp: String = row.get(0)?;
        let title: String = row.get(1)?;
        let snippet: String = row.get(2)?;
        let full_path = root.join(&rp).to_string_lossy().to_string();
        Ok(SearchResult {
            path: full_path,
            title,
            snippet,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Get recent notes ordered by updated_at desc
pub fn get_recent_notes(conn: &Connection, notes_dir: &str, limit: i64) -> Vec<NoteInfo> {
    let root = Path::new(notes_dir);
    let mut stmt = conn
        .prepare(
            "SELECT rel_path, title, created_at, updated_at
             FROM notes
             ORDER BY updated_at DESC
             LIMIT ?",
        )
        .unwrap();

    stmt.query_map(params![limit], |row| {
        let rp: String = row.get(0)?;
        let full_path = root.join(&rp).to_string_lossy().to_string();
        Ok(NoteInfo {
            path: full_path,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Get all notes sorted by a field
pub fn get_all_notes_sorted(conn: &Connection, notes_dir: &str, sort_by: &str, ascending: bool) -> Vec<NoteInfo> {
    let root = Path::new(notes_dir);
    let order_col = match sort_by {
        "created" => "created_at",
        "updated" => "updated_at",
        "title" => "title",
        _ => "updated_at",
    };
    let direction = if ascending { "ASC" } else { "DESC" };
    let sql = format!(
        "SELECT rel_path, title, created_at, updated_at FROM notes ORDER BY {} {}",
        order_col, direction
    );
    let mut stmt = conn.prepare(&sql).unwrap();

    stmt.query_map([], |row| {
        let rp: String = row.get(0)?;
        let full_path = root.join(&rp).to_string_lossy().to_string();
        Ok(NoteInfo {
            path: full_path,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

// MARK: - Favorites (file-based, syncs via iCloud)

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FavoriteEntry {
    rel_path: String,
    added_at: i64,
}

fn favorites_path(notes_dir: &str) -> PathBuf {
    Path::new(notes_dir).join("martall_favorites.json")
}

fn read_favorites(notes_dir: &str) -> Vec<FavoriteEntry> {
    let path = favorites_path(notes_dir);
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_favorites(notes_dir: &str, favs: &[FavoriteEntry]) {
    let path = favorites_path(notes_dir);
    if let Ok(json) = serde_json::to_string_pretty(favs) {
        let _ = fs::write(&path, json);
    }
}

pub fn is_favorite(_conn: &Connection, notes_dir: &str, note_path: &str) -> bool {
    let root = Path::new(notes_dir);
    let rp = match Path::new(note_path).strip_prefix(root) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return false,
    };
    read_favorites(notes_dir).iter().any(|f| f.rel_path == rp)
}

pub fn toggle_favorite(_conn: &Connection, notes_dir: &str, note_path: &str) -> bool {
    let root = Path::new(notes_dir);
    let rp = match Path::new(note_path).strip_prefix(root) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return false,
    };
    let mut favs = read_favorites(notes_dir);
    if let Some(idx) = favs.iter().position(|f| f.rel_path == rp) {
        favs.remove(idx);
        write_favorites(notes_dir, &favs);
        false
    } else {
        favs.push(FavoriteEntry {
            rel_path: rp,
            added_at: now_unix(),
        });
        write_favorites(notes_dir, &favs);
        true
    }
}

pub fn get_favorite_notes(conn: &Connection, notes_dir: &str) -> Vec<NoteInfo> {
    let root = Path::new(notes_dir);
    let favs = read_favorites(notes_dir);
    let mut result = Vec::new();
    for fav in &favs {
        let mut stmt = conn
            .prepare("SELECT rel_path, title, created_at, updated_at FROM notes WHERE rel_path = ?")
            .unwrap();
        if let Ok(note) = stmt.query_row(params![fav.rel_path], |row| {
            let rp: String = row.get(0)?;
            let full_path = root.join(&rp).to_string_lossy().to_string();
            Ok(NoteInfo {
                path: full_path,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        }) {
            result.push(note);
        }
    }
    result
}

// MARK: - Tag Graph

#[derive(Debug, Clone, Serialize)]
pub struct TagGraphNote {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagGraphEdge {
    pub tag_index: usize,
    pub note_index: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagGraph {
    pub tags: Vec<String>,
    pub notes: Vec<TagGraphNote>,
    pub edges: Vec<TagGraphEdge>,
}

pub fn get_tag_graph(conn: &Connection, notes_dir: &str) -> TagGraph {
    let root = Path::new(notes_dir);
    let mut tags: Vec<String> = Vec::new();
    let mut tag_map: HashMap<String, usize> = HashMap::new();
    let mut notes: Vec<TagGraphNote> = Vec::new();
    let mut note_map: HashMap<String, usize> = HashMap::new();
    let mut edges: Vec<TagGraphEdge> = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT t.name, n.rel_path, n.title
             FROM note_tags nt
             JOIN tags t ON t.id = nt.tag_id
             JOIN notes n ON n.id = nt.note_id
             ORDER BY t.name, n.title",
        )
        .unwrap();

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .unwrap();

    for row in rows.flatten() {
        let (tag_name, rel_path, title) = row;
        let full_path = root.join(&rel_path).to_string_lossy().to_string();

        let tag_idx = *tag_map.entry(tag_name.clone()).or_insert_with(|| {
            tags.push(tag_name);
            tags.len() - 1
        });

        let note_idx = *note_map.entry(rel_path.clone()).or_insert_with(|| {
            notes.push(TagGraphNote {
                path: full_path,
                title,
            });
            notes.len() - 1
        });

        edges.push(TagGraphEdge {
            tag_index: tag_idx,
            note_index: note_idx,
        });
    }

    TagGraph { tags, notes, edges }
}

// MARK: - Wiki Links

/// Resolve a single wiki-link target to a relative path within the vault.
/// Resolution order:
///   1. If target contains a slash, try exact rel_path match (with/without .md).
///   2. Otherwise, match by title (case-insensitive). If multiple notes share
///      the title, prefer one in the same folder as `from_rel`, else the first.
fn resolve_target(
    conn: &Connection,
    target: &str,
    from_rel: Option<&str>,
) -> Option<String> {
    let target = target.trim();
    if target.is_empty() {
        return None;
    }

    if target.contains('/') || target.contains('\\') {
        let candidates: Vec<String> = if target.ends_with(".md") {
            vec![target.to_string()]
        } else {
            vec![format!("{}.md", target), target.to_string()]
        };
        for c in &candidates {
            if let Ok(rp) = conn.query_row(
                "SELECT rel_path FROM notes WHERE rel_path = ? LIMIT 1",
                params![c],
                |row| row.get::<_, String>(0),
            ) {
                return Some(rp);
            }
        }
        return None;
    }

    let mut stmt = conn
        .prepare("SELECT rel_path FROM notes WHERE LOWER(title) = LOWER(?)")
        .ok()?;
    let matches: Vec<String> = stmt
        .query_map(params![target], |row| row.get::<_, String>(0))
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    if matches.is_empty() {
        return None;
    }
    if matches.len() == 1 {
        return Some(matches.into_iter().next().unwrap());
    }
    if let Some(from) = from_rel {
        let from_dir = Path::new(from)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        for m in &matches {
            let m_dir = Path::new(m)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if m_dir == from_dir {
                return Some(m.clone());
            }
        }
    }
    Some(matches.into_iter().next().unwrap())
}

/// Batch-resolve wiki link targets. Returns `target -> absolute path | null`.
pub fn resolve_wiki_links(
    conn: &Connection,
    notes_dir: &str,
    targets: Vec<String>,
    from_path: Option<&str>,
) -> HashMap<String, Option<String>> {
    let root = Path::new(notes_dir);
    let from_rel = from_path
        .and_then(|p| Path::new(p).strip_prefix(root).ok())
        .map(|p| p.to_string_lossy().to_string());

    let mut map = HashMap::new();
    for target in targets {
        let resolved = resolve_target(conn, &target, from_rel.as_deref())
            .map(|rp| root.join(&rp).to_string_lossy().to_string());
        map.insert(target, resolved);
    }
    map
}

/// Return all notes that link TO the note at `note_path` via `[[wiki link]]`.
pub fn get_backlinks(conn: &Connection, notes_dir: &str, note_path: &str) -> Vec<NoteInfo> {
    let root = Path::new(notes_dir);
    let rp = match Path::new(note_path).strip_prefix(root) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return Vec::new(),
    };
    let title = Path::new(&rp)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let rp_without_ext = rp.trim_end_matches(".md").to_string();

    let mut stmt = match conn.prepare(
        "SELECT DISTINCT n.rel_path, n.title, n.created_at, n.updated_at
         FROM note_links nl
         JOIN notes n ON n.id = nl.source_note_id
         WHERE nl.target = ?
            OR nl.target = ?
            OR LOWER(nl.target) = LOWER(?)
         ORDER BY n.updated_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map(
        params![&rp, &rp_without_ext, &title],
        |row| {
            let source_rp: String = row.get(0)?;
            let full_path = root.join(&source_rp).to_string_lossy().to_string();
            Ok(NoteInfo {
                path: full_path,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Get tags for a specific note
pub fn get_note_tags(conn: &Connection, notes_dir: &str, note_path: &str) -> Vec<String> {
    let root = Path::new(notes_dir);
    let rp = match Path::new(note_path).strip_prefix(root) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return Vec::new(),
    };

    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM tags t
             JOIN note_tags nt ON t.id = nt.tag_id
             JOIN notes n ON n.id = nt.note_id
             WHERE n.rel_path = ?
             ORDER BY t.name",
        )
        .unwrap();

    stmt.query_map(params![&rp], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}
