import { useMemo, useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import MermaidBlock from "./MermaidBlock";
import LuaLiveBlock from "./LuaLiveBlock";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import type { NoteInfo } from "../types";

interface Props {
  content: string;
  notePath: string | null;
  darkMode?: boolean;
  onOpenNote?: (path: string) => void;
}

/**
 * Remark plugin: rewrites `[[Target]]` and `[[Target|Display]]` text spans
 * into link nodes with `url = "wiki:<target>"`. The `a` component handler
 * below detects the `wiki:` prefix and routes the click through `onOpenNote`.
 * Nodes without `children` (code, inlineCode) are untouched.
 */
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
function remarkWikiLinks() {
  const visit = (node: { type?: string; children?: unknown[] }) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "link") return;
    if (!Array.isArray(node.children)) return;

    const out: unknown[] = [];
    for (const child of node.children) {
      const c = child as { type?: string; value?: string };
      if (c.type === "text" && typeof c.value === "string" && c.value.includes("[[")) {
        const text = c.value;
        let last = 0;
        let matched = false;
        WIKI_LINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WIKI_LINK_RE.exec(text)) !== null) {
          matched = true;
          if (m.index > last) {
            out.push({ type: "text", value: text.slice(last, m.index) });
          }
          const raw = m[1];
          const pipe = raw.indexOf("|");
          const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
          const display = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim();
          out.push({
            type: "link",
            url: "wiki:" + target,
            title: null,
            children: [{ type: "text", value: display }],
          });
          last = WIKI_LINK_RE.lastIndex;
        }
        if (matched) {
          if (last < text.length) {
            out.push({ type: "text", value: text.slice(last) });
          }
        } else {
          out.push(child);
        }
      } else {
        out.push(child);
        visit(c as { type?: string; children?: unknown[] });
      }
    }
    node.children = out;
  };
  return (tree: { type?: string; children?: unknown[] }) => visit(tree);
}

/** Extract all unique `[[…]]` targets from raw markdown, ignoring code blocks. */
function extractWikiTargets(md: string): string[] {
  const stripped = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
  const set = new Set<string>();
  const re = /\[\[([^\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const raw = m[1];
    const pipe = raw.indexOf("|");
    const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    if (target) set.add(target);
  }
  return Array.from(set);
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

export default function Preview({ content, notePath, darkMode = true, onOpenNote }: Props) {
  const noteDir = useMemo(() => {
    if (!notePath) return null;
    const lastSlash = Math.max(notePath.lastIndexOf("/"), notePath.lastIndexOf("\\"));
    return lastSlash >= 0 ? notePath.substring(0, lastSlash) : null;
  }, [notePath]);

  const processedContent = useMemo(() => fixImagePaths(content), [content]);

  // Debounce preview updates to avoid re-rendering on every keystroke
  const [debouncedContent, setDebouncedContent] = useState(processedContent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);

  const copyText = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for environments without clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection()?.toString() ?? "";
    setMenu({ x: e.clientX, y: e.clientY, hasSelection: selection.length > 0 });
  };

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const items: MenuItem[] = [];
    if (menu.hasSelection) {
      items.push({
        label: "Copy selection",
        onClick: () => copyText(window.getSelection()?.toString() ?? ""),
      });
    }
    items.push({
      label: "Select all",
      onClick: () => {
        if (!contentRef.current) return;
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      },
    });
    items.push({
      label: "Copy all (rendered)",
      onClick: () => copyText(contentRef.current?.innerText ?? ""),
    });
    items.push({
      label: "Copy all (markdown)",
      onClick: () => copyText(content),
    });
    return items;
  }, [menu, content]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedContent(processedContent);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [processedContent]);

  // Extract wiki targets from the (debounced) content and batch-resolve them
  // to absolute paths so the renderer can mark broken links and route clicks.
  const wikiTargets = useMemo(() => extractWikiTargets(debouncedContent), [debouncedContent]);
  const [wikiResolved, setWikiResolved] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (wikiTargets.length === 0) {
      setWikiResolved({});
      return;
    }
    let cancelled = false;
    invoke<Record<string, string | null>>("resolve_wiki_links", {
      targets: wikiTargets,
      fromPath: notePath,
    })
      .then((r) => {
        if (!cancelled) setWikiResolved(r);
      })
      .catch(() => {
        if (!cancelled) setWikiResolved({});
      });
    return () => {
      cancelled = true;
    };
  }, [wikiTargets, notePath]);

  // Backlinks: notes that reference this note via `[[…]]`.
  const [backlinks, setBacklinks] = useState<NoteInfo[]>([]);
  useEffect(() => {
    if (!notePath) {
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    invoke<NoteInfo[]>("get_backlinks", { path: notePath })
      .then((r) => {
        if (!cancelled) setBacklinks(r);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  return (
    <div className="h-full overflow-auto p-5" onContextMenu={handleContextMenu}>
      <div ref={contentRef} className="markdown-body text-gray-800 dark:text-gray-200 max-w-none">
        <Markdown
          remarkPlugins={[remarkGfm, remarkWikiLinks]}
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
            a: ({ href, children }) => {
              if (href && href.startsWith("wiki:")) {
                const target = href.slice(5);
                const resolved = wikiResolved[target];
                const broken = resolved === null;
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (typeof resolved === "string" && onOpenNote) {
                        onOpenNote(resolved);
                      }
                    }}
                    className={broken ? "wiki-link wiki-link-broken" : "wiki-link"}
                    title={broken ? `Note not found: ${target}` : target}
                    style={{ cursor: broken ? "not-allowed" : "pointer" }}
                  >
                    {children}
                  </a>
                );
              }
              return (
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
              );
            },
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
      {notePath && backlinks.length > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-300/40 dark:border-gray-700/40">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Backlinks ({backlinks.length})
          </div>
          <ul className="space-y-1">
            {backlinks.map((b) => (
              <li key={b.path}>
                <button
                  onClick={() => onOpenNote?.(b.path)}
                  className="text-sm text-accent hover:underline cursor-pointer text-left"
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
