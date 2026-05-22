import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TaskItem {
  note_path: string;
  note_title: string;
  line_index: number;
  due_date: string;
  done: boolean;
  text: string;
}

interface Props {
  onSelectNote: (path: string) => void;
  refreshKey?: number;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayOffset(date: string): number {
  const due = new Date(date + "T00:00:00").getTime();
  const today = new Date(todayStr() + "T00:00:00").getTime();
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

type Bucket = "Overdue" | "Today" | "Tomorrow" | "This week" | "Later" | "Done";

function bucketFor(task: TaskItem): Bucket {
  if (task.done) return "Done";
  const off = dayOffset(task.due_date);
  if (off < 0) return "Overdue";
  if (off === 0) return "Today";
  if (off === 1) return "Tomorrow";
  if (off <= 7) return "This week";
  return "Later";
}

const BUCKET_ORDER: Bucket[] = ["Overdue", "Today", "Tomorrow", "This week", "Later", "Done"];

const BUCKET_COLOR: Record<Bucket, string> = {
  Overdue: "text-red-500",
  Today: "text-amber-600 dark:text-amber-400",
  Tomorrow: "text-accent",
  "This week": "text-accent",
  Later: "text-gray-500 dark:text-gray-400",
  Done: "text-gray-400",
};

export default function TasksPanel({ onSelectNote, refreshKey }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<TaskItem[]>("get_due_tasks", { includeDone: showDone })
      .then((r) => { if (!cancelled) setTasks(r); })
      .catch(() => { if (!cancelled) setTasks([]); });
    return () => { cancelled = true; };
  }, [refreshKey, showDone]);

  const grouped = useMemo(() => {
    const map: Record<Bucket, TaskItem[]> = {
      Overdue: [], Today: [], Tomorrow: [], "This week": [], Later: [], Done: [],
    };
    for (const t of tasks) {
      map[bucketFor(t)].push(t);
    }
    return map;
  }, [tasks]);

  const total = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Tasks {total > 0 && <span className="text-gray-500 normal-case font-normal ml-1">({total} open)</span>}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="cursor-pointer"
          />
          Done
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400">
            No tasks with due dates yet.
            <div className="mt-2 text-[10px]">
              Add <code className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">📅 YYYY-MM-DD</code> after a <code>- [ ]</code> item.
            </div>
          </div>
        ) : (
          BUCKET_ORDER.map((bucket) => {
            const items = grouped[bucket];
            if (items.length === 0) return null;
            return (
              <div key={bucket} className="py-1">
                <div className={`px-3 py-1 text-[10px] uppercase font-semibold tracking-wider ${BUCKET_COLOR[bucket]}`}>
                  {bucket} <span className="text-gray-400 font-normal">({items.length})</span>
                </div>
                {items.map((t) => (
                  <button
                    key={`${t.note_path}#${t.line_index}`}
                    onClick={() => onSelectNote(t.note_path)}
                    className="block w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                    title={t.note_title}
                  >
                    <div className={`text-sm truncate ${t.done ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>
                      {t.text || "(no description)"}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate flex items-center gap-1.5">
                      <span>{t.due_date}</span>
                      <span className="text-gray-500">·</span>
                      <span className="truncate">{t.note_title}</span>
                    </div>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
