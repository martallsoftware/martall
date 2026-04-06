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
}

export default function MermaidBlock({ chart, dark = true }: Props) {
  const trimmed = chart.trim();
  const cacheKey = `${dark ? "d" : "l"}:${trimmed}`;
  const cached = svgCache.get(cacheKey);

  const [svg, setSvg] = useState<string | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++idCounter}`);
  const renderingRef = useRef(false);

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
    <div
      className="my-3 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
