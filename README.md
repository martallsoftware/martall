# Martall

A local-first markdown note-taking app built with Tauri + React. Notes live as
plain `.md` files in a vault folder on disk, so they sync via iCloud / Dropbox /
git and stay readable from any other markdown app — including the companion
iPhone app.

Version: see top of `package.json`.

---

## Features

### Core
- Tree of folders + notes, edit / split / preview modes
- Live markdown preview with GFM, tables, mermaid diagrams, math
- Tag cloud, full-text search, tag graph view
- Multiple vaults
- Favorites, recents
- Import / export (HTML, PDF)
- Drag-and-drop image insertion at cursor (see below)

### Templates & todos
- **New Note** (header button or tree context menu) has a **Template** picker.
  Every `.md` file in the vault's `Templates/` folder is a template; the folder
  is created with a `Todo.md` template the first time the dialog opens.
- Placeholders filled in on create: `{{title}}`, `{{date}}` (YYYY-MM-DD), `{{time}}` (HH:MM).
- Checkboxes (`- [ ] …`) are clickable in the preview and toggle `[ ]` ↔ `[x]`
  in the file. Add `📅 YYYY-MM-DD` to a task to show it in the Tasks panel.

### Templates
- **New Note** (header button or tree context menu) has a **Template** picker.
  Every `.md` file in the vault's `Templates/` folder is a template.
- Built-in defaults are added to `Templates/` when missing. Edit them freely;
  a deleted default is not re-created (`Templates/.seeded` remembers them).

  | Kind | Templates |
  |---|---|
  | Notes | Todo, Meeting, Weekly review, Project, Bug report, Book, Film, Recipe |
  | Routines | Routine, Gym – Push / Pull / Legs, Morning routine, Weekly cleaning, Home & car maintenance, Packing list |
  | Metrics | Body metrics |
  | Daily notes | Daily |

- `Templates/Daily.md` is used for new daily notes (Calendar, Cmd/Ctrl+Shift+D)
  and is hidden from the New Note picker.
