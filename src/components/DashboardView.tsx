import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LuaLiveBlock from "./LuaLiveBlock";
import { parseDashboard, type Widget } from "../utils/parseDashboard";

interface Props {
  content: string;
  notePath: string | null;
  darkMode: boolean;
}

function patternStyle(pattern?: string, dark?: boolean): React.CSSProperties {
  if (!pattern || pattern === "none") return {};
  const c = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  if (pattern === "dots") {
    return {
      backgroundImage: `radial-gradient(${c} 1px, transparent 1px)`,
      backgroundSize: "16px 16px",
    };
  }
  if (pattern === "grid") {
    return {
      backgroundImage:
        `linear-gradient(${c} 1px, transparent 1px),` +
        `linear-gradient(90deg, ${c} 1px, transparent 1px)`,
      backgroundSize: "24px 24px",
    };
  }
  return {};
}

function WidgetCard({
  widget,
  notePath,
  dark,
}: {
  widget: Widget;
  notePath: string | null;
  dark: boolean;
}) {
  const cardBg = widget.bg || (dark ? "#1e1e2e" : "#ffffff");
  const border = widget.accent || (dark ? "#2a2a3a" : "#e5e7eb");
  const titleColor = dark ? "#e2e8f0" : "#1e293b";

  return (
    <div
      className="rounded-xl shadow-sm overflow-hidden flex flex-col"
      style={{
        gridColumn: `span ${widget.span}`,
        background: cardBg,
        border: `1px solid ${border}`,
      }}
    >
      {widget.title && (
        <div
          className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
          style={{
            color: titleColor,
            borderBottom: `1px solid ${border}`,
            background: widget.accent ? `${widget.accent}22` : "transparent",
          }}
        >
          {widget.title}
        </div>
      )}
      <div className="p-4 flex-1 min-w-0">
        {widget.type === "lua-live" ? (
          <LuaLiveBlock
            code={widget.body}
            notePath={notePath}
            showHeader={widget.showHeader}
          />
        ) : widget.type === "image" ? (
          <img
            src={widget.body.trim()}
            alt={widget.title || ""}
            style={{ maxWidth: "100%", borderRadius: 8 }}
          />
        ) : (
          <div
            className="markdown-body text-sm"
            style={{ color: dark ? "#cbd5e1" : "#334155" }}
          >
            <Markdown remarkPlugins={[remarkGfm]}>
              {widget.body
                .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
                .replace(/\{\{time\}\}/g, new Date().toLocaleTimeString())}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardView({ content, notePath, darkMode }: Props) {
  const parsed = useMemo(() => parseDashboard(content), [content]);
  const { meta, widgets } = parsed;
  // Dashboards default to light unless the note explicitly sets `theme: dark`.
  const dark = meta.theme === "dark" ? true : false;
  void darkMode; // app theme intentionally ignored for dashboard view

  const noteBg = meta.bg || (dark ? "#0f172a" : "#f8fafc");

  return (
    <div
      className="h-full overflow-auto"
      style={{
        background: noteBg,
        ...patternStyle(meta.pattern, dark),
      }}
    >
      <div className="max-w-[1600px] mx-auto p-6">
        {meta.title && (
          <h1
            className="text-3xl font-bold mb-6"
            style={{ color: dark ? "#f1f5f9" : "#0f172a" }}
          >
            {meta.title}
          </h1>
        )}
        {widgets.length === 0 ? (
          <div
            className="text-sm opacity-60"
            style={{ color: dark ? "#cbd5e1" : "#475569" }}
          >
            No widgets defined. Add fenced blocks like:
            <pre className="mt-2 p-3 rounded bg-black/20 text-xs">{`\`\`\`widget title="Hello" span=2
{text}
# Hi there
\`\`\``}</pre>
          </div>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${meta.cols}, minmax(0, 1fr))`,
              gap: `${meta.gap}px`,
            }}
          >
            {widgets.map((w) => (
              <WidgetCard
                key={w.id}
                widget={w}
                notePath={notePath}
                dark={dark}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for App.tsx so it can detect dashboard notes without importing the parser.
export function isDashboardNote(content: string): boolean {
  return parseDashboard(content).meta.dashboard;
}
