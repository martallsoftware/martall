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
