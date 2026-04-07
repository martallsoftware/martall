// Parse a note's frontmatter + dashboard widget blocks.

export interface DashboardMeta {
  dashboard: boolean;
  cols: number;
  gap: number;
  bg?: string;
  pattern?: "dots" | "grid" | "none";
  theme?: "light" | "dark";
  title?: string;
}

export interface Widget {
  type: "lua-live" | "text" | "image";
  title?: string;
  span: number;
  bg?: string;
  accent?: string;
  showHeader?: boolean;
  body: string;
  // Stable id for React keys + cache
  id: string;
}

export interface ParsedDashboard {
  meta: DashboardMeta;
  widgets: Widget[];
  bodyAfterFrontmatter: string;
}

const DEFAULT_META: DashboardMeta = {
  dashboard: false,
  cols: 3,
  gap: 12,
  pattern: "none",
  theme: "dark",
};

// Tiny YAML-ish parser: only handles `key: value` pairs (no nesting, no lists).
function parseFrontmatter(content: string): {
  meta: Record<string, string>;
  rest: string;
} {
  // Tolerate BOM + leading whitespace/newlines before the opening ---
  const stripped = content.replace(/^\uFEFF/, "").replace(/^\s*\n/, "");
  if (!stripped.startsWith("---")) {
    return { meta: {}, rest: content };
  }
  // Find the closing --- on its own line
  const closeRe = /\n---\s*(\r?\n|$)/;
  const m = closeRe.exec(stripped);
  if (!m) return { meta: {}, rest: content };
  const end = m.index;
  const block = stripped.substring(3, end).trim();
  const after = stripped.substring(end + m[0].length);

  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    // Strip surrounding quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    meta[m[1]] = val;
  }
  return { meta, rest: after };
}

// Parse `key="value with spaces" key2=42 key3=foo` into a record
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)=("([^"]*)"|'([^']*)'|([^\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return out;
}

// Stable hash for widget ids (so React keys + caches survive small edits)
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

export function parseDashboard(content: string): ParsedDashboard {
  const { meta: rawMeta, rest } = parseFrontmatter(content);

  const meta: DashboardMeta = {
    ...DEFAULT_META,
    dashboard: rawMeta.dashboard === "true",
    cols: rawMeta.cols ? parseInt(rawMeta.cols, 10) || 3 : 3,
    gap: rawMeta.gap ? parseInt(rawMeta.gap, 10) || 12 : 12,
    bg: rawMeta.bg,
    pattern: (rawMeta.pattern as DashboardMeta["pattern"]) || "none",
    theme: (rawMeta.theme as DashboardMeta["theme"]) || "dark",
    title: rawMeta.title,
  };

  const widgets: Widget[] = [];
  // Match fenced code blocks whose info string starts with `widget`
  const fenceRe = /```widget([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = fenceRe.exec(rest)) !== null) {
    let attrSrc = m[1] || "";
    let body = m[2];

    // The user may have wrapped fence args onto the next line(s).
    // Pull any leading lines that look like `key="value"` pairs (and that do
    // NOT contain a `{type}` marker yet) into the attribute source.
    while (true) {
      const nl = body.indexOf("\n");
      const firstLine = (nl === -1 ? body : body.substring(0, nl)).trim();
      if (!firstLine) break;
      // Stop as soon as we see the type marker — that's where the body begins.
      if (/\{(lua-live|text|image)\}/.test(firstLine)) break;
      // Only fold if the line is purely attr-like (key=val pairs).
      if (!/^([a-zA-Z_][\w-]*=("[^"]*"|'[^']*'|\S+)\s*)+$/.test(firstLine)) {
        break;
      }
      attrSrc += " " + firstLine;
      body = nl === -1 ? "" : body.substring(nl + 1);
    }

    const attrs = parseAttrs(attrSrc);

    // Detect widget type marker `{lua-live}` / `{text}` / `{image}` —
    // accept it on the first non-blank line OR anywhere in the first 200 chars.
    let type: Widget["type"] = "text";
    const markerRe = /\{(lua-live|text|image)\}\s*\r?\n?/;
    const head = body.substring(0, 200);
    const markerMatch = head.match(markerRe);
    if (markerMatch && markerMatch.index !== undefined) {
      type = markerMatch[1] as Widget["type"];
      body =
        body.substring(0, markerMatch.index) +
        body.substring(markerMatch.index + markerMatch[0].length);
      // If the marker had attr-like text before it on the same line, parse it
      const before = body.substring(0, markerMatch.index).trim();
      if (
        before &&
        /^([a-zA-Z_][\w-]*=("[^"]*"|'[^']*'|\S+)\s*)+$/.test(before)
      ) {
        Object.assign(attrs, parseAttrs(before));
        body = body.substring(markerMatch.index);
      }
      body = body.replace(/^\s*\n/, "");
    }

    // Default: header off in dashboards. Opt back in with `header="true"`.
    const showHeader = attrs.header === "true";

    widgets.push({
      type,
      title: attrs.title,
      span: Math.max(1, parseInt(attrs.span || "1", 10) || 1),
      bg: attrs.bg,
      accent: attrs.accent,
      showHeader,
      body: body.replace(/\s+$/, ""),
      id: hashStr(`${idx}::${m[1]}::${body}`),
    });
    idx++;
  }

  return { meta, widgets, bodyAfterFrontmatter: rest };
}
