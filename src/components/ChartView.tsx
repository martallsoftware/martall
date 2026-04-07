import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Title,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Title,
  Filler,
);

export interface ChartSpec {
  kind: "line" | "bar" | "area";
  title?: string;
  labels: (string | number)[];
  series: { name: string; data: number[]; color?: string }[];
  yLabel?: string;
  xLabel?: string;
}

const PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#eab308",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

interface Props {
  spec: ChartSpec;
  dark?: boolean;
}

export default function ChartView({ spec, dark = true }: Props) {
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const text = dark ? "#cbd5e1" : "#334155";

  const data = useMemo(
    () => ({
      labels: spec.labels,
      datasets: spec.series.map((s, i) => {
        const color = s.color || PALETTE[i % PALETTE.length];
        return {
          label: s.name,
          data: s.data,
          borderColor: color,
          backgroundColor:
            spec.kind === "area"
              ? color + "33"
              : spec.kind === "bar"
                ? color + "cc"
                : color,
          fill: spec.kind === "area",
          tension: 0.25,
          pointRadius: spec.kind === "line" || spec.kind === "area" ? 2 : 0,
          borderWidth: 2,
        };
      }),
    }),
    [spec],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: spec.series.length > 1,
          labels: { color: text },
        },
        title: spec.title
          ? { display: true, text: spec.title, color: text }
          : { display: false },
        tooltip: { mode: "index" as const, intersect: false },
      },
      scales: {
        x: {
          ticks: { color: text, maxRotation: 0, autoSkip: true },
          grid: { color: grid },
          title: spec.xLabel
            ? { display: true, text: spec.xLabel, color: text }
            : { display: false },
        },
        y: {
          ticks: { color: text },
          grid: { color: grid },
          title: spec.yLabel
            ? { display: true, text: spec.yLabel, color: text }
            : { display: false },
        },
      },
    }),
    [spec, text, grid],
  );

  return (
    <div style={{ height: 260 }}>
      {spec.kind === "bar" ? (
        <Bar data={data} options={options} />
      ) : (
        <Line data={data} options={options} />
      )}
    </div>
  );
}

export function tryParseChart(output: string): ChartSpec | null {
  const marker = "\u001EMARTALL_CHART\u001E";
  const idx = output.indexOf(marker);
  if (idx === -1) return null;
  const json = output.slice(idx + marker.length);
  try {
    return JSON.parse(json) as ChartSpec;
  } catch {
    return null;
  }
}
