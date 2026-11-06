import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeRecurrence,
  parseDateInput,
  parseRecurrence,
  PRIORITY_EMOJI,
  type Priority,
  type Task,
  type TaskStatus,
} from "../utils/task";
import { todayIso } from "../utils/routine";

interface Props {
  initial: Task;
  isNew: boolean;
  onApply: (task: Task) => void;
  onCancel: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "lowest", label: "Lowest" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "highest", label: "Highest" },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: " ", label: "Todo [ ]" },
  { value: "/", label: "In progress [/]" },
  { value: "x", label: "Done [x]" },
  { value: "-", label: "Cancelled [-]" },
];

type DateKey = "due" | "scheduled" | "start" | "created" | "done" | "cancelled";

const DATE_ROWS: { key: DateKey; label: string; emoji: string }[] = [
  { key: "due", label: "Due", emoji: "📅" },
  { key: "scheduled", label: "Scheduled", emoji: "⏳" },
  { key: "start", label: "Start", emoji: "🛫" },
];

const STATUS_DATE_ROWS: { key: DateKey; label: string; emoji: string }[] = [
  { key: "created", label: "Created", emoji: "➕" },
  { key: "done", label: "Done", emoji: "✅" },
  { key: "cancelled", label: "Cancelled", emoji: "❌" },
];

const inputCls =
  "w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50";

export default function TaskDialog({ initial, isNew, onApply, onCancel }: Props) {
  const today = todayIso();
  const [description, setDescription] = useState(initial.description);
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [recurrence, setRecurrence] = useState(initial.recurrence);
  const [status, setStatus] = useState<TaskStatus>(initial.status);
  const [onlyFuture, setOnlyFuture] = useState(true);
  const [dates, setDates] = useState<Record<DateKey, string>>({
    due: initial.due,
    scheduled: initial.scheduled,
    start: initial.start,
    created: initial.created,
    done: initial.done,
    cancelled: initial.cancelled,
  });
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    descRef.current?.focus();
    descRef.current?.select();
  }, []);

  const parsed = useMemo(() => {
    const out = {} as Record<DateKey, string | null>;
    for (const k of Object.keys(dates) as DateKey[]) out[k] = parseDateInput(dates[k], today, onlyFuture);
    return out;
  }, [dates, today, onlyFuture]);

  const rule = useMemo(() => (recurrence.trim() ? parseRecurrence(recurrence) : null), [recurrence]);
  const recurrenceInvalid = recurrence.trim() !== "" && rule === null;
  const anyDateInvalid = Object.values(parsed).some((v) => v === null);
  const canApply = description.trim() !== "" && !recurrenceInvalid && !anyDateInvalid;

  const setDate = (k: DateKey, v: string) => setDates((d) => ({ ...d, [k]: v }));

  const changeStatus = (s: TaskStatus) => {
    setStatus(s);
    setDates((d) => ({
      ...d,
      done: s === "x" ? d.done || today : "",
      cancelled: s === "-" ? d.cancelled || today : "",
    }));
  };

  const apply = () => {
    if (!canApply) return;
    onApply({
      ...initial,
      description: description.replace(/\s*\n\s*/g, " ").trim(),
      priority,
      recurrence: rule ? describeRecurrence(rule) : "",
      status,
      due: parsed.due ?? "",
      scheduled: parsed.scheduled ?? "",
      start: parsed.start ?? "",
      created: parsed.created ?? "",
      done: parsed.done ?? "",
      cancelled: parsed.cancelled ?? "",
    });
  };

  const dateRow = ({ key, label, emoji }: { key: DateKey; label: string; emoji: string }) => {
    const value = parsed[key];
    return (
      <div key={key} className="grid grid-cols-[88px_1fr_auto] items-center gap-2">
        <label className="text-sm text-gray-600 dark:text-gray-300">{label}</label>
        <input
          value={dates[key]}
          onChange={(e) => setDate(key, e.target.value)}
          placeholder="Try 'mon' or 'tm'"
          className={inputCls + (value === null ? " ring-2 ring-red-500/60" : "")}
        />
        <div className="flex items-center gap-1.5">
          <span className="w-5 text-center" title={label}>{emoji}</span>
          <input
            type="date"
            value={value ?? ""}
            onChange={(e) => setDate(key, e.target.value)}
            title={value ? value : `Pick ${label.toLowerCase()} date`}
            className={
              "px-1.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] text-gray-700 dark:text-gray-300 [color-scheme:light] dark:[color-scheme:dark]" +
              (value ? "" : " date-empty")
            }
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) apply();
      }}
    >
      <div className="w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{isNew ? "Create task" : "Edit task"}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Cancel">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Description</label>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  apply();
                }
              }}
              rows={2}
              className={inputCls + " resize-y"}
            />
          </div>

          <div className="grid grid-cols-[88px_1fr] gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-300">Priority</span>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1">
              {PRIORITIES.map((p) => (
                <label key={p.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="priority"
                    checked={priority === p.value}
                    onChange={() => setPriority(p.value)}
                    className="accent-accent"
                  />
                  <span className={priority === p.value ? "font-semibold" : ""}>{p.label}</span>
                  <span>{PRIORITY_EMOJI[p.value]}</span>
                </label>
              ))}
            </div>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          <div className="space-y-2">
            <div className="grid grid-cols-[88px_1fr_auto] items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-300">Recurs</label>
              <input
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                placeholder="e.g. every week on Monday"
                className={inputCls + (recurrenceInvalid ? " ring-2 ring-red-500/60" : "")}
              />
              <span className="w-5 text-center">🔁</span>
            </div>
            {recurrence.trim() && (
              <div className={`ml-[96px] text-xs font-mono ${recurrenceInvalid ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}>
                {rule ? describeRecurrence(rule) : "Not understood — try 'every 2 weeks', 'every month on the 15th', 'every weekday'"}
              </div>
            )}
            {DATE_ROWS.map(dateRow)}
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={onlyFuture} onChange={(e) => setOnlyFuture(e.target.checked)} />
              Only future dates (for weekday names)
            </label>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          <div className="space-y-2">
            <div className="grid grid-cols-[88px_1fr] items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-300">Status</label>
              <select value={status} onChange={(e) => changeStatus(e.target.value as TaskStatus)} className={inputCls}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {STATUS_DATE_ROWS.map(dateRow)}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={apply}
            disabled={!canApply}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Apply
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
