// Task lines in the Obsidian Tasks emoji format, so notes stay compatible:
//
//   - [ ] Take out the trash 🔼 🔁 every week on Monday ➕ 2026-10-15 📅 2026-10-19
//
// Status: [ ] todo, [/] in progress, [x] done, [-] cancelled.

export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "lowest";
export type TaskStatus = " " | "/" | "x" | "-";

export interface Task {
  indent: string;
  bullet: string;
  status: TaskStatus;
  description: string;
  priority: Priority;
  recurrence: string;
  created: string;
  start: string;
  scheduled: string;
  due: string;
  done: string;
  cancelled: string;
}

export const PRIORITY_EMOJI: Record<Priority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  normal: "",
  low: "🔽",
  lowest: "⏬",
};

/** Higher sorts first. */
export const PRIORITY_RANK: Record<Priority, number> = {
  highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0,
};

const DATE_FIELDS = [
  ["created", "➕"],
  ["start", "🛫"],
  ["scheduled", "⏳"],
  ["due", "📅"],
  ["done", "✅"],
  ["cancelled", "❌"],
] as const;

type DateField = (typeof DATE_FIELDS)[number][0];

const TASK_LINE_RE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])\s+\[([ xX/-])\]\s?(.*)$/;
const SIGNIFIERS = "🔺⏫🔼🔽⏬🔁📅📆🗓⏳⌛🛫➕✅❌";
const DATE_RE = (emoji: string) =>
  new RegExp(`(?:${emoji})\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})`, "u");
const RECUR_RE = new RegExp(`🔁\\uFE0F?\\s*([^${SIGNIFIERS}]*)`, "u");

const DATE_EMOJI_ALIASES: Record<DateField, string> = {
  created: "➕",
  start: "🛫",
  scheduled: "⏳|⌛",
  due: "📅|📆|🗓",
  done: "✅",
  cancelled: "❌",
};

export function emptyTask(): Task {
  return {
    indent: "", bullet: "-", status: " ", description: "", priority: "normal",
    recurrence: "", created: "", start: "", scheduled: "", due: "", done: "", cancelled: "",
  };
}

export function isTaskLine(line: string): boolean {
  return TASK_LINE_RE.test(line);
}

export function parseTaskLine(line: string): Task | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  const task = emptyTask();
  task.indent = m[1];
  task.bullet = m[2];
  task.status = (m[3] === "X" ? "x" : m[3]) as TaskStatus;
  let rest = m[4];

  for (const [field] of DATE_FIELDS) {
    const re = DATE_RE(DATE_EMOJI_ALIASES[field]);
    const dm = rest.match(re);
    if (dm) {
      task[field] = dm[1];
      rest = rest.replace(new RegExp(re.source, "gu"), " ");
    }
  }
  const rm = rest.match(RECUR_RE);
  if (rm) {
    // Keep the longest valid rule; trailing words (e.g. #tags) stay in the description.
    const words = rm[1].trim().split(/\s+/).filter(Boolean);
    let k = words.length;
    while (k > 0 && !parseRecurrence(words.slice(0, k).join(" "))) k--;
    if (k === 0) k = words.length;
    task.recurrence = words.slice(0, k).join(" ");
    rest = rest.replace(RECUR_RE, ` ${words.slice(k).join(" ")} `);
  }
  for (const p of Object.keys(PRIORITY_EMOJI) as Priority[]) {
    const e = PRIORITY_EMOJI[p];
    if (e && rest.includes(e)) {
      task.priority = p;
      rest = rest.split(e).join(" ");
    }
  }
  task.description = rest.replace(/️/g, "").replace(/\s+/g, " ").trim();
  return task;
}

export function serializeTask(t: Task): string {
  const parts = [t.description.replace(/\s*\n\s*/g, " ").trim()];
  if (PRIORITY_EMOJI[t.priority]) parts.push(PRIORITY_EMOJI[t.priority]);
  if (t.recurrence.trim()) parts.push(`🔁 ${t.recurrence.trim()}`);
  for (const [field, emoji] of DATE_FIELDS) {
    if (t[field]) parts.push(`${emoji} ${t[field]}`);
  }
  return `${t.indent}${t.bullet} [${t.status}] ${parts.filter(Boolean).join(" ")}`;
}

// ---------------------------------------------------------------------------
// Dates (local, as YYYY-MM-DD strings)

const pad = (n: number) => String(n).padStart(2, "0");

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateOf(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return isoOf(dateOf(iso)) === iso;
}

