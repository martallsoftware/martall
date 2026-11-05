// Chart data for the Tasks panel, computed from every indexed task.

import type { ChartSpec } from "../components/ChartView";
import { addDays, parseTaskLine, PRIORITY_EMOJI, type Priority, type Task } from "./task";
import { todayIso } from "./routine";

export interface IndexedTask {
  due_date: string;
  done: boolean;
  text: string;
}

const RED = "#ef4444";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";

/** Index text has 📅 stripped; parse the rest and put the due date back. */
function toTask(t: IndexedTask): Task {
  const task = parseTaskLine(`- [${t.done ? "x" : " "}] ${t.text}`)!;
  task.due = t.due_date;
  if (t.done && task.cancelled) task.status = "-";
  return task;
}

function mondayOf(iso: string): string {
  const dow = (new Date(iso + "T00:00:00").getDay() + 6) % 7;
  return addDays(iso, -dow);
}

function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Mondays of the last `weeks` weeks, oldest first. */
function lastMondays(weeks: number): string[] {
  const thisWeek = mondayOf(todayIso());
  return Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
}

function countByWeek(dates: string[], mondays: string[]): number[] {
  const counts = mondays.map(() => 0);
  for (const d of dates) {
    const idx = mondays.indexOf(mondayOf(d));
    if (idx !== -1) counts[idx]++;
  }
  return counts;
}

export interface TaskCharts {
  completedPerWeek: ChartSpec;
  comingUp: ChartSpec;
  byPriority: ChartSpec;
  createdVsDone: ChartSpec;
  openCount: number;
  doneThisWeek: number;
}

export function taskCharts(indexed: IndexedTask[], weeks = 12, days = 14): TaskCharts {
  const tasks = indexed.map(toTask);
  const today = todayIso();
  const open = tasks.filter((t) => t.status === " " || t.status === "/");
  const doneDates = tasks.filter((t) => t.status === "x" && t.done).map((t) => t.done);
  const mondays = lastMondays(weeks);
  const weekLabels = mondays.map(shortDate);
  const completed = countByWeek(doneDates, mondays);

  // Coming up: overdue + next `days` days, stacked so the red bar sits alone.
  const dayList = Array.from({ length: days }, (_, i) => addDays(today, i));
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const dueCounts = dayList.map((d) => open.filter((t) => t.due === d).length);
  const comingUp: ChartSpec = {
    kind: "bar",
    integer: true,
    title: "Coming up",
    stacked: true,
    labels: ["Overdue", ...dayList.map((d, i) => (i === 0 ? "Today" : shortDate(d)))],
    series: [
      { name: "Overdue", data: [overdue, ...dayList.map(() => 0)], color: RED },
      { name: "Due", data: [0, ...dueCounts], color: GREEN },
    ],
  };

  const order: Priority[] = ["highest", "high", "medium", "normal", "low", "lowest"];
  const byPriority: ChartSpec = {
    kind: "bar",
    integer: true,
    title: "Open tasks by priority",
    labels: order.map((p) => `${PRIORITY_EMOJI[p] || "·"} ${p[0].toUpperCase()}${p.slice(1)}`),
    series: [{ name: "Open", data: order.map((p) => open.filter((t) => t.priority === p).length), color: BLUE }],
  };

  const createdVsDone: ChartSpec = {
    kind: "line",
    integer: true,
    title: "Created vs done per week",
    labels: weekLabels,
    series: [
      { name: "Created", data: countByWeek(tasks.filter((t) => t.created).map((t) => t.created), mondays), color: BLUE },
      { name: "Done", data: completed, color: GREEN },
    ],
  };

  return {
    completedPerWeek: {
      kind: "bar",
      integer: true,
      title: "Completed per week",
      labels: weekLabels,
      series: [{ name: "Completed", data: completed, color: GREEN }],
    },
    comingUp,
    byPriority,
    createdVsDone,
    openCount: open.length,
    doneThisWeek: completed[completed.length - 1],
  };
}
