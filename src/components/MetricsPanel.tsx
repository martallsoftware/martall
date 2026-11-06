import { useEffect, useMemo, useState } from "react";
import ChartView from "./ChartView";
import { todayIso } from "../utils/routine";
import {
  metricCharts,
  parseMetricsLog,
  trackedMetrics,
  upsertMetricsEntry,
} from "../utils/metrics";

interface BarProps {
  content: string;
  onContentChange?: (content: string) => void;
}

/** Input row for today's values, shown above a `#metrics` note. */
export function MetricsBar({ content, onContentChange }: BarProps) {
  const log = useMemo(() => parseMetricsLog(content), [content]);
  const metrics = useMemo(() => trackedMetrics(content, log), [content, log]);
  const today = todayIso();
  const todayEntry = log.find((e) => e.date === today);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  // Prefill with today's saved values (e.g. after reopening the note).
  const todayKey = todayEntry ? JSON.stringify(todayEntry.values) : "";
  useEffect(() => {
    const v: Record<string, string> = {};
    if (todayEntry) for (const [k, n] of Object.entries(todayEntry.values)) v[k] = String(n);
    setValues(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);

  if (metrics.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-gray-300/50 dark:border-gray-700/60 bg-gray-100/60 dark:bg-white/5 px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
        Add a line like <code>Track: weight (kg) · sleep (h)</code> to choose what to log.
      </div>
    );
  }

  const save = () => {
    if (!onContentChange) return;
    const next = upsertMetricsEntry(content, today, metrics, values);
    if (next === null) {
      setStatus("Enter at least one number");
      return;
    }
    onContentChange(next);
    setStatus(todayEntry ? "Updated today" : "Saved");
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-300/50 dark:border-gray-700/60 bg-gray-100/60 dark:bg-white/5 px-3 py-2 text-sm">
      <span className="font-medium self-center">Today</span>
      {metrics.map((m) => (
        <label key={m.name} className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          {m.unit ? `${m.name} (${m.unit})` : m.name}
          <input
            type="text"
            inputMode="decimal"
            value={values[m.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [m.name]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="mt-0.5 w-20 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#16162a] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </label>
      ))}
      <button
        onClick={save}
        disabled={!onContentChange}
        className="px-3 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
      >
        {todayEntry ? "Update" : "Save"}
      </button>
      {status && <span className="self-center text-xs text-gray-500 dark:text-gray-400">{status}</span>}
    </div>
  );
}

/** One chart per tracked metric, shown below a `#metrics` note. */
export function MetricsHistory({ content, dark }: { content: string; dark: boolean }) {
  const log = useMemo(() => parseMetricsLog(content), [content]);
  const charts = useMemo(() => metricCharts(log, trackedMetrics(content, log)), [content, log]);
  if (charts.length === 0) return null;

  return (
    <div className="mt-8 pt-4 border-t border-gray-300/40 dark:border-gray-700/40">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        History · {log.length} entr{log.length === 1 ? "y" : "ies"}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {charts.map((c) => (
          <ChartView key={c.title} spec={c} dark={dark} />
        ))}
      </div>
    </div>
  );
}
