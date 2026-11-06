import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let idCounter = 0;

// Global cache: chart source → rendered SVG
const svgCache = new Map<string, string>();

function initMermaid(dark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "loose",
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: "basis",
    },
  });
}

interface Props {
  chart: string;
  dark?: boolean;
  /** Shows an "Edit as drawing" button that opens the chart in the drawing editor. */
  onEditAsDrawing?: () => Promise<void>;
}

export default function MermaidBlock({ chart, dark = true, onEditAsDrawing }: Props) {
  const trimmed = chart.trim();
  const cacheKey = `${dark ? "d" : "l"}:${trimmed}`;
  const cached = svgCache.get(cacheKey);

  const [svg, setSvg] = useState<string | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++idCounter}`);
  const renderingRef = useRef(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (!trimmed) return;

    // Already cached — use it instantly
    if (svgCache.has(cacheKey)) {
      setSvg(svgCache.get(cacheKey)!);
      setError(null);
      return;
    }

    // Debounce rendering to avoid thrashing during typing
    const timer = setTimeout(async () => {
      if (renderingRef.current) return;
      renderingRef.current = true;

      initMermaid(dark);

      // Mermaid reuses IDs, so generate a fresh one each render
      const renderId = `mermaid-${++idCounter}`;
      idRef.current = renderId;

      try {
        const { svg: rendered } = await mermaid.render(renderId, trimmed);
        svgCache.set(cacheKey, rendered);
        setSvg(rendered);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
        // Don't clear svg — keep showing the last good render
        // Clean up mermaid's error element
        const errEl = document.getElementById("d" + renderId);
        errEl?.remove();
      }
      renderingRef.current = false;
    }, 500);

    return () => clearTimeout(timer);
  }, [cacheKey, trimmed, dark]);

  if (error && !svg) {
    return (
      <div className="my-3 p-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <p className="text-xs text-red-500 font-medium mb-1">Diagram error</p>
        <pre className="text-xs text-red-400 whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 p-4 text-center text-xs text-gray-400 animate-pulse">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div className="my-3 group relative">
      <div
        className="flex justify-center overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {onEditAsDrawing && (
        <button
          disabled={converting}
          onClick={async () => {
            setConverting(true);
            setConvertError(null);
            try {
              await onEditAsDrawing();
            } catch (err) {
              setConvertError(err instanceof Error ? err.message : String(err));
            }
            setConverting(false);
          }}
          className="absolute top-1 right-1 px-2 py-1 text-xs rounded-md bg-gray-200/90 dark:bg-gray-700/90 text-gray-700 dark:text-gray-200 opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity"
          title="Copy this diagram into a new drawing you can edit freely"
        >
          {converting ? "Converting…" : "✏️ Edit as drawing"}
        </button>
      )}
      {convertError && (
        <p className="mt-1 text-xs text-red-500">Could not convert to a drawing: {convertError}</p>
      )}
    </div>
  );
}
