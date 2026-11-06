// Metrics logs: a note tagged `#metrics` with dated number lines under `## Log`.
//
//   Track: weight (kg) · sleep (h) · steps
//
//   ## Log
//   - 2026-10-15 — weight 82.4 kg · sleep 7.5 h · steps 9500

import type { ChartSpec } from "../components/ChartView";
import { logHeadingIndex } from "./routine";

const METRICS_TAG_RE = /(^|\s)#metrics(?=\s|$)/m;
const TRACK_RE = /^\s*Track:\s*(.+)$/im;
const LOG_LINE_RE = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/;
const VALUE_RE = /^(.+?)\s+(-?\d+(?:[.,]\d+)?)\s*([^\d\s].*)?$/;
const SEP = " · ";

export interface Metric {
  name: string;
  unit: string;
}

export interface MetricsEntry {
  date: string;
  line: number;
  values: Record<string, number>;
}

export function isMetricsNote(content: string): boolean {
  return METRICS_TAG_RE.test(content.replace(/```[\s\S]*?```/g, ""));
}

/** Metrics from the `Track:` line, then any extra names found in the log. */
export function trackedMetrics(content: string, log: MetricsEntry[]): Metric[] {
  const out: Metric[] = [];
  const m = content.match(TRACK_RE);
  if (m) {
    for (const part of m[1].split(SEP.trim())) {
      const pm = part.trim().match(/^(.+?)(?:\s*\(([^)]*)\))?$/);
      if (pm && pm[1].trim()) out.push({ name: pm[1].trim(), unit: (pm[2] ?? "").trim() });
    }
  }
  for (const e of log) {
    for (const name of Object.keys(e.values)) {
      if (!out.some((x) => x.name === name)) out.push({ name, unit: "" });
    }
  }
  return out;
}

/** Log entries, oldest first. */
export function parseMetricsLog(content: string): MetricsEntry[] {
  const lines = content.split("\n");
  const logIdx = logHeadingIndex(lines);
  if (logIdx === -1) return [];
  const out: MetricsEntry[] = [];
  for (let i = logIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const m = lines[i].match(LOG_LINE_RE);
    if (!m) continue;
    const values: Record<string, number> = {};
    for (const part of m[2].split(SEP)) {
      const vm = part.trim().match(VALUE_RE);
      if (vm) values[vm[1].trim()] = Number(vm[2].replace(",", "."));
    }
    out.push({ date: m[1], line: i, values });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Write the entry for `date` (replacing an existing line for that date).
 * Empty values are left out; returns null when every value is empty.
 */
export function upsertMetricsEntry(
  content: string,
  date: string,
  metrics: Metric[],
  values: Record<string, string>,
): string | null {
  const parts = metrics
    .map((m) => {
      const v = (values[m.name] ?? "").trim().replace(",", ".");
      if (v === "" || Number.isNaN(Number(v))) return null;
      return m.unit ? `${m.name} ${v} ${m.unit}` : `${m.name} ${v}`;
    })
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const line = `- ${date} — ${parts.join(SEP)}`;

  const lines = content.split("\n");
  const existing = parseMetricsLog(content).find((e) => e.date === date);
  if (existing) {
    lines[existing.line] = line;
    return lines.join("\n");
  }
  const logIdx = logHeadingIndex(lines);
  if (logIdx === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "## Log", line, "");
  } else {
    lines.splice(logIdx + 1, 0, line);
  }
  return lines.join("\n");
}

/** One chart per metric (they have different scales). */
export function metricCharts(log: MetricsEntry[], metrics: Metric[]): ChartSpec[] {
  return metrics
    .map((m) => {
      const points = log.filter((e) => m.name in e.values);
      return {
        kind: "line" as const,
        title: m.unit ? `${m.name} (${m.unit})` : m.name,
        labels: points.map((e) => e.date),
        series: [{ name: m.name, data: points.map((e) => e.values[m.name]) }],
      };
    })
    .filter((c) => c.labels.length > 0);
}
