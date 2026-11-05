import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ChartView from "./ChartView";
import { taskCharts, type IndexedTask } from "../utils/taskStats";

/** Task charts for the Tasks panel (every task, not only dated ones). */
export default function TaskStats({ refreshKey }: { refreshKey?: number }) {
  const [tasks, setTasks] = useState<IndexedTask[] | null>(null);
  const dark = document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    invoke<IndexedTask[]>("get_all_tasks")
      .then((r) => { if (!cancelled) setTasks(r); })
      .catch(() => { if (!cancelled) setTasks([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const charts = useMemo(() => (tasks ? taskCharts(tasks) : null), [tasks]);
  if (!charts) return null;

  return (
    <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700/50 space-y-4">
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {charts.openCount} open · {charts.doneThisWeek} done this week
      </div>
      <ChartView spec={charts.completedPerWeek} dark={dark} height={150} />
      <ChartView spec={charts.comingUp} dark={dark} height={150} />
      <ChartView spec={charts.byPriority} dark={dark} height={150} />
      <ChartView spec={charts.createdVsDone} dark={dark} height={150} />
    </div>
  );
}
