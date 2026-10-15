import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ChartView from "./ChartView";
import {
  finishSession,
  parseLog,
  routineTasks,
  sessionsChart,
  todayIso,
  weightChart,
} from "../utils/routine";

function noteTitle(path: string | null): string {
  if (!path) return "Routine";
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.md$/i, "");
}

/** Add a line linking back to the routine in the daily note for `date`. */
async function appendToDailyNote(date: string, line: string) {
  const path = await invoke<string>("open_or_create_daily_note", { date });
  const note = await invoke<{ content: string }>("read_note", { path });
  const body = note.content.replace(/\s*$/, "");
  await invoke("save_note", { path, content: `${body}\n${line}\n` });
}

interface BarProps {
  content: string;
  notePath: string | null;
  onContentChange?: (content: string) => void;
}

/** Progress + "Finish session" button shown above a `#routine` note. */
export function RoutineBar({ content, notePath, onContentChange }: BarProps) {
  const tasks = useMemo(() => routineTasks(content), [content]);
  const doneCount = tasks.filter((t) => t.done).length;
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const finish = async () => {
    if (!onContentChange) return;
    const date = todayIso();
    const result = finishSession(content, date);
    if (!result) {
      setStatus("Tick at least one item first");
      return;
    }
    onContentChange(result.content);
    const { done, total } = result.entry;
    try {
      await appendToDailyNote(date, `- [[${noteTitle(notePath)}]] — ${done}/${total} ✅`);
      setStatus(`Logged ${done}/${total} for ${date}`);
    } catch (err) {
      console.error("Failed to update daily note:", err);
      setStatus(`Logged ${done}/${total} (daily note not updated)`);
    }
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-300/50 dark:border-gray-700/60 bg-gray-100/60 dark:bg-white/5 px-3 py-2 text-sm">
      <span className="font-medium">Routine</span>
      <span className="text-gray-500 dark:text-gray-400">
        {doneCount}/{tasks.length} done
      </span>
      <div className="h-1.5 flex-1 rounded-full bg-gray-300/50 dark:bg-gray-700/60 overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: tasks.length ? `${(doneCount / tasks.length) * 100}%` : 0 }}
        />
      </div>
      {status && <span className="text-xs text-gray-500 dark:text-gray-400">{status}</span>}
      <button
        onClick={finish}
        disabled={!onContentChange || doneCount === 0}
        className="px-3 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Log today's ticked items under ## Log and reset the checkboxes"
      >
        Finish session
      </button>
    </div>
  );
}

/** Charts built from the `## Log` section, shown below a `#routine` note. */
export function RoutineHistory({ content, dark }: { content: string; dark: boolean }) {
  const log = useMemo(() => parseLog(content), [content]);
  const sessions = useMemo(() => sessionsChart(log), [log]);
  const weights = useMemo(() => weightChart(log), [log]);
  if (log.length === 0) return null;

  return (
    <div className="mt-8 pt-4 border-t border-gray-300/40 dark:border-gray-700/40">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        History · {log.length} session{log.length === 1 ? "" : "s"} · last {log[log.length - 1].date}
      </div>
      <div className="grid gap-6">
        <ChartView spec={sessions} dark={dark} />
        {weights && <ChartView spec={weights} dark={dark} />}
      </div>
    </div>
  );
}
