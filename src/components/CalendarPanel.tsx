import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onSelectDay: (date: string) => void;
  /** Bump to force a re-fetch of which days have notes (e.g. after creating one). */
  refreshKey?: number;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export default function CalendarPanel({ onSelectDay, refreshKey }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatYMD(today), [today]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0..11

  const [datesWithNotes, setDatesWithNotes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>("list_daily_notes")
      .then((arr) => {
        if (!cancelled) setDatesWithNotes(new Set(arr));
      })
      .catch(() => {
        if (!cancelled) setDatesWithNotes(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, year, month]);

  // Mon-based weekday (0=Mon, 6=Sun) for the first of the month
  const firstWeekday = useMemo(() => {
    const f = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
    return (f + 6) % 7;
  }, [year, month]);

  const daysInMonth = useMemo(
    () => new Date(year, month + 1, 0).getDate(),
    [year, month],
  );

  const cells = useMemo(() => {
    const out: Array<{ day: number; date: string; hasNote: boolean; isToday: boolean } | null> = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      out.push({
        day: d,
        date: dateStr,
        hasNote: datesWithNotes.has(dateStr),
        isToday: dateStr === todayStr,
      });
    }
    // Pad to multiple of 7 for a clean grid
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [firstWeekday, daysInMonth, year, month, datesWithNotes, todayStr]);

  const goPrev = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1);
  };
  const goNext = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    onSelectDay(todayStr);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Calendar</span>
        <button
          onClick={goToday}
          className="px-2 py-0.5 text-[11px] rounded-md text-accent hover:bg-accent/10 transition-colors"
          title="Open today's daily note"
        >
          Today
        </button>
      </div>

      <div className="px-3 py-2 flex items-center justify-between">
        <button
          onClick={goPrev}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors"
          title="Previous month"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 4l-4 4 4 4" />
          </svg>
        </button>
        <span className="text-sm font-medium">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={goNext}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors"
          title="Next month"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>

      <div className="px-3">
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-[10px] text-center text-gray-400 font-medium py-0.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell, i) => {
            if (cell === null) {
              return <div key={i} className="aspect-square" />;
            }
            const base = "aspect-square rounded-md text-[11px] flex flex-col items-center justify-center transition-colors relative";
            const stateClass = cell.isToday
              ? "bg-accent/20 text-accent font-semibold"
              : cell.hasNote
                ? "text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700/50"
                : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/30";
            return (
              <button
                key={i}
                onClick={() => onSelectDay(cell.date)}
                className={`${base} ${stateClass}`}
                title={cell.date}
              >
                <span>{cell.day}</span>
                {cell.hasNote && !cell.isToday && (
                  <span className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" />
                )}
                {cell.hasNote && cell.isToday && (
                  <span className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 px-3 pb-3 text-[10px] text-gray-400">
        Click a day to open or create its daily note. Notes are saved under{" "}
        <code className="text-gray-500">Daily/YYYY-MM-DD.md</code>.
      </div>
    </div>
  );
}
