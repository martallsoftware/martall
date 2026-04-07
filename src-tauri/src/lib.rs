mod database;
mod lua_runtime;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub notes_directory: String,
    pub dark_theme: bool,
    #[serde(default)]
    pub vaults: Vec<Vault>,
    #[serde(default = "default_split_ratio")]
    pub split_ratio: f32,
    #[serde(default)]
    pub trusted_scripts: Vec<String>,
}

fn default_split_ratio() -> f32 {
    0.5
}

impl Default for Settings {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let default_path = home.join("MartallNotes").to_string_lossy().to_string();
        Self {
            notes_directory: default_path.clone(),
            dark_theme: true,
            vaults: vec![Vault {
                name: "Default".to_string(),
                path: default_path,
            }],
            split_ratio: 0.5,
            trusted_scripts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_folder: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteContent {
    pub path: String,
    pub content: String,
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub db: Mutex<rusqlite::Connection>,
}

// ---------------------------------------------------------------------------
// Helper: build tree recursively
// ---------------------------------------------------------------------------

fn build_tree(dir: &Path) -> Vec<TreeNode> {
    let mut folders: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs and database folder
        if name.starts_with('.') || name == "database" || name == "assets" {
            continue;
        }

        if path.is_dir() {
            let children = build_tree(&path);
            folders.push(TreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_folder: true,
                children,
            });
        } else if path.extension().is_some_and(|e| e == "md") {
            let display_name = name.strip_suffix(".md").unwrap_or(&name).to_string();
            files.push(TreeNode {
                name: display_name,
                path: path.to_string_lossy().to_string(),
                is_folder: false,
                children: Vec::new(),
            });
        }
    }

    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    folders.extend(files);
    folders
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_config = config_dir.join("martall");
    let _ = fs::create_dir_all(&app_config);
    app_config.join("settings.json")
}

fn load_settings_from_disk() -> Settings {
    let path = settings_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(mut s) = serde_json::from_str::<Settings>(&data) {
                // Ensure active directory is in vaults list (migration from old settings)
                if s.vaults.is_empty() {
                    s.vaults.push(Vault {
                        name: "Default".to_string(),
                        path: s.notes_directory.clone(),
                    });
                } else if !s.vaults.iter().any(|v| v.path == s.notes_directory) {
                    s.vaults.insert(0, Vault {
                        name: Path::new(&s.notes_directory)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                        path: s.notes_directory.clone(),
                    });
                }
                return s;
            }
        }
    }
    Settings::default()
}

fn save_settings_to_disk(settings: &Settings) {
    let path = settings_path();
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, new_settings: Settings) {
    let mut s = state.settings.lock().unwrap();
    *s = new_settings.clone();
    save_settings_to_disk(&new_settings);
}

#[tauri::command]
fn get_vaults(state: State<'_, AppState>) -> Vec<Vault> {
    state.settings.lock().unwrap().vaults.clone()
}

#[tauri::command]
fn add_vault(state: State<'_, AppState>, name: String, path: String) -> Result<Vec<Vault>, String> {
    let mut settings = state.settings.lock().unwrap();

    // Check for duplicate path
    if settings.vaults.iter().any(|v| v.path == path) {
        return Err("A vault with this path already exists".to_string());
    }

    // Ensure directory exists
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    settings.vaults.push(Vault {
        name: name.clone(),
        path: path.clone(),
    });
    save_settings_to_disk(&settings);
    Ok(settings.vaults.clone())
}

#[tauri::command]
fn remove_vault(state: State<'_, AppState>, path: String) -> Result<Vec<Vault>, String> {
    let mut settings = state.settings.lock().unwrap();

    // Don't allow removing the active vault
    if settings.notes_directory == path {
        return Err("Cannot remove the active vault".to_string());
    }

    // Don't allow removing if only one vault left
    if settings.vaults.len() <= 1 {
        return Err("Must have at least one vault".to_string());
    }

    settings.vaults.retain(|v| v.path != path);
    save_settings_to_disk(&settings);
    Ok(settings.vaults.clone())
}

