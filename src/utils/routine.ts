// Recurring checklists ("routines"): a note tagged `#routine` whose tasks are
// ticked off each session. "Finish session" writes a dated line under
// `## Log` and resets the checkboxes, keeping any edited numbers for next time.
//
// Log line format (newest first):
//   - 2026-10-15 — 3/4 — Squats 3×8 @ 80kg · Lunges 3×12 · Leg press — skipped: Calf raises

import type { ChartSpec } from "../components/ChartView";

const ROUTINE_TAG_RE = /(^|\s)#routine(?=\s|$)/m;
const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])\](.*)$/;
const LOG_HEADING_RE = /^##\s+Log\s*$/i;
const LOG_LINE_RE = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s+—\s+(\d+)\/(\d+)(?:\s+—\s+(?!skipped:)(.*?))?(?:\s+—\s+skipped:\s+(.*))?\s*$/;
const ITEM_SEP = " · ";

export interface RoutineTask {
  line: number;
  done: boolean;
  text: string;
}

export interface LogEntry {
  date: string;
  done: number;
  total: number;
  items: string[];
  skipped: string[];
}

export function isRoutineNote(content: string): boolean {
  return ROUTINE_TAG_RE.test(content.replace(/```[\s\S]*?```/g, ""));
}

function logHeadingIndex(lines: string[]): number {
  return lines.findIndex((l) => LOG_HEADING_RE.test(l));
}

/** Checklist items above the `## Log` heading. */
export function routineTasks(content: string): RoutineTask[] {
  const lines = content.split("\n");
  const logIdx = logHeadingIndex(lines);
  const end = logIdx === -1 ? lines.length : logIdx;
  const tasks: RoutineTask[] = [];
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(TASK_RE);
    if (!m) continue;
    const text = m[3].trim();
    if (text) tasks.push({ line: i, done: m[2] !== " ", text });
  }
  return tasks;
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Log the ticked tasks for `date` and reset every checkbox.
 * Returns null when nothing is ticked.
 */
export function finishSession(
  content: string,
  date: string,
): { content: string; entry: LogEntry } | null {
  const tasks = routineTasks(content);
  const done = tasks.filter((t) => t.done);
  if (done.length === 0) return null;

  const entry: LogEntry = {
    date,
    done: done.length,
    total: tasks.length,
    items: done.map((t) => t.text),
    skipped: tasks.filter((t) => !t.done).map((t) => t.text),
  };

  const lines = content.split("\n");
  for (const t of tasks) {
    lines[t.line] = lines[t.line].replace(TASK_RE, (_m, prefix: string, _mark, rest: string) => `${prefix} ]${rest}`);
  }

  const logLine = formatLogLine(entry);
  const logIdx = logHeadingIndex(lines);
  if (logIdx === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "## Log", logLine, "");
  } else {
    lines.splice(logIdx + 1, 0, logLine);
  }
  return { content: lines.join("\n"), entry };
}

export function formatLogLine(e: LogEntry): string {
  let line = `- ${e.date} — ${e.done}/${e.total} — ${e.items.join(ITEM_SEP)}`;
  if (e.skipped.length > 0) line += ` — skipped: ${e.skipped.join(ITEM_SEP)}`;
  return line;
}

/** Log entries, oldest first. */
export function parseLog(content: string): LogEntry[] {
  const lines = content.split("\n");
  const logIdx = logHeadingIndex(lines);
  if (logIdx === -1) return [];
  const out: LogEntry[] = [];
  for (let i = logIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const m = lines[i].match(LOG_LINE_RE);
    if (!m) continue;
    out.push({
      date: m[1],
      done: Number(m[2]),
      total: Number(m[3]),
      items: m[4] ? m[4].split(ITEM_SEP).map((s) => s.trim()).filter(Boolean) : [],
      skipped: m[5] ? m[5].split(ITEM_SEP).map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** "Squats 3×8 @ 80kg" → "Squats" */
export function exerciseName(item: string): string {
  return item
    .replace(/@.*$/, "")
    .replace(/\b\d+\s*[×xX*]\s*\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Squats 3×8 @ 82,5kg" → 82.5 */
export function exerciseWeight(item: string): number | null {
  const m = item.match(/@\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** Weight per exercise over time; null when no item has an `@ weight`. */
export function weightChart(log: LogEntry[]): ChartSpec | null {
  const byName = new Map<string, Map<string, number>>();
  for (const e of log) {
    for (const item of e.items) {
      const w = exerciseWeight(item);
      if (w === null) continue;
      const name = exerciseName(item);
      if (!byName.has(name)) byName.set(name, new Map());
      byName.get(name)!.set(e.date, w);
    }
  }
  if (byName.size === 0) return null;
  const dates = [...new Set(log.map((e) => e.date))];
  return {
    kind: "line",
    title: "Weight progress",
    labels: dates,
    series: [...byName].map(([name, byDate]) => ({
      name,
      data: dates.map((d) => byDate.get(d) ?? null),
    })),
  };
}

function weekStart(iso: string): Date {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}

/** Sessions per week for the last `weeks` weeks (Monday-based). */
export function sessionsChart(log: LogEntry[], weeks = 12): ChartSpec {
  const thisWeek = weekStart(todayIso());
  const starts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - i * 7);
    starts.push(d);
  }
  const counts = starts.map(() => 0);
  for (const e of log) {
    const t = weekStart(e.date).getTime();
    const idx = starts.findIndex((s) => s.getTime() === t);
    if (idx !== -1) counts[idx]++;
  }
  return {
    kind: "bar",
    title: "Sessions per week",
    labels: starts.map((d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
    series: [{ name: "Sessions", data: counts }],
  };
}