export function addDays(iso: string, n: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/** Add months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, n: number, day?: number | "last"): string {
  const d = dateOf(iso);
  const total = d.getFullYear() * 12 + d.getMonth() + n;
  const y = Math.floor(total / 12);
  const m0 = total % 12;
  const max = daysInMonth(y, m0);
  const want = day === "last" ? max : (day ?? d.getDate());
  return isoOf(new Date(y, m0, Math.min(want, max)));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}

/** 0 = Monday … 6 = Sunday */
function dow(iso: string): number {
  return (dateOf(iso).getDay() + 6) % 7;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_NAMES = WEEKDAYS.map((w) => w[0].toUpperCase() + w.slice(1));

function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  if (w.length < 2) return -1;
  return WEEKDAYS.findIndex((d) => d.startsWith(w));
}

/**
 * Parse what the user typed in a date field: `2026-10-15`, `15/10/2026`,
 * `today`, `tm`, `yesterday`, `mon`, `next fri`, `+3d`, `2 weeks`, `next month`.
 * Returns "" for an empty field and null when it can't be understood.
 */
export function parseDateInput(text: string, today: string, onlyFuture = true): string | null {
  const s = text.trim().toLowerCase();
  if (!s) return "";
  if (isValidIso(s)) return s;

  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmy) {
    const iso = `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
    return isValidIso(iso) ? iso : null;
  }
  if (s === "today" || s === "tod" || s === "td") return today;
  if (s === "tomorrow" || s === "tom" || s === "tm") return addDays(today, 1);
  if (s === "yesterday" || s === "yd") return addDays(today, -1);
  if (s === "next week") return addDays(today, 7);
  if (s === "next month") return addMonths(today, 1);
  if (s === "next year") return addMonths(today, 12);

  const rel = s.match(/^(?:in\s+)?([+-]?\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0];
    if (unit === "d") return addDays(today, n);
    if (unit === "w") return addDays(today, n * 7);
    if (unit === "m") return addMonths(today, n);
    return addMonths(today, n * 12);
  }

  const wd = s.match(/^(next\s+|this\s+)?([a-z]+)$/);
  if (wd) {
    const idx = weekdayIndex(wd[2]);
    if (idx === -1) return null;
    let ahead = (idx - dow(today) + 7) % 7;
    if (wd[1]?.startsWith("next")) ahead = ahead === 0 ? 7 : ahead;
    else if (!onlyFuture && !wd[1]) ahead = idx - dow(today); // this week's day, may be past
    return addDays(today, ahead);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recurrence: "every day", "every 3 days", "every weekday", "every week on
// Monday, Thursday", "every 2 weeks", "every month on the 15th",
// "every month on the last", "every year", "every Monday", "... when done".

export interface Recurrence {
  unit: "day" | "weekday" | "week" | "month" | "year";
  interval: number;
  weekdays: number[];
  monthDay?: number | "last";
  whenDone: boolean;
}

export function parseRecurrence(text: string): Recurrence | null {
  let s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s.startsWith("every ")) return null;
  let whenDone = false;
  if (s.endsWith(" when done")) {
    whenDone = true;
    s = s.slice(0, -" when done".length);
  }
  s = s.slice("every ".length);

  const dayList = (list: string): number[] | null => {
    const days = list.split(/\s*(?:,|\band\b)\s*/).filter(Boolean).map(weekdayIndex);
    return days.length > 0 && days.every((d) => d >= 0) ? [...new Set(days)].sort() : null;
  };

  // "every Monday", "every mon and thu"
  const bare = dayList(s);
  if (bare) return { unit: "week", interval: 1, weekdays: bare, whenDone };
  if (s === "weekday") return { unit: "weekday", interval: 1, weekdays: [], whenDone };

  const m = s.match(/^(?:(\d+) )?(day|days|week|weeks|month|months|year|years)(?: on (?:the )?(.+))?$/);
  if (!m) return null;
  const interval = m[1] ? Number(m[1]) : 1;
  if (interval < 1) return null;
  const unit = m[2].replace(/s$/, "") as Recurrence["unit"];
  const on = m[3];
  if (!on) return { unit, interval, weekdays: [], whenDone };

  if (unit === "week") {
    const days = dayList(on);
    return days ? { unit, interval, weekdays: days, whenDone } : null;
  }
  if (unit === "month") {
    if (on === "last" || on === "last day") return { unit, interval, weekdays: [], monthDay: "last", whenDone };
    const dm = on.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    const day = dm ? Number(dm[1]) : 0;
    return day >= 1 && day <= 31 ? { unit, interval, weekdays: [], monthDay: day, whenDone } : null;
  }
  return null;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

/** Normalised text, e.g. "every week on Monday, Thursday". */
export function describeRecurrence(r: Recurrence): string {
  const every = (unit: string) => (r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`);
  let out: string;
  if (r.unit === "weekday") out = "every weekday";
  else if (r.unit === "week" && r.weekdays.length > 0)
    out = `${every("week")} on ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join(", ")}`;
  else if (r.unit === "month" && r.monthDay !== undefined)
    out = `${every("month")} on the ${r.monthDay === "last" ? "last" : ordinal(r.monthDay)}`;
  else out = every(r.unit);
  return r.whenDone ? `${out} when done` : out;
}