#[tauri::command]
fn switch_vault(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();

    // Verify the vault exists in our list
    if !settings.vaults.iter().any(|v| v.path == path) {
        return Err("Vault not found".to_string());
    }

    // Ensure directory exists
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    // Update active directory
    settings.notes_directory = path.clone();
    save_settings_to_disk(&settings);

    // Re-open database for new vault
    let new_db = database::open_db(&path)?;
    database::sync_index(&new_db, &path);

    let mut db = state.db.lock().unwrap();
    *db = new_db;

    Ok(())
}

#[tauri::command]
fn read_tree(state: State<'_, AppState>) -> Vec<TreeNode> {
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    let _ = fs::create_dir_all(root);
    build_tree(root)
}

#[tauri::command]
fn read_note(path: String) -> Result<NoteContent, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(NoteContent { path, content })
}

#[tauri::command]
fn save_note(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;

    // Update index
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    if let Ok(rp) = Path::new(&path).strip_prefix(root) {
        let rp_str = rp.to_string_lossy().to_string();
        let title = Path::new(&path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mtime = fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0);
        let db = state.db.lock().unwrap();
        database::upsert_note(&db, &rp_str, &title, &content, mtime);
    }
    Ok(())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note(state: State<'_, AppState>, parent_dir: String, name: String) -> Result<String, String> {
    let file_name = if name.ends_with(".md") {
        name.clone()
    } else {
        format!("{}.md", name)
    };
    let full_path = Path::new(&parent_dir).join(&file_name);
    fs::write(&full_path, "").map_err(|e| e.to_string())?;

    // Index the new note
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    if let Ok(rp) = full_path.strip_prefix(root) {
        let rp_str = rp.to_string_lossy().to_string();
        let title = full_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let db = state.db.lock().unwrap();
        database::upsert_note(&db, &rp_str, &title, "", 0);
    }

    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_node(state: State<'_, AppState>, old_path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&old_path);
    let parent = old.parent().ok_or("No parent directory")?;

    let new_path = if old.is_dir() {
        parent.join(&new_name)
    } else {
        let file_name = if new_name.ends_with(".md") {
            new_name.clone()
        } else {
            format!("{}.md", new_name)
        };
        parent.join(file_name)
    };

    fs::rename(old, &new_path).map_err(|e| e.to_string())?;

    // Update index
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    if let (Ok(old_rp), Ok(new_rp)) = (old.strip_prefix(root), new_path.strip_prefix(root)) {
        let db = state.db.lock().unwrap();
        let new_title = new_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        database::rename_note_index(&db, &old_rp.to_string_lossy(), &new_rp.to_string_lossy(), &new_title);
    }

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_node(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);

    if p.is_dir() {
        // Delete folder index entries
        if let Ok(rp) = p.strip_prefix(root) {
            let rp_str = format!("{}/", rp.to_string_lossy());
            let db = state.db.lock().unwrap();
            database::delete_folder_index(&db, &rp_str);
        }
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        // Delete from index
        if let Ok(rp) = p.strip_prefix(root) {
            let db = state.db.lock().unwrap();
            database::delete_note_index(&db, &rp.to_string_lossy());
        }
        // Clean up orphaned assets
        if p.extension().is_some_and(|e| e == "md") {
            if let Some(parent) = p.parent() {
                let assets_dir = parent.join("assets");
                if assets_dir.exists() {
                    fs::remove_file(p).map_err(|e| e.to_string())?;
                    cleanup_orphaned_assets(&assets_dir, parent, p);
                    return Ok(());
                }
            }
        }
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn move_node(state: State<'_, AppState>, source: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source);
    let file_name = src.file_name().ok_or("Invalid source path")?;
    let dest = Path::new(&dest_dir).join(file_name);

    // If moving a .md file, also move referenced images
    if src.is_file() && src.extension().is_some_and(|e| e == "md") {
        move_referenced_assets(src, Path::new(&dest_dir))?;
    }

    // Update index before moving
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    if let (Ok(old_rp), Ok(new_rp)) = (src.strip_prefix(root), dest.strip_prefix(root)) {
        let db = state.db.lock().unwrap();
        database::move_note_index(&db, &old_rp.to_string_lossy(), &new_rp.to_string_lossy());
    }

    fs::rename(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Reads a .md file, finds all `./assets/...` image references,
/// copies those files to the destination's assets folder,
/// and updates the .md content if the assets dir differs.
fn move_referenced_assets(note_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let content = fs::read_to_string(note_path).unwrap_or_default();
    let src_dir = note_path.parent().ok_or("No parent")?;
    let src_assets = src_dir.join("assets");

    if !src_assets.exists() {
        return Ok(());
    }

    // Find all ./assets/... references
    let re_pattern = regex_lite::Regex::new(r"!\[[^\]]*\]\(\./assets/([^)]+)\)")
        .map_err(|e| e.to_string())?;

    let mut files_to_move: Vec<String> = Vec::new();
    for cap in re_pattern.captures_iter(&content) {
        if let Some(m) = cap.get(1) {
            let decoded = m.as_str().replace("%20", " ");
            files_to_move.push(decoded);
        }
    }

    if files_to_move.is_empty() {
        return Ok(());
    }

    let dest_assets = dest_dir.join("assets");
    let _ = fs::create_dir_all(&dest_assets);

    for file_name in &files_to_move {
        let src_file = src_assets.join(file_name);
        let dest_file = dest_assets.join(file_name);
        if src_file.exists() && !dest_file.exists() {
            let _ = fs::copy(&src_file, &dest_file);
        }
    }

    // Clean up: remove source assets that are no longer referenced by any note in src_dir
    cleanup_orphaned_assets(&src_assets, src_dir, note_path);

    Ok(())
}

/// Remove asset files from src_assets that are not referenced by any .md file
/// in the same directory (excluding the note being moved).
fn cleanup_orphaned_assets(assets_dir: &Path, notes_dir: &Path, exclude_note: &Path) {
    let entries = match fs::read_dir(notes_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    // Collect all referenced assets from remaining notes
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == exclude_note || !path.is_file() {
            continue;
        }
        if path.extension().is_some_and(|e| e == "md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let re = regex_lite::Regex::new(r"!\[[^\]]*\]\(\./assets/([^)]+)\)").unwrap();
                for cap in re.captures_iter(&content) {
                    if let Some(m) = cap.get(1) {
                        referenced.insert(m.as_str().replace("%20", " "));
                    }
                }
            }
        }
    }

    // Remove unreferenced assets
    if let Ok(asset_entries) = fs::read_dir(assets_dir) {
        for entry in asset_entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !referenced.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // Remove assets dir if empty
    if fs::read_dir(assets_dir).map(|mut d| d.next().is_none()).unwrap_or(true) {
        let _ = fs::remove_dir(assets_dir);
    }
}

#[tauri::command]
fn copy_image_to_assets(source_path: String, note_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);
    let note = Path::new(&note_path);
    let note_dir = note.parent().ok_or("Note has no parent directory")?;
    let assets_dir = note_dir.join("assets");

    // Validate it's an image
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let valid = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];
    if !valid.contains(&ext.as_str()) {
        return Err(format!("Not a supported image format: .{}", ext));
    }

    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    // Sanitize filename: replace spaces with underscores (spaces break markdown image syntax)
    let raw_name = source
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
        .replace(' ', "_");
    let safe_name = if ext.is_empty() {
        raw_name.clone()
    } else {
        format!("{}.{}", raw_name, ext)
    };
    let dest = assets_dir.join(&safe_name);

    // Deduplicate if file already exists
    let final_dest = if dest.exists() {
        let mut counter = 1;
        loop {
            let new_name = if ext.is_empty() {
                format!("{}_{}", raw_name, counter)
            } else {
                format!("{}_{}.{}", raw_name, counter, ext)
            };
            let candidate = assets_dir.join(&new_name);
            if !candidate.exists() {
                break candidate;
            }
            counter += 1;
        }
    } else {
        dest
    };

    fs::copy(source, &final_dest).map_err(|e| e.to_string())?;

    let relative = format!(
        "./assets/{}",
        final_dest.file_name().unwrap().to_string_lossy()
    );
    Ok(relative)
}

#[tauri::command]
fn read_image_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let p = Path::new(&path);
    let data = fs::read(p).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
fn export_html(path: String, html: String) -> Result<(), String> {
    fs::write(&path, &html).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_pdf(html: String, pdf_path: String) -> Result<String, String> {
    // Write HTML to a temp file
    let tmp_dir = std::env::temp_dir().join("martall_export");
    let _ = fs::create_dir_all(&tmp_dir);
    let tmp_html = tmp_dir.join("export.html");
    fs::write(&tmp_html, &html).map_err(|e| format!("Failed to write temp HTML: {}", e))?;

    let result = platform_pdf(&tmp_html, &pdf_path);

    // Clean up temp file
    let _ = fs::remove_file(&tmp_html);

    result
}

#[cfg(target_os = "macos")]
fn platform_pdf(html_path: &Path, pdf_path: &str) -> Result<String, String> {
    // Use the Swift helper on macOS
    let helper_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("helpers")
        .join("html2pdf.swift");

    if !helper_path.exists() {
        return Err("PDF helper not found. Use Print > Save as PDF instead.".to_string());
    }

    let output = std::process::Command::new("swift")
        .arg(helper_path.to_string_lossy().as_ref())
        .arg(html_path.to_string_lossy().as_ref())
        .arg(pdf_path)
        .output()
        .map_err(|e| format!("Failed to run PDF helper: {}", e))?;

    if output.status.success() {
        Ok(pdf_path.to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("PDF generation failed: {}", stderr))
    }
}

#[cfg(target_os = "windows")]
fn platform_pdf(html_path: &Path, pdf_path: &str) -> Result<String, String> {
    // Try wkhtmltopdf first (commonly installed)
    let wk = std::process::Command::new("wkhtmltopdf")
        .arg("--quiet")
        .arg("--enable-local-file-access")
        .arg(html_path.to_string_lossy().as_ref())
        .arg(pdf_path)
        .output();

    if let Ok(output) = wk {
        if output.status.success() {
            return Ok(pdf_path.to_string());
        }
    }

    // Fallback: use msedge/chrome in headless mode
    for browser in &[
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ] {
        if Path::new(browser).exists() {
            let html_url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
            let output = std::process::Command::new(browser)
                .arg("--headless")
                .arg("--disable-gpu")
                .arg(format!("--print-to-pdf={}", pdf_path))
                .arg("--no-pdf-header-footer")
                .arg(&html_url)
                .output();

            if let Ok(o) = output {
                if o.status.success() || Path::new(pdf_path).exists() {
                    return Ok(pdf_path.to_string());
                }
            }
        }
    }

    Err("No PDF tool found. Install wkhtmltopdf or use Print > Save as PDF.".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_pdf(html_path: &Path, pdf_path: &str) -> Result<String, String> {
    // Linux: try wkhtmltopdf, then chromium/google-chrome headless
    let wk = std::process::Command::new("wkhtmltopdf")
        .arg("--quiet")
        .arg("--enable-local-file-access")
        .arg(html_path.to_string_lossy().as_ref())
        .arg(pdf_path)
        .output();

    if let Ok(output) = wk {
        if output.status.success() {
            return Ok(pdf_path.to_string());
        }
    }

    for browser in &["google-chrome", "chromium-browser", "chromium"] {
        let html_url = format!("file://{}", html_path.to_string_lossy());
        let output = std::process::Command::new(browser)
            .arg("--headless")
            .arg("--disable-gpu")
            .arg(format!("--print-to-pdf={}", pdf_path))
            .arg("--no-pdf-header-footer")
            .arg(&html_url)
            .output();

        if let Ok(o) = output {
            if o.status.success() || Path::new(pdf_path).exists() {
                return Ok(pdf_path.to_string());
            }
        }
    }

    Err("No PDF tool found. Install wkhtmltopdf or use Print > Save as PDF.".to_string())
}

// ---------------------------------------------------------------------------
// Search and tag commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn search_notes(state: State<'_, AppState>, query: String) -> Result<Vec<database::SearchResult>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::search(&db, &settings.notes_directory, &query))
}

#[tauri::command]
fn get_all_tags(state: State<'_, AppState>) -> Result<Vec<database::TagInfo>, String> {
    let db = state.db.lock().unwrap();
    Ok(database::get_all_tags(&db))
}

#[tauri::command]
fn get_notes_by_tag(state: State<'_, AppState>, tag: String) -> Result<Vec<database::SearchResult>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_notes_by_tag(&db, &settings.notes_directory, &tag))
}

#[tauri::command]
fn get_note_tags(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_note_tags(&db, &settings.notes_directory, &path))
}

#[tauri::command]
fn rebuild_index(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    // Reset all mtimes to force full re-index
    db.execute("UPDATE notes SET modified_at = 0", []).ok();
    database::sync_index(&db, &settings.notes_directory);
    Ok(())
}

#[tauri::command]
fn get_recent_notes(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<database::NoteInfo>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_recent_notes(&db, &settings.notes_directory, limit.unwrap_or(50)))
}

#[tauri::command]
fn get_all_notes_sorted(state: State<'_, AppState>, sort_by: Option<String>, ascending: Option<bool>) -> Result<Vec<database::NoteInfo>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_all_notes_sorted(
        &db,
        &settings.notes_directory,
        &sort_by.unwrap_or_else(|| "updated".to_string()),
        ascending.unwrap_or(false),
    ))
}

