import { useCallback, useRef, useState } from "react";
import EmojiPicker from "./EmojiPicker";
import TableDialog from "./TableDialog";
import FlowchartDialog from "./FlowchartDialog";
import { cleanToMarkdown } from "../utils/cleanToMarkdown";

interface Props {
  content: string;
  onChange: (content: string) => void;
  notePath: string | null;
}

export default function Editor({ content, onChange, notePath }: Props) {
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    [content, onChange],
  );

  return (
    <div className="relative w-full h-full">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="editor-textarea w-full h-full p-5 pb-12 bg-transparent outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
        placeholder="Start writing..."
        spellCheck={false}
      />

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
