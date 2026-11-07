import { lazy, Suspense, useMemo, useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import MermaidBlock from "./MermaidBlock";
import LuaLiveBlock from "./LuaLiveBlock";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { RoutineBar, RoutineHistory } from "./RoutinePanel";
import { MetricsBar, MetricsHistory } from "./MetricsPanel";
import { isRoutineNote } from "../utils/routine";
import { isMetricsNote } from "../utils/metrics";
import TaskDialog from "./TaskDialog";
import { applyTaskEdit, parseTaskLine, toggleTaskDone, type Task } from "../utils/task";
import { todayIso } from "../utils/routine";
import type { NoteInfo } from "../types";
import { isDrawingPath, isMermaidPath } from "../utils/drawing";

// Excalidraw is large; only load it when a note embeds a drawing.
const DrawingEmbed = lazy(() => import("./DrawingEmbed"));
const MermaidEmbed = lazy(() => import("./MermaidEmbed"));

interface Props {
  content: string;
  notePath: string | null;
  darkMode?: boolean;
  onOpenNote?: (path: string) => void;
  /** When set, task checkboxes are clickable and write the toggled markdown back. */
  onContentChange?: (content: string) => void;
  /** When set, mermaid blocks get an "Edit as drawing" button. */
  onMermaidToDrawing?: (code: string) => Promise<void>;
}

/** `- [ ] text` / `1. [x] text` (optionally inside a blockquote). Groups: prefix, mark. */
const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/;

/** Flip the checkbox on 0-based `lineIdx`; returns null if that line isn't a task. */
function toggleTaskLine(md: string, lineIdx: number): string | null {
  const lines = md.split("\n");
  const line = lines[lineIdx];
  if (line === undefined || !TASK_LINE_RE.test(line)) return null;
  lines[lineIdx] = line.replace(TASK_LINE_RE, (_m, prefix: string, mark: string) =>
    `${prefix}${mark === " " ? "x" : " "}]`,
  );
  return lines.join("\n");
}

/**
 * Remark plugin: rewrites `[[Target]]` and `[[Target|Display]]` text spans
 * into link nodes with `url = "wiki:<target>"`. The `a` component handler
 * below detects the `wiki:` prefix and routes the click through `onOpenNote`.
 * `![[Target]]` becomes `wikiembed:<target>` (rendered inline for drawings).
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
          const embed = m.index > last && text[m.index - 1] === "!";
          const before = text.slice(last, embed ? m.index - 1 : m.index);
          if (before) {
            out.push({ type: "text", value: before });
          }
          const raw = m[1];
          const pipe = raw.indexOf("|");
          const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
          const display = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim();
          out.push({
            type: "link",
            url: (embed ? "wikiembed:" : "wiki:") + target,
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

/**
 * Extract a YouTube video ID from a URL. Supports watch?v=, youtu.be,
 * /embed/, and /shorts/ forms. Returns null for non-YouTube URLs.
 */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v") || "";
        return /^[\w-]{11}$/.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * If `node` has exactly one child (or one child wrapped in a paragraph) that
 * is a link to a YouTube URL, returns its video ID. Used by the `p` and `li`
 * overrides so the embed triggers in both paragraphs and (tight or loose)
 * list items.
 */
function soleYouTubeIdOf(node: unknown): string | null {
  const n = node as { children?: Array<unknown> } | undefined;
  if (!n?.children || n.children.length !== 1) return null;
  let child = n.children[0] as { type?: string; url?: string; children?: Array<unknown> };
  if (child.type === "paragraph" && child.children?.length === 1) {
    child = child.children[0] as typeof child;
  }
  if (child.type === "link" && typeof child.url === "string") {
    return extractYouTubeId(child.url);
  }
  return null;
}

function YouTubeEmbed({ id }: { id: string }) {
  const [playing, setPlaying] = useState(false);

  // Shared frame: 16:9, capped at 480px wide so a row of videos in a note
  // doesn't blow up the layout, but still fills narrow viewports.
  const frame: React.CSSProperties = {
    position: "relative",
    paddingBottom: "56.25%",
    width: "100%",
    maxWidth: 480,
  };

  if (playing) {
    return (
      <div className="my-3 rounded-lg overflow-hidden bg-black" style={frame}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      title="Play"
      className="my-3 rounded-lg overflow-hidden bg-black block group cursor-pointer"
      style={frame}
    >
      <img
        src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
        alt="YouTube video thumbnail"
        loading="lazy"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/25 transition-colors">
        <div className="w-16 h-16 rounded-full bg-red-600/95 flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </button>
  );
}

/** Color bucket for a due date relative to today. */
function dueDateBucket(date: string): "overdue" | "today" | "soon" | "later" {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (date < todayStr) return "overdue";
  if (date === todayStr) return "today";
  const due = new Date(date + "T00:00:00");
  const today = new Date(todayStr + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 7 ? "soon" : "later";
}

const DUE_PILL_CLASSES: Record<ReturnType<typeof dueDateBucket>, string> = {
  overdue: "bg-red-500/15 text-red-500",
  today: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  soon: "bg-accent/15 text-accent",
  later: "bg-gray-500/15 text-gray-500 dark:text-gray-400",
};

function DueDatePill({ date }: { date: string }) {
  const cls = DUE_PILL_CLASSES[dueDateBucket(date)];
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0 text-[0.8em] rounded-full font-medium mx-0.5 ${cls}`}
      title={`Due ${date}`}
    >
      <span>📅</span>
      <span>{date}</span>
    </span>
  );
}

const TASK_MARK_TITLES: Record<string, string> = {
  "⏳": "Scheduled", "🛫": "Start", "➕": "Created", "✅": "Done", "❌": "Cancelled", "🔁": "Recurs",
};

/** Muted pill for the other task markers (⏳ 🛫 ➕ ✅ ❌ dates and 🔁 rules). */
function TaskMarkPill({ emoji, text }: { emoji: string; text: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[0.8em] rounded-full mx-0.5 bg-gray-500/15 text-gray-500 dark:text-gray-400"
      title={`${TASK_MARK_TITLES[emoji] ?? ""} ${text}`.trim()}
    >
      <span>{emoji}</span>
      <span>{text}</span>
    </span>
  );
}

/** Renders #tags as styled pills and 📅 YYYY-MM-DD as colored due-date pills. */
function renderWithTags(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    // Single splitter that captures either a tag (with optional leading whitespace)
    // or a `📅 YYYY-MM-DD` marker.
    const parts = children.split(
      /((?:^|(?<=\s))#\p{L}[\p{L}\p{N}_/-]*|📅\s*\d{4}-\d{2}-\d{2}|(?:⏳|🛫|➕|✅|❌)\uFE0F?\s*\d{4}-\d{2}-\d{2}|🔁\uFE0F?\s*every\b[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#]*)/gu,
    );
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
      const dueMatch = part.match(/^📅\s*(\d{4}-\d{2}-\d{2})$/);
      if (dueMatch) {
        return <DueDatePill key={i} date={dueMatch[1]} />;
      }
      const markMatch = part.match(/^(⏳|🛫|➕|✅|❌|🔁)\uFE0F?\s*(.+?)\s*$/u);
      if (markMatch) {
        return <TaskMarkPill key={i} emoji={markMatch[1]} text={markMatch[2]} />;
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

export default function Preview({ content, notePath, darkMode = true, onOpenNote, onContentChange, onMermaidToDrawing }: Props) {
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
  const isRoutine = useMemo(() => isRoutineNote(content), [content]);
  const isMetrics = useMemo(() => isMetricsNote(content), [content]);

  const commitContent = (next: string) => {
    if (!onContentChange) return;
    // Skip the debounce so the change shows immediately.
    if (timerRef.current) clearTimeout(timerRef.current);
    setDebouncedContent(fixImagePaths(next));
    onContentChange(next);
  };

  const handleToggleTask = (lineIdx: number) => {
    if (!onContentChange) return;
    // Routines just flip the box; Finish session does the logging.
    if (isRoutine) {
      const next = toggleTaskLine(content, lineIdx);
      if (next !== null) commitContent(next);
      return;
    }
    const lines = content.split("\n");
    if (!parseTaskLine(lines[lineIdx] ?? "")) return;
    lines.splice(lineIdx, 1, ...toggleTaskDone(lines[lineIdx], todayIso()));
    commitContent(lines.join("\n"));
  };

  const [taskEdit, setTaskEdit] = useState<{ line: number; task: Task } | null>(null);
  const openTaskEdit = (lineIdx: number) => {
    const task = parseTaskLine(content.split("\n")[lineIdx] ?? "");
    if (task) setTaskEdit({ line: lineIdx, task });
  };

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
      {isRoutine && (
        <RoutineBar content={content} notePath={notePath} onContentChange={onContentChange} />
      )}
      {isMetrics && <MetricsBar content={content} onContentChange={onContentChange} />}
      <div ref={contentRef} className="markdown-body text-gray-800 dark:text-gray-200 max-w-none">
        <Markdown
          remarkPlugins={[remarkGfm, remarkWikiLinks]}
          components={{
            code: ({ className, children, ...props }) => {
              const cls = className || "";
              if (/language-mermaid/.test(cls)) {
                const chart = String(children).replace(/\n$/, "");
                return (
                  <MermaidBlock
                    chart={chart}
                    dark={darkMode}
                    onEditAsDrawing={onMermaidToDrawing ? () => onMermaidToDrawing(chart) : undefined}
                  />
                );
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
              if (href && href.startsWith("wikiembed:")) {
                const target = href.slice(10);
                const resolved = wikiResolved[target];
                if (typeof resolved === "string" && isDrawingPath(resolved)) {
                  return (
                    <Suspense fallback={<span className="text-xs text-gray-400">Loading drawing…</span>}>
                      <DrawingEmbed
                        path={resolved}
                        title={target}
                        dark={darkMode}
                        onOpen={onOpenNote ? () => onOpenNote(resolved) : undefined}
                      />
                    </Suspense>
                  );
                }
                if (typeof resolved === "string" && isMermaidPath(resolved)) {
                  return (
                    <Suspense fallback={<span className="text-xs text-gray-400">Loading diagram…</span>}>
                      <MermaidEmbed
                        path={resolved}
                        title={target}
                        dark={darkMode}
                        onOpen={onOpenNote ? () => onOpenNote(resolved) : undefined}
                      />
                    </Suspense>
                  );
                }
                href = "wiki:" + target;
              }
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
            p: ({ node, children }) => {
              const ytId = soleYouTubeIdOf(node);
              if (ytId) return <YouTubeEmbed id={ytId} />;
              return <p>{renderWithTags(children)}</p>;
            },
            input: ({ node: _node, type, checked, ...props }) => {
              if (type !== "checkbox") return <input type={type} checked={checked} {...props} />;
              return (
                <input
                  type="checkbox"
                  checked={!!checked}
                  disabled={!onContentChange}
                  onChange={() => {}}
                  className="task-checkbox"
                />
              );
            },
            li: ({ node, className, children }) => {
              // Tight list items get the link as a direct child; loose lists
              // wrap it in a paragraph. `soleYouTubeIdOf` handles both.
              const ytId = soleYouTubeIdOf(node);
              if (ytId) {
                return (
                  <li style={{ listStyle: "none" }}>
                    <YouTubeEmbed id={ytId} />
                  </li>
                );
              }
              if (className?.includes("task-list-item")) {
                const lineIdx = (node?.position?.start.line ?? 0) - 1;
                return (
                  <li
                    className={className + " group relative"}
                    onClick={(e) => {
                      // Only the item's own checkbox; nested items handle theirs.
                      if ((e.target as HTMLElement).classList.contains("task-checkbox")) {
                        e.stopPropagation();
                        handleToggleTask(lineIdx);
                      }
                    }}
                  >
                    {renderWithTags(children)}
                    {onContentChange && !isRoutine && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openTaskEdit(lineIdx);
                        }}
                        className="task-edit-btn absolute right-0 top-0 px-1.5 text-xs rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-accent hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity"
                        title="Edit task"
                      >
                        ✎
                      </button>
                    )}
                  </li>
                );
              }
              return <li>{renderWithTags(children)}</li>;
            },
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
      {isRoutine && <RoutineHistory content={debouncedContent} dark={darkMode} />}
      {isMetrics && <MetricsHistory content={debouncedContent} dark={darkMode} />}
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
      {taskEdit && (
        <TaskDialog
          initial={taskEdit.task}
          isNew={false}
          onApply={(task) => {
            commitContent(applyTaskEdit(content, taskEdit.line, taskEdit.task, task, todayIso()));
            setTaskEdit(null);
          }}
          onCancel={() => setTaskEdit(null)}
        />
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