// ---------------------------------------------------------------------------
// Tag Graph
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_tag_graph(state: State<'_, AppState>) -> Result<database::TagGraph, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_tag_graph(&db, &settings.notes_directory))
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

#[tauri::command]
fn is_favorite(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::is_favorite(&db, &settings.notes_directory, &path))
}

#[tauri::command]
fn toggle_favorite(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::toggle_favorite(&db, &settings.notes_directory, &path))
}

#[tauri::command]
fn get_favorite_notes(state: State<'_, AppState>) -> Result<Vec<database::NoteInfo>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_favorite_notes(&db, &settings.notes_directory))
}

// ---------------------------------------------------------------------------
// Lua scripting (lua-live blocks)
// ---------------------------------------------------------------------------

#[tauri::command]
fn run_lua_script(
    state: State<'_, AppState>,
    note_path: String,
    code: String,
) -> Result<String, String> {
    let trusted = {
        let s = state.settings.lock().unwrap();
        s.trusted_scripts.iter().any(|p| p == &note_path)
    };
    if !trusted {
        return Err("Note is not trusted for script execution".into());
    }
    lua_runtime::run_script(&code)
}

#[tauri::command]
fn set_note_trusted(
    state: State<'_, AppState>,
    note_path: String,
    trusted: bool,
) -> Result<bool, String> {
    let mut s = state.settings.lock().unwrap();
    let exists = s.trusted_scripts.iter().any(|p| p == &note_path);
    if trusted && !exists {
        s.trusted_scripts.push(note_path);
    } else if !trusted && exists {
        s.trusted_scripts.retain(|p| p != &note_path);
    }
    save_settings_to_disk(&s);
    Ok(trusted)
}