/** The first occurrence strictly after `from`. */
export function nextOccurrence(r: Recurrence, from: string): string {
  switch (r.unit) {
    case "day":
      return addDays(from, r.interval);
    case "weekday": {
      let d = addDays(from, 1);
      while (dow(d) > 4) d = addDays(d, 1);
      return d;
    }
    case "week": {
      if (r.weekdays.length === 0) return addDays(from, 7 * r.interval);
      const later = r.weekdays.find((wd) => wd > dow(from));
      if (later !== undefined) return addDays(from, later - dow(from));
      const monday = addDays(from, -dow(from));
      return addDays(monday, 7 * r.interval + r.weekdays[0]);
    }
    case "month": {
      if (r.monthDay !== undefined) {
        const sameMonth = addMonths(from, 0, r.monthDay);
        if (sameMonth > from) return sameMonth;
        return addMonths(from, r.interval, r.monthDay);
      }
      return addMonths(from, r.interval);
    }
    case "year":
      return addMonths(from, 12 * r.interval);
  }
}

/**
 * Tick a task done (adding ✅ today). A recurring task also gets its next
 * occurrence, returned first so it lands above the completed one.
 * Ticking a done task again re-opens it.
 */
export function toggleTaskDone(line: string, today: string): string[] {
  const t = parseTaskLine(line);
  if (!t) return [line];
  if (t.status === "x" || t.status === "-") {
    return [serializeTask({ ...t, status: " ", done: "", cancelled: "" })];
  }
  const done = serializeTask({ ...t, status: "x", done: today });
  const next = nextRecurringTask(t, today);
  return next ? [serializeTask(next), done] : [done];
}

export function nextRecurringTask(t: Task, today: string): Task | null {
  const rule = t.recurrence ? parseRecurrence(t.recurrence) : null;
  if (!rule) return null;
  const base = t.due || t.scheduled || t.start;
  const next: Task = { ...t, status: " ", done: "", cancelled: "" };
  if (t.created) next.created = today;
  if (!base) {
    next.due = nextOccurrence(rule, today);
    return next;
  }
  const newBase = nextOccurrence(rule, rule.whenDone ? today : base);
  const shift = daysBetween(base, newBase);
  for (const f of ["start", "scheduled", "due"] as const) {
    if (t[f]) next[f] = addDays(t[f], shift);
  }
  return next;
}

/**
 * Task for the dialog from line `idx`: the parsed task, or a new one made from
 * the line's text (an empty line or plain list item becomes a fresh task).
 */
export function taskForLine(line: string, today: string): { task: Task; isNew: boolean } {
  const existing = parseTaskLine(line);
  if (existing) return { task: existing, isNew: false };
  const m = line.match(/^(\s*(?:>\s*)*)(?:([-*+]|\d+[.)])\s+)?(.*)$/)!;
  return {
    task: { ...emptyTask(), indent: m[1], bullet: m[2] ?? "-", description: m[3].trim(), created: today },
    isNew: true,
  };
}

/**
 * Replace line `idx` with the edited task. Marking a recurring task done
 * also inserts its next occurrence above it.
 */
export function applyTaskEdit(content: string, idx: number, before: Task | null, after: Task, today: string): string {
  const lines = content.split("\n");
  const out = [serializeTask(after)];
  const wasOpen = !before || before.status === " " || before.status === "/";
  if (wasOpen && after.status === "x") {
    const next = nextRecurringTask(after, after.done || today);
    if (next) out.unshift(serializeTask(next));
  }
  lines.splice(idx, 1, ...out);
  return lines.join("\n");
}
