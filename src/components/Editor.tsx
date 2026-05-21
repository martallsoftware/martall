import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import EmojiPicker from "./EmojiPicker";
import TableDialog from "./TableDialog";
import FlowchartDialog from "./FlowchartDialog";
import { cleanToMarkdown } from "../utils/cleanToMarkdown";
import type { NoteInfo } from "../types";

interface Props {
  content: string;
  onChange: (content: string) => void;
  notePath: string | null;
}

export interface EditorHandle {
  insertAtCursor: (text: string) => void;
}

interface WikiSuggestState {
  /** Index in `content` immediately AFTER the opening `[[` */
  start: number;
  /** The query string between `[[` and the caret */
  query: string;
  /** Popup position, relative to the editor wrapper */
  x: number;
  y: number;
}

/** Look for an open, unclosed `[[query` immediately before the caret. */
function detectWikiQuery(content: string, caret: number): { start: number; query: string } | null {
  const before = content.slice(0, caret);
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return null;
  const between = content.slice(lastOpen + 2, caret);
  if (between.includes("]]") || between.includes("\n") || between.includes("[[")) return null;
  return { start: lastOpen + 2, query: between };
}

/**
 * Compute caret pixel coordinates inside a textarea by mirroring its content
 * into a hidden div and measuring an inline span at the caret position.
 */