#[tauri::command]
fn is_note_trusted(state: State<'_, AppState>, note_path: String) -> Result<bool, String> {
    let s = state.settings.lock().unwrap();
    Ok(s.trusted_scripts.iter().any(|p| p == &note_path))
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported_count: usize,
    pub skipped: Vec<String>,
    pub imported: Vec<String>,
}

#[tauri::command]
fn import_notes(
    state: State<'_, AppState>,
    file_paths: Vec<String>,
    target_folder: Option<String>,
) -> Result<ImportResult, String> {
    let settings = state.settings.lock().unwrap();
    let notes_dir = &settings.notes_directory;
    let root = Path::new(notes_dir);

    // Determine destination folder (can be absolute path or relative)
    let dest_dir = match &target_folder {
        Some(folder) if !folder.is_empty() => {
            let p = Path::new(folder);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                root.join(folder)
            }
        }
        _ => root.to_path_buf(),
    };
    let _ = fs::create_dir_all(&dest_dir);

    let mut imported: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    let db = state.db.lock().unwrap();

    for source_path_str in &file_paths {
        let source = Path::new(source_path_str);

        if !source.exists() {
            skipped.push(format!("{}: file not found", source_path_str));
            continue;
        }

        // Only accept .md files
        let ext = source.extension().map(|e| e.to_string_lossy().to_lowercase());
        if ext.as_deref() != Some("md") {
            skipped.push(format!("{}: not a .md file", source_path_str));
            continue;
        }

        let file_name = source.file_name().unwrap();
        let mut dest_path = dest_dir.join(file_name);

        // Deduplicate filename if already exists
        if dest_path.exists() {
            let stem = source.file_stem().unwrap().to_string_lossy().to_string();
            let mut counter = 1;
            loop {
                let new_name = format!("{}_{}.md", stem, counter);
                let candidate = dest_dir.join(&new_name);
                if !candidate.exists() {
                    dest_path = candidate;
                    break;
                }
                counter += 1;
            }
        }

        // Read content
        let content = match fs::read_to_string(source) {
            Ok(c) => c,
            Err(e) => {
                skipped.push(format!("{}: {}", source_path_str, e));
                continue;
            }
        };

        // Copy referenced images from source's assets folder
        let source_dir = source.parent().unwrap_or(Path::new("."));
        let source_assets = source_dir.join("assets");
        if source_assets.exists() {
            let dest_assets = dest_dir.join("assets");
            let _ = fs::create_dir_all(&dest_assets);

            // Find image references in the content
            let re = regex_lite::Regex::new(r"!\[[^\]]*\]\(\./assets/([^)]+)\)").unwrap();
            for cap in re.captures_iter(&content) {
                if let Some(m) = cap.get(1) {
                    let img_name = m.as_str().replace("%20", " ");
                    let src_img = source_assets.join(&img_name);
                    let dst_img = dest_assets.join(&img_name);
                    if src_img.exists() && !dst_img.exists() {
                        let _ = fs::copy(&src_img, &dst_img);
                    }
                }
            }
        }

        // Write the note
        if let Err(e) = fs::write(&dest_path, &content) {
            skipped.push(format!("{}: {}", source_path_str, e));
            continue;
        }

        // Index in database
        if let Ok(rp) = dest_path.strip_prefix(root) {
            let rp_str = rp.to_string_lossy().to_string();
            let title = dest_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let mtime = fs::metadata(&dest_path)
                .and_then(|m| m.modified())
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                .unwrap_or(0);
            database::upsert_note(&db, &rp_str, &title, &content, mtime);
        }

        imported.push(dest_path.file_stem().unwrap_or_default().to_string_lossy().to_string());
    }

    Ok(ImportResult {
        imported_count: imported.len(),
        skipped,
        imported,
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();
    let _ = fs::create_dir_all(&settings.notes_directory);

    let db = database::open_db(&settings.notes_directory)
        .expect("Failed to open database");
    database::sync_index(&db, &settings.notes_directory);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            db: Mutex::new(db),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            read_tree,
            read_note,
            save_note,
            create_folder,
            create_note,
            rename_node,
            delete_node,
            move_node,
            copy_image_to_assets,
            read_image_base64,
            export_html,
            export_pdf,
            search_notes,
            get_all_tags,
            get_notes_by_tag,
            get_note_tags,
            rebuild_index,
            get_recent_notes,
            get_all_notes_sorted,
            get_tag_graph,
            is_favorite,
            toggle_favorite,
            get_favorite_notes,
            import_notes,
            get_vaults,
            add_vault,
            remove_vault,
            switch_vault,
            run_lua_script,
            set_note_trusted,
            is_note_trusted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
