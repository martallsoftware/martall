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
    /// Note type for the tree icon ("note", "tasks", "daily", "drawing", …); empty for folders.
    #[serde(default)]
    pub kind: String,
    /// Pin weight: > 0 is pinned to the top of its folder, higher first.
    #[serde(default)]
    pub weight: i64,
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

/// Data the tree needs besides the file system: note kinds and pin weights,
/// both keyed by path relative to the vault root.
struct TreeCtx<'a> {
    root: &'a Path,
    kinds: std::collections::HashMap<String, String>,
    weights: std::collections::HashMap<String, i64>,
}

fn rel_key(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn build_tree(dir: &Path, ctx: &TreeCtx) -> Vec<TreeNode> {
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

        let key = rel_key(ctx.root, &path);
        let weight = ctx.weights.get(&key).copied().unwrap_or(0);
        if path.is_dir() {
            let children = build_tree(&path, ctx);
            folders.push(TreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_folder: true,
                children,
                kind: String::new(),
                weight,
            });
        } else if database::is_indexable(&path) {
            let display_name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            // Not indexed yet (just created elsewhere): work out the kind from the path alone.
            let kind = ctx.kinds.get(&key).cloned().unwrap_or_else(|| database::note_kind(&key, "").to_string());
            files.push(TreeNode {
                name: display_name,
                path: path.to_string_lossy().to_string(),
                is_folder: false,
                children: Vec::new(),
                kind,
                weight,
            });
        }
    }

    // Pinned (weight > 0) first, highest weight on top; then by name.
    let order = |a: &TreeNode, b: &TreeNode| {
        b.weight.cmp(&a.weight).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    };
    folders.sort_by(order);
    files.sort_by(order);

    folders.extend(files);
    folders
}

// ---------------------------------------------------------------------------
// Pin weights: <vault>/.martall/weights.json, { "Folder/Note.md": 3, … }
// Kept in the vault (not the index) so it syncs and survives a rebuild.
// ---------------------------------------------------------------------------

fn weights_path(root: &Path) -> PathBuf {
    root.join(".martall").join("weights.json")
}

