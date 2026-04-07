import { useMemo, useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import MermaidBlock from "./MermaidBlock";
import LuaLiveBlock from "./LuaLiveBlock";

interface Props {
  content: string;
  notePath: string | null;
  darkMode?: boolean;
}

// Global cache so images survive re-renders and re-mounts
const imageCache = new Map<string, string>();

function fixImagePaths(md: string): string {
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    const encoded = url.replace(/ /g, "%20");
    return `![${alt}](${encoded})`;
  });
}

function parseImageSize(alt: string): {
  cleanAlt: string;
  style: React.CSSProperties;
} {
  const match = alt.match(/^(.*?)\|(\d+(?:%|x\d+)?)\s*$/);
  if (!match) {
    return { cleanAlt: alt, style: { maxWidth: "100%", borderRadius: "8px" } };
  }

  const cleanAlt = match[1].trim();
  const sizeStr = match[2];

  if (sizeStr.endsWith("%")) {
    return {
      cleanAlt,
      style: { width: sizeStr, borderRadius: "8px" },
    };
  }

  const dims = sizeStr.split("x");
  if (dims.length === 2) {
    return {
      cleanAlt,
      style: {
        width: `${dims[0]}px`,
        height: `${dims[1]}px`,
        borderRadius: "8px",
      },
    };
  }

  return {
    cleanAlt,
    style: { width: `${sizeStr}px`, borderRadius: "8px" },
  };
}

function resolveImagePath(src: string, noteDir: string | null): string | null {
  if (!noteDir) return null;
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:")
  ) {
    return null;
  }
  const decoded = decodeURIComponent(src);
  if (decoded.startsWith("/")) {
    return decoded;
  }
  const relative = decoded.startsWith("./") ? decoded.slice(2) : decoded;
  return `${noteDir}/${relative}`;
}


function LocalImage({
  absolutePath,
  src,
  noteDir,
  alt,
  style,
}: {
  absolutePath: string;
  src?: string;
  noteDir?: string | null;
  alt: string;
  style: React.CSSProperties;
}) {
  const cached = imageCache.get(absolutePath);
  const [dataUrl, setDataUrl] = useState<string | null>(cached ?? null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Already cached, no need to fetch
    if (imageCache.has(absolutePath)) {
      setDataUrl(imageCache.get(absolutePath)!);
      return;
    }

    let cancelled = false;

    const tryLoad = async () => {
      // Try direct path first
      try {
        const url = await invoke<string>("read_image_base64", { path: absolutePath });
        imageCache.set(absolutePath, url);
        if (!cancelled) setDataUrl(url);
        return;
      } catch {
        // Direct path failed — try parent directories
      }

      if (src && noteDir) {
        const decoded = decodeURIComponent(src);
        const relative = decoded.startsWith("./") ? decoded.slice(2) : decoded;
        let dir = noteDir;
        for (let i = 0; i < 5; i++) {
          const lastSlash = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
          if (lastSlash <= 0) break;
          dir = dir.substring(0, lastSlash);
          const candidate = `${dir}/${relative}`;
          try {
            const url = await invoke<string>("read_image_base64", { path: candidate });
            imageCache.set(absolutePath, url);
            if (!cancelled) setDataUrl(url);
            return;
          } catch {
            // Try next parent
          }
        }
      }

      if (!cancelled) setError(true);
    };

    tryLoad();
    return () => {
      cancelled = true;
    };
  }, [absolutePath, src, noteDir]);

  if (error) {
    return (
      <span className="inline-block px-3 py-1 text-xs text-red-400 bg-red-500/10 rounded">
        Image not found: {absolutePath.split(/[/\\]/).pop()}
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className="inline-block px-3 py-1 text-xs text-gray-400 animate-pulse">
        Loading image...
      </span>
    );
  }
  return <img src={dataUrl} alt={alt} style={style} />;
}

/** Renders #tags as styled pills within text content */
function renderWithTags(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    const parts = children.split(/((?:^|(?<=\s))#\p{L}[\p{L}\p{N}_/-]*)/gu);
    if (parts.length === 1) return children;
    return parts.map((part, i) => {
      if (/^#\p{L}/u.test(part)) {
        return (
          <span
            key={i}
            className="inline-flex items-center px-1.5 py-0 text-[0.85em] rounded-full bg-accent/15 text-accent font-medium mx-0.5"
          >
            {part}
          </span>
        );
      }
      // Check if part starts with whitespace + #tag (lookbehind matched \s)
      const wsMatch = part.match(/^(\s+)(#\p{L}[\p{L}\p{N}_/-]*)$/u);
      if (wsMatch) {
        return (
          <span key={i}>
            {wsMatch[1]}
            <span className="inline-flex items-center px-1.5 py-0 text-[0.85em] rounded-full bg-accent/15 text-accent font-medium mx-0.5">
              {wsMatch[2]}
            </span>
          </span>
        );
      }
      return part;
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{renderWithTags(child)}</span>
    ));
  }
  return children;
}

export default function Preview({ content, notePath, darkMode = true }: Props) {
  const noteDir = useMemo(() => {
    if (!notePath) return null;
    const lastSlash = Math.max(notePath.lastIndexOf("/"), notePath.lastIndexOf("\\"));
    return lastSlash >= 0 ? notePath.substring(0, lastSlash) : null;
  }, [notePath]);

  const processedContent = useMemo(() => fixImagePaths(content), [content]);

  // Debounce preview updates to avoid re-rendering on every keystroke
  const [debouncedContent, setDebouncedContent] = useState(processedContent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedContent(processedContent);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [processedContent]);

  return (
    <div className="h-full overflow-auto p-5">
      <div className="markdown-body text-gray-800 dark:text-gray-200 max-w-none">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ className, children, ...props }) => {
              const cls = className || "";
              if (/language-mermaid/.test(cls)) {
                const chart = String(children).replace(/\n$/, "");
                return <MermaidBlock chart={chart} dark={darkMode} />;
              }
              if (/language-lua-live/.test(cls)) {
                const code = String(children).replace(/\n$/, "");
                return <LuaLiveBlock code={code} notePath={notePath} />;
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children }) => {
              // If the child is a mermaid block, don't wrap in <pre>
              if (
                children &&
                typeof children === "object" &&
                "props" in children
              ) {
                const props = (children as React.ReactElement).props as Record<string, unknown>;
                const cls = String(props?.className || "");
                if (/language-mermaid/.test(cls) || /language-lua-live/.test(cls)) {
                  return <>{children}</>;
                }
              }
              return <pre>{children}</pre>;
            },
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) openUrl(href);
                }}
                style={{ cursor: "pointer" }}
              >
                {children}
              </a>
            ),
            p: ({ children }) => <p>{renderWithTags(children)}</p>,
            li: ({ children }) => <li>{renderWithTags(children)}</li>,
            img: ({ src, alt }) => {
              const rawAlt = alt || "";
              const { cleanAlt, style } = parseImageSize(rawAlt);
              const resolvedSrc = src || "";
              const absolutePath = resolveImagePath(resolvedSrc, noteDir);

              if (absolutePath) {
                return (
                  <LocalImage
                    absolutePath={absolutePath}
                    src={resolvedSrc}
                    noteDir={noteDir}
                    alt={cleanAlt}
                    style={style}
                  />
                );
              }

              return <img src={resolvedSrc} alt={cleanAlt} style={style} />;
            },
          }}
        >
          {debouncedContent}
        </Markdown>
      </div>
    </div>
  );
}