- Placeholders:

  | Placeholder | Becomes |
  |---|---|
  | `{{title}}` | the note name |
  | `{{date}}` / `{{weekday}}` | `2026-10-15` / `Thursday` (the note's day for daily notes) |
  | `{{time}}` | `14:30` |
  | `{{week}}` | `2026-W42` |
  | `{{week_days}}` | links to that week's daily notes, Monday–Sunday |
  | `{{ask:Label}}` | asked in the New Note dialog, e.g. `{{ask:Goal}}` |
- Checkboxes (`- [ ] …`) are clickable in the preview and toggle `[ ]` ↔ `[x]`
  in the file. Add `📅 YYYY-MM-DD` to a task to show it in the Tasks panel.

### Tasks
Task lines use the Obsidian Tasks emoji format, so notes stay compatible:

```markdown
- [ ] Take out the trash 🔼 🔁 every week on Monday ➕ 2026-10-15 📅 2026-10-19
```

| Marker | Meaning |
|---|---|
| `[ ]` `[/]` `[x]` `[-]` | todo, in progress, done, cancelled |
| 🔺 ⏫ 🔼 🔽 ⏬ | highest, high, medium, low, lowest priority |
| 🔁 | recurs: `every day`, `every 3 days`, `every weekday`, `every week on Monday, Thursday`, `every 2 weeks`, `every month on the 15th`, `every month on the last`, `every year`; add `when done` to count from the completion date |
| 📅 ⏳ 🛫 | due, scheduled, start |
| ➕ ✅ ❌ | created, done, cancelled dates |

- **Task dialog:** ⌘/Ctrl+Shift+T or the ☑ toolbar button in the editor
  creates a task from the current line or edits the task on it. In the
  preview, hover a task and click ✎. Date fields accept `today`, `tm`, `mon`,
  `next fri`, `+3d`, `2 weeks`, `next month`, `15/10/2026` or `2026-10-15`.
- **Completing** a task in the preview adds `✅ <today>`. A recurring task
  also gets its next occurrence (dates moved forward) inserted above it.
  Clicking again re-opens it.
- The **Tasks panel** lists every task with a 📅 due date, sorted by date and
  then priority, with priority and 🔁 icons.
- **📊 in the Tasks panel** shows charts over *all* tasks (dated or not;
  `Templates/` and `#routine` notes are left out): completed per week (✅),
  coming up (overdue + next 14 days by 📅), open tasks by priority, and
  created (➕) vs done per week.

### Routines (recurring checklists)
A note tagged `#routine` is a reusable checklist, e.g. a gym workout:

```markdown
# Gym – Legs

#routine

- [ ] Squats 3×8 @ 80kg
- [ ] Lunges 3×12

## Log
```

- The preview shows a progress bar and a **Finish session** button.
- **Finish session** adds a dated line under `## Log` (newest first) with the
  ticked items and what was skipped, then unticks everything. Edited numbers
  (`@ 82.5kg`) stay for next time.
- The session is also linked from that day's daily note, so it shows in the Calendar.
- Below the note, **History** shows a 16-week calendar grid (darker = more
  items done that day), the current day streak, sessions per week and weight
  progress for every item with an `@ number`. A daily routine (e.g. Morning
  routine) works as a habit tracker this way.

Log line format:
`- 2026-10-15 — 3/4 — Squats 3×8 @ 80kg · Leg press 3×10 @ 120kg — skipped: Lunges 3×12`

### Metrics logs
A note tagged `#metrics` tracks numbers over time (weight, sleep, steps, …):

```markdown
# Body metrics

#metrics

Track: weight (kg) · waist (cm) · sleep (h) · steps

## Log
- 2026-10-15 — weight 82.4 kg · sleep 7.5 h · steps 9500
```

- The preview shows an input for each `Track:` metric. **Save** writes today's
  line under `## Log` (newest first); saving again the same day updates it.
- Below the note, **History** draws one chart per metric.

### Drawings (Excalidraw)
A drawing page for diagrams in the style of Visio: boxes, arrows that stick to
shapes, text, freehand pen, images and frames. Each drawing is saved in the
vault as `Name.excalidraw` (plain JSON, the same format excalidraw.com and the
Obsidian Excalidraw plugin use).

- **New:** right-click in the tree → **New Drawing**, or pick
  **✏️ Excalidraw drawing** in the *Template* list of any **New Note** dialog
  (+ button, Home panel, tree menu).
- **Library** (top right) has extra shapes in the four diagram colours
  (green = ready, amber dashed = to do, grey dashed = external, blue = records):
  process, database, storage (striped cylinder), queue / log (horizontal
  cylinder), document, files (stack), folder, API (hexagon), decision,
  start / end and a group frame. Developer extras in one colour (recolour
  them in the properties panel): server / service, web app, mobile, user,
  cloud, scheduled job, note, a colour legend, and ready-made request,
  async (dashed) and numbered data-flow (thick green) arrows.
  Shapes you add to the library yourself are remembered.
- **Import Mermaid** (top right, or the ☰ menu) turns a Mermaid flowchart,
  sequence, class, ER or state diagram into editable shapes. Subgraphs,
  `classDef` colours, dashed and thick links, link labels and `linkStyle` are
  kept. Cylinders and document shapes become boxes, so swap in the library
  shapes if you want them.
- In a note's preview, hover over a Mermaid diagram and click **✏️ Edit as
  drawing**. This creates `<note> diagram.excalidraw` next to the note and
  opens it. Clicking it again on the same Mermaid code reopens that drawing
  (with your edits) instead of making a copy; changed Mermaid code gets a new
  drawing. Drawings save automatically. When you **Close** (or go **Back**),
  you choose: **Replace Mermaid with drawing** (the block becomes
  `![[<note> diagram]]`), **Add drawing below**, or **Just close**.
- **Show a drawing in a note** with `![[Name]]` (or `![[Name.excalidraw]]`).
  Double-click the picture, or click **Open drawing**, to edit it.
  `[[Name]]` links to it like a normal note. The **Insert drawing** button in
  the editor toolbar lists your drawings (with search) or creates a new one
  next to the note, and inserts the `![[…]]` line for you.
- **Size:** add a size after `|`, as in Obsidian: `![[Name|300]]` (300 px
  wide), `![[Name|300x200]]` (fits in 300 × 200, keeps its shape) or
  `![[Name|50%]]`. Sized previews show just the picture; hover it for
  *White card* / *Open*. Works for drawings and `.mmd` diagrams.
- **White card:** click **▢ White card** on any drawing preview to show
  previews as a light picture on white (like Obsidian) instead of following
  the app theme; **◐ Theme** switches back. The choice applies to all previews.
- **Obsidian vaults:** drawings made by the Obsidian Excalidraw plugin
  (`Name.excalidraw.md`) are recognised in place: they show as drawings in the
  tree, work in `![[Name.excalidraw]]` / `![[Name]]`, and open in the drawing
  editor. Saving writes back in Obsidian's format and only changes the drawing
  data and its text list; front matter, tags, your notes and *Embedded Files*
  are kept. (Embedded images stay in Obsidian and show as empty boxes here.)
- Text in drawings is indexed, so search, `#tags` and `[[links]]` inside a
  drawing work.
- **Back / Close:** the header shows **‹ Back** (to the note you came from)
  and, on a drawing, **✕ Close**. In notes, ⌘[ also goes back.
- **Import Excalidraw files:**
  - *Into the vault:* drop `.excalidraw` files (from excalidraw.com) or
    Obsidian Excalidraw notes (`.excalidraw.md`, compressed or not) on the app,
    or use the sidebar **Import** dialog (pick the target folder there). Each
    becomes a drawing; names already taken get " 2" etc. Images embedded in
    Obsidian drawings are not brought along.
  - *Into the open drawing:* ☰ → **Import file…**, or drop the file while a
    drawing is open. The shapes are added next to what is already there.
  - *Shape libraries:* drop or import `.excalidrawlib` files (e.g. AWS,
    Kubernetes, UML packs from libraries.excalidraw.com). The shapes appear in
    the **Library** panel and are remembered. **Browse libraries** in the
    Library panel opens that site in your browser; click *Download* there and
    drop the file on the app.
- **Pages:** one drawing can hold several pages. Each page is an Excalidraw
  *frame*, so the file still opens normally on excalidraw.com and in Obsidian
  (pages side by side on the canvas).
  - **▤ Pages** (top right) lists them: click to jump there, double-click to
    rename, ↑ ↓ to reorder (pages are renumbered "1 …", "2 …"), **+ Add page**
    adds a 16:9 page to the right. The first time, what is already drawn is
    put on page 1.
  - Show one page in a note: `![[Drawing#Data flow]]` or `![[Drawing#2]]`
    (works with sizes too: `![[Drawing#2|600]]`).
  - ☰ → Export → **PDF, one page per frame** gives a multi-page PDF (each A4
    page cropped to its frame). **Present** steps through the pages as slides.
- **Present:** **▶ Present** (top right, or ☰) shows the drawing read-only
  over the whole window, with a toolbar at the bottom:
  - **Laser pointer** (L, on by default): a red dot follows the pointer;
    hold the button to draw a glowing trail that fades after a second.
  - **Hand** (H): drag to pan. Scroll pans and pinch / ⌘-scroll zooms in
    both modes. Zoom − / Fit (F) / + buttons.
  - **Slides:** Excalidraw *frames* (frame tool, F while editing) become
    slides: ◀ ▶, the arrow keys, Space or PageUp/PageDown step through
    them, Home/End jump. Order is a leading number in the frame name
    ("1 Intro", "2 Flow"…), otherwise top-to-bottom, left-to-right. Frame
    borders and titles are hidden while presenting.
  - **Full screen** button (macOS full screen); **Exit** or Esc leaves.
- **Export:** ☰ → *Export* saves the drawing to a file you choose:
  *Excalidraw file* (`.excalidraw`, opens on excalidraw.com and in other
  Excalidraw tools), *Obsidian note* (`.excalidraw.md` for the Obsidian
  Excalidraw plugin), *PNG image* (2× resolution), *SVG image* or *PDF (A4)*
  (the drawing fitted on one A4 page, landscape or portrait to match, rendered
  sharp at up to 3×; made in the app, nothing extra to install). Images
  use the canvas background and the current light/dark theme. *Export
  image…* below it copies a PNG to the clipboard.

### Mermaid files (`.mmd`)
- `.mmd` files in the vault show in the tree (⇄ icon) and open like notes:
  Mermaid code on the left, the rendered diagram on the right. They are
  searchable (colour codes are not turned into tags), and the preview has
  **✏️ Edit as drawing**.
- **Templates:** New Note → *Template* has a **Mermaid (.mmd)** group:
  *Flowchart*, *Sequence*, *Architecture* (subgraphs + the four diagram
  colours: ready / todo / ext / info, numbered green data-flow links),
  *State* and *ER diagram*. They live in `Templates/` as `.mmd` files; add
  your own `.mmd` files there and they appear in the list. `{{title}}`,
  `{{date}}` and `{{ask:…}}` work as in other templates.
- `![[Name]]` in a note shows the `.mmd` diagram inline.

### Tree: note types and pinning
- **Icons by note type:** drawing (✏️ green), daily note (calendar, in
  `Daily/`), template (in `Templates/`), routine (`#routine`), metrics
  (`#metrics`), dashboard (`dashboard: true`), script (`lua-live`), tasks (has
  `- [ ]` items), note with a Mermaid diagram, and plain note. Hover an icon to
  see its type; it updates when you save.
- **Pin to top (weights):** right-click a note or folder → **📌 Pin to top**,
  then **↑ Move up** / **↓ Move down** to order pinned items, or **Unpin**.
  Pinned items come first in their folder, with a small pin. The order is
  stored in the vault in `.martall/weights.json` (syncs with the vault,
  survives *Refresh*), and follows renames, moves and deletes.

### UI
- **Movable split divider** between editor and preview. Drag to resize,
  double-click to reset to 50/50. The ratio is persisted to settings.
- **Refresh button** in the header — re-scans the vault, rebuilds the index,
  and reloads the current note from disk. Use it after another client (e.g. the
  iPhone app) edits files.
- Light / dark theme with a transparent SVG logo that adapts to either.
- Version number shown in the Home panel.

### Drag-and-drop images
Drop a `.png` / `.jpg` / `.gif` / `.svg` / `.webp` / `.bmp` / `.ico` onto the
window with a note open. The image is copied to the note's `assets/` folder and
`![](assets/…)` markdown is inserted at the **cursor position** in the editor.

---

## Scripted notes (`lua-live`)

Notes can contain sandboxed Lua 5.4 scripts that the preview executes and
renders inline. Useful for live dashboards: weather, status checks, calendars,
charts.

### Trust model
Every note containing a `lua-live` block is **untrusted** by default. The first
time you open such a note you'll see a yellow warning with a "Trust this note"
button. Click it once and the note's path is whitelisted in `settings.json`
(`trusted_scripts`). Untrusted notes never execute Lua.

### Sandbox
- Lua 5.4 via `mlua` (vendored, no system Lua needed)
- Only `string`, `table`, `math` stdlib loaded
- `io`, `os`, `package`, `require`, `debug`, `loadfile`, `dofile` removed
- 3 s wall-clock script timeout (instruction-count hook)
- 16 MB memory limit
- 5 s network timeout for HTTP calls
- 2 s TCP timeout for reachability checks

### Built-in API

| Function | Returns | Notes |
|---|---|---|
| `http.get(url)` | `{status, ok, body}` | gzip, rustls, custom UA |
| `json.decode(str)` | Lua table | |
| `json.encode(value)` | string | |
| `reachable(host, port?)` | bool | TCP connect, default port 443 |
| `now()` | int | unix timestamp |
| `date(fmt?)` | string | local time, default `%Y-%m-%d %H:%M` |
| `calendar.upcoming(path, days?)` | array of strings | parses `.ics`, default 7 days |
| `chart.line(spec)` | chart token | renders with Chart.js |
| `chart.area(spec)` | chart token | filled line chart |
| `chart.bar(spec)` | chart token | bar chart |

A script's return value becomes the rendered output. Strings render as text,
tables render line-by-line, and chart tokens render as interactive Chart.js
panels.

### Auto-refresh
Add a magic comment on any of the first 5 lines of a script:

```lua
-- refresh: 30s
```

Supported units: `s`, `m`, `h` (minimum 1 s). Each block also has a manual
re-run button (⟳) and shows when it last ran. Results are cached in memory so
unrelated edits to the note do not re-trigger the script.

### Examples

Stockholm temperature, refreshed every 5 minutes:

````markdown
```lua-live
-- refresh: 5m
local url = [[https://api.open-meteo.com/v1/forecast?latitude=59.33&longitude=18.07&current=temperature_2m]]
local r = http.get(url)
return "Stockholm: " .. json.decode(r.body).current.temperature_2m .. "°C"
```
````

> **Tip:** Long URLs in Lua should use `[[ ... ]]` long brackets so they
> survive line wrapping. Regular `"..."` strings cannot span lines.

Server status board:

````markdown
```lua-live
-- refresh: 60s
return {
  "github: " .. (reachable("github.com", 443) and "🟢 up" or "🔴 down"),
  "my server: " .. (reachable("example.com", 443) and "🟢 up" or "🔴 down"),
  "checked at " .. date("%H:%M:%S"),
}
```
````

Upcoming training from a `.ics` file:

````markdown
```lua-live
local items = calendar.upcoming("/Users/me/Calendars/training.ics", 7)
if #items == 0 then return "No training in the next week" end
return items
```
````

48-hour temperature chart:

````markdown
```lua-live
-- refresh: 5m
local url = [[https://api.open-meteo.com/v1/forecast?latitude=59.33&longitude=18.07&hourly=temperature_2m&forecast_days=2]]
local d = json.decode(http.get(url).body)
return chart.line({
  title  = "Stockholm — next 48h",
  labels = d.hourly.time,
  series = { { name = "°C", data = d.hourly.temperature_2m } },
  yLabel = "°C",
})
```
````

Multi-series line chart:

```lua
return chart.line({
  title = "API latency",
  labels = {"00","04","08","12","16","20"},
  series = {
    { name = "p50", data = {12,15,14,18,22,16} },
    { name = "p99", data = {40,55,48,90,120,70} },
  },
  yLabel = "ms",
})
```

### Chart spec
```lua
{
  title  = "...",                              -- optional
  labels = { "Mon", "Tue", "Wed" },            -- required
  series = {                                   -- required
    { name = "CPU", data = {12, 34, 22}, color = "#3b82f6" },
    { name = "Mem", data = {40, 55, 50} },
  },
  xLabel = "...",                              -- optional
  yLabel = "...",                              -- optional
}
```

---

## Mobile / cross-client

The iPhone app reads the same `.md` files. It will display `lua-live` blocks
as plain code (the source), without executing them. This is intentional —
script execution is desktop-only for now.

When another client modifies files, click the refresh button (⟳) in the
desktop header to pick up the changes immediately. Otherwise focus-change also
triggers an automatic re-index.

---

## Development

```bash
npm install
npm run tauri dev
```

Build a release binary:

```bash
npm run tauri build
```

Stack:
- Tauri 2 + Rust
- React 18 + TypeScript + Vite + Tailwind
- `mlua` (Lua 5.4, vendored)
- `reqwest` (rustls)
- `chart.js` + `react-chartjs-2`
- `rusqlite` for the search/tag index