function getCaretCoords(ta: HTMLTextAreaElement, position: number): { top: number; left: number; lineHeight: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(ta);
  const properties = [
    "boxSizing","width","height","overflowX","overflowY",
    "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","borderStyle",
    "paddingTop","paddingRight","paddingBottom","paddingLeft",
    "fontStyle","fontVariant","fontWeight","fontStretch","fontSize","fontSizeAdjust",
    "lineHeight","fontFamily","textAlign","textTransform","textIndent","textDecoration",
    "letterSpacing","wordSpacing","tabSize","whiteSpace","wordWrap","wordBreak",
  ] as const;
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  for (const p of properties) {
    div.style[p as never] = style[p as never];
  }
  div.textContent = ta.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = ta.value.substring(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop;
  const left = span.offsetLeft;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  document.body.removeChild(div);
  return { top, left, lineHeight };
}

function EditorImpl({ content, onChange, notePath }: Props, ref: React.Ref<EditorHandle>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const notePathRef = useRef(notePath);
  notePathRef.current = notePath;

  const [showEmoji, setShowEmoji] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showFlowchart, setShowFlowchart] = useState(false);

  // Wiki-link autocomplete
  const [allNotes, setAllNotes] = useState<NoteInfo[]>([]);
  const [suggest, setSuggest] = useState<WikiSuggestState | null>(null);
  const [suggestIndex, setSuggestIndex] = useState(0);

  // Lazy-load all note titles; refresh when the open note changes (cheap,
  // and catches new notes the user created in the meantime).
  useEffect(() => {
    let cancelled = false;
    invoke<NoteInfo[]>("get_all_notes_sorted", { sortBy: "title", ascending: true })
      .then((r) => { if (!cancelled) setAllNotes(r); })
      .catch(() => { if (!cancelled) setAllNotes([]); });
    return () => { cancelled = true; };
  }, [notePath]);

  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase().trim();
    const ranked = allNotes
      .map((n) => {
        const t = n.title.toLowerCase();
        if (!q) return { n, score: 3 };
        if (t === q) return { n, score: 0 };
        if (t.startsWith(q)) return { n, score: 1 };
        if (t.includes(q)) return { n, score: 2 };
        return null;
      })
      .filter((x): x is { n: NoteInfo; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || a.n.title.localeCompare(b.n.title))
      .slice(0, 8);
    return ranked.map((r) => r.n);
  }, [allNotes, suggest]);

  // Keep highlighted index in range as the suggestion list shrinks/grows.
  useEffect(() => {
    if (suggestIndex >= suggestions.length) setSuggestIndex(0);
  }, [suggestions.length, suggestIndex]);

  const updateSuggest = useCallback((value: string, caret: number) => {
    const detected = detectWikiQuery(value, caret);
    if (!detected) {
      setSuggest(null);
      return;
    }
    const ta = textareaRef.current;
    if (!ta) return;
    const { left, top, lineHeight } = getCaretCoords(ta, detected.start - 2);
    setSuggest({
      start: detected.start,
      query: detected.query,
      x: left - ta.scrollLeft,
      y: top - ta.scrollTop + lineHeight,
    });
    setSuggestIndex(0);
  }, []);

  const acceptSuggestion = useCallback(
    (n: NoteInfo) => {
      const ta = textareaRef.current;
      if (!ta || !suggest) return;
      const caret = ta.selectionStart;
      const after = contentRef.current.slice(caret);
      const hasClosing = after.startsWith("]]");
      const insertion = n.title + (hasClosing ? "" : "]]");
      const newContent =
        contentRef.current.slice(0, suggest.start) +
        insertion +
        contentRef.current.slice(caret);
      contentRef.current = newContent;
      onChange(newContent);
      const newCaret = suggest.start + insertion.length + (hasClosing ? 2 : 0);
      setSuggest(null);
      requestAnimationFrame(() => {
        if (ta) {
          ta.selectionStart = ta.selectionEnd = newCaret;
          ta.focus();
        }
      });
    },
    [onChange, suggest],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      const pos = ta?.selectionStart ?? contentRef.current.length;
      const newContent =
        contentRef.current.substring(0, pos) +
        text +
        contentRef.current.substring(pos);
      contentRef.current = newContent;
      onChange(newContent);

      requestAnimationFrame(() => {
        if (ta) {
          const newPos = pos + text.length;
          ta.selectionStart = newPos;
          ta.selectionEnd = newPos;
          ta.focus();
        }
      });
    },
    [onChange],
  );

  useImperativeHandle(ref, () => ({ insertAtCursor }), [insertAtCursor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Wiki autocomplete keyboard handling takes priority while the popup is open
      if (suggest && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSuggestIndex((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          acceptSuggestion(suggestions[suggestIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSuggest(null);
          return;
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const newContent =
          content.substring(0, start) + "    " + content.substring(end);
        onChange(newContent);
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 4;
        });
      }
    },
    [content, onChange, suggest, suggestions, suggestIndex, acceptSuggestion],
  );

  return (
    <div className="relative w-full h-full">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => {
          onChange(e.target.value);
          updateSuggest(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onSelect={(e) => updateSuggest(content, e.currentTarget.selectionStart)}
        onBlur={() => {
          // Defer so a click on a suggestion can fire first
          setTimeout(() => setSuggest(null), 120);
        }}
        onScroll={() => setSuggest(null)}
        className="editor-textarea w-full h-full p-5 pb-12 bg-transparent outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
        placeholder="Start writing..."
        spellCheck={false}
      />

      {/* Wiki-link autocomplete popup */}
      {suggest && suggestions.length > 0 && (
        <div
          className="absolute z-40 min-w-[200px] max-w-[320px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#252538] shadow-xl max-h-[240px] overflow-y-auto"
          style={{ left: suggest.x, top: suggest.y }}
        >
          {suggestions.map((n, i) => (
            <button
              key={n.path}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptSuggestion(n)}
              onMouseEnter={() => setSuggestIndex(i)}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors truncate ${
                i === suggestIndex
                  ? "bg-accent/15 text-accent"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              title={n.path}
            >
              {n.title}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute bottom-2 right-3 flex items-center gap-1 px-2 py-1 rounded-xl border border-gray-200/80 dark:border-gray-700/60 bg-white/90 dark:bg-[#1e1e2e]/90 backdrop-blur-sm shadow-lg">
        {/* Clean/Format button */}
        <button
          onClick={() => {
            const cleaned = cleanToMarkdown(content);
            if (cleaned !== content) {
              onChange(cleaned);
            }
          }}
          className="p-1.5 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Clean & format to Markdown"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l4 4M7 3L3 7" />
            <path d="M14 14l-4-4M10 14l4-4" />
            <path d="M3 12h4M11 6h4" />
          </svg>
        </button>

        {/* Flowchart button */}
        <div className="relative">
          <button
            onClick={() => { setShowFlowchart(!showFlowchart); setShowTable(false); setShowEmoji(false); }}
            className={`p-1.5 rounded-lg transition-colors ${
              showFlowchart
                ? "bg-accent/15 text-accent"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            title="Insert diagram"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="5" height="4" rx="1" />
              <rect x="6.5" y="13" width="5" height="4" rx="1" />
              <rect x="12" y="5" width="5" height="4" rx="1" />
              <path d="M3.5 5v3.5h11V9M9 8.5V13" />
            </svg>
          </button>

          {showFlowchart && (
            <FlowchartDialog
              onInsert={insertAtCursor}
              onClose={() => setShowFlowchart(false)}
            />
          )}
        </div>

        {/* Table button */}
        <div className="relative">
          <button
            onClick={() => { setShowTable(!showTable); setShowEmoji(false); setShowFlowchart(false); }}
            className={`p-1.5 rounded-lg transition-colors ${
              showTable
                ? "bg-accent/15 text-accent"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            title="Insert table"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="2" y="2" width="14" height="14" rx="2" />
              <path d="M2 7h14M2 12h14M7 2v14M12 2v14" />
            </svg>
          </button>

          {showTable && (
            <TableDialog
              onInsert={insertAtCursor}
              onClose={() => setShowTable(false)}
            />
          )}
        </div>

        {/* Emoji button */}
        <div className="relative">
          <button
            onClick={() => { setShowEmoji(!showEmoji); setShowTable(false); setShowFlowchart(false); }}
            className={`p-1.5 rounded-lg text-lg transition-colors ${
              showEmoji
                ? "bg-accent/15 text-accent"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            title="Insert emoji"
          >
            😊
          </button>

          {showEmoji && (
            <EmojiPicker
              onSelect={(emoji) => {
                insertAtCursor(emoji);
              }}
              onClose={() => setShowEmoji(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const Editor = forwardRef<EditorHandle, Props>(EditorImpl);
export default Editor;
