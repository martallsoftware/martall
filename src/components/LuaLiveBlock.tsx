import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ChartView, { tryParseChart } from "./ChartView";

interface Props {
  code: string;
  notePath: string | null;
}

// Module-level cache so re-renders (debounced edits, view-mode toggles,
// remounts from react-markdown) don't re-run scripts unnecessarily.
type CacheEntry = { output: string; error: string | null; ranAt: number };
const resultCache = new Map<string, CacheEntry>();

function hashCode(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

// Parse `-- refresh: 30s` (or 5m / 1h) on any of the first lines.
function parseRefreshInterval(code: string): number | null {
  const head = code.split("\n").slice(0, 5).join("\n");
  const m = head.match(/--\s*refresh\s*:\s*(\d+)\s*([smh])/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = unit === "h" ? n * 3600_000 : unit === "m" ? n * 60_000 : n * 1000;
  return ms < 1000 ? 1000 : ms;
}

export default function LuaLiveBlock({ code, notePath }: Props) {
  const cacheKey = `${notePath ?? ""}::${hashCode(code)}`;
  const cached = resultCache.get(cacheKey);

  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [output, setOutput] = useState<string>(cached?.output ?? "");
  const [error, setError] = useState<string | null>(cached?.error ?? null);
  const [ranAt, setRanAt] = useState<number>(cached?.ranAt ?? 0);
  const [running, setRunning] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const refreshMs = parseRefreshInterval(code);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!notePath) return;
    invoke<boolean>("is_note_trusted", { notePath })
      .then(setTrusted)
      .catch(() => setTrusted(false));
  }, [notePath]);

  const run = useCallback(async () => {
    if (!notePath || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      const result = await invoke<string>("run_lua_script", {
        notePath,
        code,
      });
      const now = Date.now();
      setOutput(result);
      setRanAt(now);
      resultCache.set(cacheKey, { output: result, error: null, ranAt: now });
    } catch (err) {
      const msg = String(err);
      setError(msg);
      const now = Date.now();
      setRanAt(now);
      resultCache.set(cacheKey, { output: "", error: msg, ranAt: now });
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }, [code, notePath, cacheKey]);

  // Auto-run on first mount when trusted, but only if cache is empty.
  useEffect(() => {
    if (trusted && !resultCache.has(cacheKey)) run();
  }, [trusted, cacheKey, run]);

  // Auto-refresh interval (if `-- refresh: Ns` is in the script).
  useEffect(() => {
    if (!trusted || !refreshMs) return;
    const id = setInterval(run, refreshMs);
    return () => clearInterval(id);
  }, [trusted, refreshMs, run]);

  const trust = async () => {
    if (!notePath) return;
    await invoke("set_note_trusted", { notePath, trusted: true });
    setTrusted(true);
  };

  if (trusted === null) {
    return (
      <div className="my-3 px-3 py-2 text-xs text-gray-400 border border-gray-200 dark:border-gray-700/50 rounded">
        Loading lua-live…
      </div>
    );
  }

  if (!trusted) {
    return (
      <div className="my-3 p-3 border border-yellow-400/40 bg-yellow-400/10 rounded text-sm">
        <div className="font-medium mb-1">⚠️ Scripted block (lua-live)</div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
          This note contains a Lua script. Scripts run sandboxed but can compute
          arbitrary results. Trust this note to enable execution.
        </div>
        <div className="flex gap-2">
          <button
            onClick={trust}
            className="px-2 py-1 text-xs rounded bg-accent text-white hover:opacity-90"
          >
            Trust this note
          </button>
          <button
            onClick={() => setShowSource((s) => !s)}
            className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600"
          >
            {showSource ? "Hide" : "Show"} source
          </button>
        </div>
        {showSource && (
          <pre className="mt-2 text-xs overflow-auto p-2 bg-black/5 dark:bg-white/5 rounded">
            {code}
          </pre>
        )}
      </div>
    );
  }

  const ranAgo = ranAt
    ? (() => {
        const s = Math.round((Date.now() - ranAt) / 1000);
        if (s < 60) return `${s}s ago`;
        const m = Math.round(s / 60);
        if (m < 60) return `${m}m ago`;
        return `${Math.round(m / 60)}h ago`;
      })()
    : "never";

  return (
    <div className="my-3 border border-gray-200 dark:border-gray-700/50 rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 text-xs bg-gray-100 dark:bg-gray-800/50">
        <span className="text-gray-500">
          lua-live · {running ? "running…" : ranAgo}
          {refreshMs ? ` · auto every ${Math.round(refreshMs / 1000)}s` : ""}
        </span>
        <div className="flex gap-2">
          <button
            onClick={run}
            disabled={running}
            className="text-gray-500 hover:text-accent"
            title="Re-run script now"
          >
            ⟳
          </button>
          <button
            onClick={() => setShowSource((s) => !s)}
            className="text-gray-500 hover:text-accent"
            title="Toggle source"
          >
            {"</>"}
          </button>
        </div>
      </div>
      {showSource && (
        <pre className="text-xs overflow-auto p-2 bg-black/5 dark:bg-white/5 m-0">
          {code}
        </pre>
      )}
      <div className="px-3 py-2 text-sm whitespace-pre-wrap">
        {error ? (
          <span className="text-red-500">⚠ {error}</span>
        ) : (() => {
          const chart = tryParseChart(output);
          if (chart) return <ChartView spec={chart} />;
          return output || <span className="text-gray-400 italic">(no output)</span>;
        })()}
      </div>
    </div>
  );
}