fn load_weights(root: &Path) -> std::collections::HashMap<String, i64> {
    fs::read_to_string(weights_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_weights(root: &Path, weights: &std::collections::HashMap<String, i64>) -> Result<(), String> {
    let path = weights_path(root);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(weights).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// After a rename/move (`new` = Some) or delete (`new` = None) of `old`
/// (a file or folder, relative keys), move or drop the weights under it.
fn rekey_weights(root: &Path, old: &str, new: Option<&str>) {
    let mut weights = load_weights(root);
    let prefix = format!("{}/", old);
    let affected: Vec<String> = weights
        .keys()
        .filter(|k| k.as_str() == old || k.starts_with(&prefix))
        .cloned()
        .collect();
    if affected.is_empty() {
        return;
    }
    for k in affected {
        let w = weights.remove(&k).unwrap_or(0);
        if let Some(new) = new {
            weights.insert(format!("{}{}", new, &k[old.len()..]), w);
        }
    }
    let _ = save_weights(root, &weights);
}

/// Set pin weights for absolute paths; 0 unpins.
#[tauri::command]
fn set_weights(state: State<'_, AppState>, updates: std::collections::HashMap<String, i64>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    let mut weights = load_weights(root);
    for (path, w) in updates {
        let key = rel_key(root, Path::new(&path));
        if w > 0 {
            weights.insert(key, w);
        } else {
            weights.remove(&key);
        }
    }
    save_weights(root, &weights)
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
    let kinds = database::note_kinds(&state.db.lock().unwrap());
    let ctx = TreeCtx { root, kinds, weights: load_weights(root) };
    build_tree(root, &ctx)
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
        database::upsert_note(&db, &rp_str, &title, &database::index_text(Path::new(&path), &content), mtime);
    }
    Ok(())
}

/// Create `<name>.excalidraw` in `parent_dir` with the given scene JSON.
#[tauri::command]
fn create_drawing(
    state: State<'_, AppState>,
    parent_dir: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let ext = format!(".{}", database::DRAWING_EXT);
    let stem = name.trim().trim_end_matches(ext.as_str());
    if stem.is_empty() || stem.contains('/') || stem.contains('\\') {
        return Err("Invalid drawing name".to_string());
    }
    let full_path = Path::new(&parent_dir).join(format!("{}{}", stem, ext));
    if full_path.exists() {
        return Err(format!("A drawing named '{}' already exists", stem));
    }
    fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    if let Ok(rp) = full_path.strip_prefix(root) {
        let db = state.db.lock().unwrap();
        database::upsert_note(&db, &rp.to_string_lossy(), stem, &database::index_text(&full_path, &content), 0);
    }
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Vault folder whose `.md` files are offered as templates for new notes.
const TEMPLATES_FOLDER: &str = "Templates";
/// Lists default templates already written once, so deleted ones stay deleted.
const TEMPLATES_SEEDED_FILE: &str = ".seeded";
/// Used for new daily notes when present in the templates folder.
const DAILY_TEMPLATE: &str = "Daily";

const DEFAULT_TEMPLATES: &[(&str, &str)] = &[
    ("Todo", "# {{title}}\n\n\
Created {{date}}\n\n\
## Todo\n\
- [ ] \n\n\
## Done\n"),
    ("Routine", "# {{title}}\n\n\
#routine\n\n\
- [ ] First item\n\
- [ ] Second item\n\n\
## Log\n"),
    ("Daily", "# {{date}} · {{weekday}}\n\n\
## Top 3 today\n\
- [ ] \n\
- [ ] \n\
- [ ] \n\n\
## Notes\n\n\n\
## Log\n"),
    ("Meeting", "# {{title}}\n\n\
#meeting · {{date}} {{time}}\n\n\
**Attendees:** {{ask:Attendees}}\n\n\
## Agenda\n\
1. \n\n\
## Notes\n\n\n\
## Decisions\n\
- \n\n\
## Action items\n\
- [ ] Who: what 📅 {{date}}\n"),
    ("Gym – Push", "# {{title}}\n\n\
#routine #gym\n\n\
- [ ] Bench press 4×8 @ 60kg\n\
- [ ] Overhead press 3×8 @ 35kg\n\
- [ ] Incline dumbbell press 3×10 @ 20kg\n\
- [ ] Lateral raises 3×15 @ 8kg\n\
- [ ] Triceps pushdown 3×12 @ 25kg\n\n\
## Log\n"),
    ("Gym – Pull", "# {{title}}\n\n\
#routine #gym\n\n\
- [ ] Deadlift 3×5 @ 100kg\n\
- [ ] Pull-ups 3×8\n\
- [ ] Barbell row 4×8 @ 60kg\n\
- [ ] Face pulls 3×15 @ 15kg\n\
- [ ] Biceps curls 3×12 @ 12kg\n\n\
## Log\n"),
    ("Gym – Legs", "# {{title}}\n\n\
#routine #gym\n\n\
- [ ] Squats 4×8 @ 80kg\n\
- [ ] Romanian deadlift 3×10 @ 60kg\n\
- [ ] Leg press 3×10 @ 120kg\n\
- [ ] Lunges 3×12 @ 16kg\n\
- [ ] Calf raises 4×15 @ 40kg\n\n\
## Log\n"),
    ("Body metrics", "# {{title}}\n\n\
#metrics\n\n\
Track: weight (kg) · waist (cm) · sleep (h) · steps\n\n\
## Log\n"),
    ("Weekly review", "# {{title}}\n\n\
#review · Week {{week}}\n\n\
Days: {{week_days}}\n\n\
## Wins\n\
- \n\n\
## What didn't go well\n\
- \n\n\
## Lessons\n\
- \n\n\
## Next week's top 3\n\
- [ ] \n\
- [ ] \n\
- [ ] \n"),
    ("Project", "# {{title}}\n\n\
#project · started {{date}}\n\n\
**Goal:** {{ask:Goal}}  \n\
**Status:** 🟡 Planning\n\n\
## Milestones\n\
- [ ] Plan 📅 {{date}}\n\
- [ ] First version\n\
- [ ] Done\n\n\
## Timeline\n\
```mermaid\n\
gantt\n\
  dateFormat YYYY-MM-DD\n\
  section Work\n\
  Plan :a1, {{date}}, 7d\n\
  Build :a2, after a1, 14d\n\
  Polish :after a2, 7d\n\
```\n\n\
## Notes\n\n\n\
## Links\n\
- \n"),
    ("Bug report", "# {{title}}\n\n\
#bug · {{date}} · Project: {{ask:Project}}\n\n\
**Status:** 🔴 Open  \n\
**Version:** \n\n\
## Steps to reproduce\n\
1. \n\n\
## Expected\n\n\n\
## Actual\n\n\n\
## Logs\n\
```text\n\
\n\
```\n\n\
## Fix\n\
- [ ] Find cause\n\
- [ ] Fix\n\
- [ ] Test\n"),
    ("Book", "# {{title}}\n\n\
#book · {{ask:Author}} · started {{date}}\n\n\
**Rating:** ☆☆☆☆☆  \n\
**Finished:** \n\n\
## Summary\n\n\n\
## Quotes\n\
> \n\n\
## Takeaways\n\
- \n"),
    ("Film", "# {{title}}\n\n\
#film · watched {{date}}\n\n\
**Director:** {{ask:Director}}  \n\
**Rating:** ☆☆☆☆☆\n\n\
## Thoughts\n\n\n\
## Favourite scenes\n\
- \n"),
    ("Recipe", "# {{title}}\n\n\
#recipe · serves {{ask:Servings}}\n\n\
**Time:** \n\n\
## Ingredients\n\
- [ ] \n\n\
## Steps\n\
1. \n\n\
## Notes\n"),
    ("Packing list", "# {{title}}\n\n\
#routine #travel\n\n\
- [ ] Passport / ID\n\
- [ ] Wallet & cards\n\
- [ ] Keys\n\
- [ ] Phone + charger\n\
- [ ] Headphones\n\
- [ ] Laptop + charger\n\
- [ ] Toiletries\n\
- [ ] Medicine\n\
- [ ] Clothes\n\n\
## Log\n"),
    ("Morning routine", "# {{title}}\n\n\
#routine #habit\n\n\
- [ ] Glass of water\n\
- [ ] Stretch 10 min\n\
- [ ] No phone first 30 min\n\
- [ ] Plan the day\n\n\
## Log\n"),
    ("Weekly cleaning", "# {{title}}\n\n\
#routine #home\n\n\
- [ ] Vacuum\n\
- [ ] Mop floors\n\
- [ ] Bathroom\n\
- [ ] Kitchen surfaces\n\
- [ ] Change bed sheets\n\
- [ ] Take out recycling\n\n\
## Log\n"),
    ("Home & car maintenance", "# {{title}}\n\n\
#routine #home\n\n\
- [ ] Test smoke alarms\n\
- [ ] Clean dishwasher filter\n\
- [ ] Clean fridge\n\
- [ ] Car tyre pressure\n\
- [ ] Car oil & washer fluid\n\n\
## Log\n"),
];

/// Write any default template that hasn't been written before.
fn seed_templates(root: &Path) -> Result<(), String> {
    let dir = root.join(TEMPLATES_FOLDER);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let marker = dir.join(TEMPLATES_SEEDED_FILE);
    let mut seeded: Vec<String> = fs::read_to_string(&marker)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let mut changed = false;
    for (name, body) in DEFAULT_TEMPLATES {
        if seeded.iter().any(|s| s == name) {
            continue;
        }
        let path = dir.join(format!("{}.md", name));
        if !path.exists() {
            fs::write(&path, body).map_err(|e| e.to_string())?;
        }
        seeded.push(name.to_string());
        changed = true;
    }
    if changed {
        fs::write(&marker, seeded.join("\n") + "\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List template names (file stems) in the vault's `Templates/` folder,
/// adding any new default templates first.
#[tauri::command]
fn list_templates(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    seed_templates(root)?;
    let mut names: Vec<String> = fs::read_dir(root.join(TEMPLATES_FOLDER))
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().map_or(false, |x| x == "md"))
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
        .filter(|n| n != DAILY_TEMPLATE)
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

fn ask_regex() -> regex_lite::Regex {
    regex_lite::Regex::new(r"\{\{ask:([^}]+)\}\}").unwrap()
}

fn read_template(root: &Path, name: &str) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid template name".into());
    }
    let path = root.join(TEMPLATES_FOLDER).join(format!("{}.md", name));
    fs::read_to_string(&path).map_err(|e| format!("Template '{}': {}", name, e))
}

/// The `{{ask:Label}}` labels in a template, in order, without duplicates.
#[tauri::command]
fn template_questions(state: State<'_, AppState>, name: String) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().unwrap();
    let raw = read_template(Path::new(&settings.notes_directory), &name)?;
    let mut out: Vec<String> = Vec::new();
    for c in ask_regex().captures_iter(&raw) {
        let label = c[1].trim().to_string();
        if !out.contains(&label) {
            out.push(label);
        }
    }
    Ok(out)
}

/// Read `Templates/<name>.md` and fill in its placeholders:
/// `{{title}}`, `{{date}}`, `{{weekday}}`, `{{week}}` (2026-W42) and
/// `{{week_days}}` (links to that week's daily notes) from `date`,
/// `{{time}}` (now), and `{{ask:Label}}` from `answers` (empty if missing).
fn render_template(
    root: &Path,
    name: &str,
    title: &str,
    date: chrono::NaiveDate,
    answers: &std::collections::HashMap<String, String>,
) -> Result<String, String> {
    use chrono::Datelike;
    let raw = read_template(root, name)?;
    let monday = date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
    let week_days = (0..7)
        .map(|i| format!("[[{}]]", (monday + chrono::Duration::days(i)).format("%Y-%m-%d")))
        .collect::<Vec<_>>()
        .join(" · ");
    let filled = raw
        .replace("{{title}}", title)
        .replace("{{date}}", &date.format("%Y-%m-%d").to_string())
        .replace("{{weekday}}", &date.format("%A").to_string())
        .replace("{{week}}", &date.format("%G-W%V").to_string())
        .replace("{{week_days}}", &week_days)
        .replace("{{time}}", &chrono::Local::now().format("%H:%M").to_string());
    Ok(ask_regex()
        .replace_all(&filled, |c: &regex_lite::Captures| {
            answers.get(c[1].trim()).cloned().unwrap_or_default()
        })
        .into_owned())
}

#[tauri::command]
fn create_note(
    state: State<'_, AppState>,
    parent_dir: String,
    name: String,
    template: Option<String>,
    answers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let file_name = if name.ends_with(".md") {
        name.clone()
    } else {
        format!("{}.md", name)
    };
    let full_path = Path::new(&parent_dir).join(&file_name);
    if full_path.exists() {
        return Err(format!("A note named '{}' already exists", file_name));
    }
    let title = full_path.file_stem().unwrap_or_default().to_string_lossy().to_string();

    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    let content = match template.as_deref() {
        Some(t) if !t.is_empty() => {
            let answers = answers.unwrap_or_default();
            render_template(root, t, &title, chrono::Local::now().date_naive(), &answers)?
        }
        _ => String::new(),
    };
    fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    // Index the new note
    if let Ok(rp) = full_path.strip_prefix(root) {
        let rp_str = rp.to_string_lossy().to_string();
        let db = state.db.lock().unwrap();
        database::upsert_note(&db, &rp_str, &title, &content, 0);
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
        // Keep the file's own extension (.md or .excalidraw).
        let ext = old.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| "md".into());
        let suffix = format!(".{}", ext);
        let file_name = if new_name.ends_with(&suffix) {
            new_name.clone()
        } else {
            format!("{}{}", new_name, suffix)
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
    rekey_weights(root, &rel_key(root, old), Some(&rel_key(root, &new_path)));

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_node(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    rekey_weights(root, &rel_key(root, p), None);

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
    rekey_weights(root, &rel_key(root, src), Some(&rel_key(root, &dest)));

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

/// Write an exported file (drawing JSON, SVG, or PNG) to a path the user chose
/// in a save dialog. `base64` marks binary content sent as base64 text.
#[tauri::command]
fn write_export_file(path: String, contents: String, base64: Option<bool>) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = if base64.unwrap_or(false) {
        base64::engine::general_purpose::STANDARD
            .decode(contents.as_bytes())
            .map_err(|e| format!("Invalid image data: {}", e))?
    } else {
        contents.into_bytes()
    };
    fs::write(&path, bytes).map_err(|e| e.to_string())
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
// Reveal in OS file manager
// ---------------------------------------------------------------------------

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if p.is_dir() {
            path.clone()
        } else {
            p.parent()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or(path.clone())
        };
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

// ---------------------------------------------------------------------------
// Search and tag commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn search_notes(state: State<'_, AppState>, query: String) -> Result<Vec<database::SearchResult>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    let mut results = database::search(&db, &settings.notes_directory, &query);
    let active_name = settings
        .vaults
        .iter()
        .find(|v| v.path == settings.notes_directory)
        .map(|v| v.name.clone())
        .unwrap_or_default();
    for r in results.iter_mut() {
        r.vault = active_name.clone();
        r.vault_path = settings.notes_directory.clone();
    }
    Ok(results)
}

#[tauri::command]
fn search_all_vaults(state: State<'_, AppState>, query: String) -> Result<Vec<database::SearchResult>, String> {
    let (vaults, active_path) = {
        let s = state.settings.lock().unwrap();
        (s.vaults.clone(), s.notes_directory.clone())
    };

    let mut merged: Vec<database::SearchResult> = Vec::new();

    for v in &vaults {
        let mut results = if v.path == active_path {
            let db = state.db.lock().unwrap();
            database::search(&db, &v.path, &query)
        } else {
            match database::open_db(&v.path) {
                Ok(conn) => database::search(&conn, &v.path, &query),
                Err(_) => continue,
            }
        };
        for r in results.iter_mut() {
            r.vault = v.name.clone();
            r.vault_path = v.path.clone();
        }
        merged.append(&mut results);
    }

    Ok(merged)
}

#[tauri::command]
fn sync_all_vault_indexes(state: State<'_, AppState>) -> Result<(), String> {
    let (vaults, active_path) = {
        let s = state.settings.lock().unwrap();
        (s.vaults.clone(), s.notes_directory.clone())
    };

    for v in &vaults {
        if v.path == active_path {
            continue;
        }
        if !Path::new(&v.path).exists() {
            continue;
        }
        if let Ok(conn) = database::open_db(&v.path) {
            database::sync_index(&conn, &v.path);
        }
    }

    Ok(())
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

/// Incremental sync — only re-indexes files whose mtime changed since the
/// last scan. Cheap; safe to call on every window focus.
#[tauri::command]
fn sync_index(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
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
// Wiki links / backlinks
// ---------------------------------------------------------------------------

#[tauri::command]
fn resolve_wiki_links(
    state: State<'_, AppState>,
    targets: Vec<String>,
    from_path: Option<String>,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::resolve_wiki_links(
        &db,
        &settings.notes_directory,
        targets,
        from_path.as_deref(),
    ))
}

#[tauri::command]
fn get_backlinks(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<database::NoteInfo>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_backlinks(&db, &settings.notes_directory, &path))
}

// ---------------------------------------------------------------------------
// Task due dates
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_due_tasks(
    state: State<'_, AppState>,
    include_done: Option<bool>,
) -> Result<Vec<database::TaskItem>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_due_tasks(
        &db,
        &settings.notes_directory,
        include_done.unwrap_or(false),
    ))
}

#[tauri::command]
fn get_all_tasks(state: State<'_, AppState>) -> Result<Vec<database::TaskItem>, String> {
    let settings = state.settings.lock().unwrap();
    let db = state.db.lock().unwrap();
    Ok(database::get_all_tasks(&db, &settings.notes_directory, TEMPLATES_FOLDER))
}

// ---------------------------------------------------------------------------
// Daily notes
// ---------------------------------------------------------------------------

fn is_iso_date_str(s: &str) -> bool {
    if s.len() != 10 { return false; }
    let bytes = s.as_bytes();
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && [0,1,2,3,5,6,8,9].iter().all(|&i| bytes[i].is_ascii_digit())
}

#[tauri::command]
fn list_daily_notes(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = state.db.lock().unwrap();
    Ok(database::list_daily_notes(&db))
}

/// Open the daily note for `date` (YYYY-MM-DD), creating `Daily/<date>.md`
/// from a small template if it doesn't exist. Returns the absolute path.
#[tauri::command]
fn open_or_create_daily_note(
    state: State<'_, AppState>,
    date: String,
) -> Result<String, String> {
    if !is_iso_date_str(&date) {
        return Err("Invalid date; expected YYYY-MM-DD".into());
    }
    let settings = state.settings.lock().unwrap();
    let root = Path::new(&settings.notes_directory);
    let daily_dir = root.join(database::DAILY_FOLDER);
    fs::create_dir_all(&daily_dir).map_err(|e| e.to_string())?;
    let note_path = daily_dir.join(format!("{}.md", date));
    if !note_path.exists() {
        // Daily notes use Templates/Daily.md when it exists.
        let _ = seed_templates(root);
        let template = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .ok()
            .filter(|_| root.join(TEMPLATES_FOLDER).join(format!("{}.md", DAILY_TEMPLATE)).exists())
            .and_then(|d| render_template(root, DAILY_TEMPLATE, &date, d, &Default::default()).ok())
            .unwrap_or_else(|| format!("# {}\n\n", date));
        fs::write(&note_path, &template).map_err(|e| e.to_string())?;
        let db = state.db.lock().unwrap();
        let mtime = fs::metadata(&note_path)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0);
        let rp = format!("{}/{}.md", database::DAILY_FOLDER, date);
        database::upsert_note(&db, &rp, &date, &template, mtime);
    }
    Ok(note_path.to_string_lossy().to_string())
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
            create_drawing,
            set_weights,
            write_export_file,
            list_templates,
            template_questions,
            rename_node,
            delete_node,
            move_node,
            copy_image_to_assets,
            read_image_base64,
            export_html,
            export_pdf,
            search_notes,
            search_all_vaults,
            sync_all_vault_indexes,
            reveal_in_file_manager,
            get_all_tags,
            get_notes_by_tag,
            get_note_tags,
            rebuild_index,
            sync_index,
            get_recent_notes,
            get_all_notes_sorted,
            get_tag_graph,
            resolve_wiki_links,
            get_backlinks,
            list_daily_notes,
            open_or_create_daily_note,
            get_due_tasks,
            get_all_tasks,
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

#[cfg(test)]
mod weight_tests {
    use super::*;

    #[test]
    fn pinned_first_and_rekeyed_on_move() {
        let root = std::env::temp_dir().join(format!("martall-weights-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Proj")).unwrap();
        for f in ["Proj/a.md", "Proj/b.md", "Proj/c.md"] {
            fs::write(root.join(f), "x").unwrap();
        }
        let mut w = std::collections::HashMap::new();
        w.insert("Proj/c.md".to_string(), 1);
        w.insert("Proj/b.md".to_string(), 2);
        save_weights(&root, &w).unwrap();
        let names = |root: &Path| -> Vec<String> {
            let ctx = TreeCtx { root, kinds: Default::default(), weights: load_weights(root) };
            build_tree(&root.join("Proj"), &ctx).into_iter().map(|n| format!("{}:{}", n.name, n.weight)).collect()
        };
        assert_eq!(names(&root), vec!["b:2", "c:1", "a:0"]);
        rekey_weights(&root, "Proj", Some("Work/Proj"));
        assert_eq!(load_weights(&root).get("Work/Proj/b.md"), Some(&2));
        rekey_weights(&root, "Work/Proj/b.md", None);
        assert_eq!(load_weights(&root).len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn writes_text_and_base64_exports() {
        let dir = std::env::temp_dir().join(format!("martall-export-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let svg = dir.join("a.svg");
        write_export_file(svg.to_string_lossy().into(), "<svg/>".into(), None).unwrap();
        assert_eq!(fs::read_to_string(&svg).unwrap(), "<svg/>");
        let png = dir.join("a.png");
        // "iVBORw0KGgo=" is the 8-byte PNG signature.
        write_export_file(png.to_string_lossy().into(), "iVBORw0KGgo=".into(), Some(true)).unwrap();
        assert_eq!(fs::read(&png).unwrap(), b"\x89PNG\r\n\x1a\n");
        assert!(write_export_file(png.to_string_lossy().into(), "%%%".into(), Some(true)).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod template_tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("martall-test-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn seeding_adds_new_defaults_but_not_deleted_ones() {
        let root = temp_vault("seed");
        let dir = root.join(TEMPLATES_FOLDER);
        seed_templates(&root).unwrap();
        for (name, _) in DEFAULT_TEMPLATES {
            assert!(dir.join(format!("{}.md", name)).exists(), "{} missing", name);
        }
        fs::remove_file(dir.join("Meeting.md")).unwrap();
        fs::write(dir.join("Todo.md"), "my own todo").unwrap();
        seed_templates(&root).unwrap();
        assert!(!dir.join("Meeting.md").exists());
        assert_eq!(fs::read_to_string(dir.join("Todo.md")).unwrap(), "my own todo");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn render_fills_placeholders_and_rejects_paths() {
        let root = temp_vault("render");
        seed_templates(&root).unwrap();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let none = std::collections::HashMap::new();
        let daily = render_template(&root, DAILY_TEMPLATE, "2026-10-15", date, &none).unwrap();
        assert!(daily.starts_with("# 2026-10-15 · Thursday\n"));
        let gym = render_template(&root, "Gym – Legs", "Leg day", date, &none).unwrap();
        assert!(gym.starts_with("# Leg day\n\n#routine"));
        assert!(render_template(&root, "../secret", "x", date, &none).is_err());

        let review = render_template(&root, "Weekly review", "W42", date, &none).unwrap();
        assert!(review.contains("Week 2026-W42"));
        assert!(review.contains("Days: [[2026-10-12]] · [[2026-10-13]]"));
        assert!(review.contains("[[2026-10-18]]\n"));

        let mut answers = std::collections::HashMap::new();
        answers.insert("Goal".to_string(), "Ship v1".to_string());
        let project = render_template(&root, "Project", "Martall", date, &answers).unwrap();
        assert!(project.contains("**Goal:** Ship v1"));
        assert!(!project.contains("{{"));
        let meeting = render_template(&root, "Meeting", "Sync", date, &none).unwrap();
        assert!(meeting.contains("**Attendees:** \n"));
        fs::remove_dir_all(&root).unwrap();
    }
}
