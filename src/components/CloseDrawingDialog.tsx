export type CloseDrawingChoice = "replace" | "append" | "close";

interface Props {
  drawingName: string;
  noteName: string;
  onChoose: (choice: CloseDrawingChoice) => void;
  onCancel: () => void;
}

/** Shown when closing a drawing made with "Edit as drawing" from a note's Mermaid block. */
export default function CloseDrawingDialog({ drawingName, noteName, onChoose, onCancel }: Props) {
  const btn =
    "w-full text-left px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:border-accent hover:bg-accent/5 transition-colors";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Update “{noteName}”?</h2>
          <p className="text-xs text-gray-500 mt-1">
            ✓ “{drawingName}” is saved. The note still shows the original Mermaid diagram.
          </p>
        </div>
        <div className="p-5 space-y-2 text-sm text-gray-800 dark:text-gray-200">
          <button autoFocus onClick={() => onChoose("replace")} className={btn}>
            <div className="font-medium">Replace Mermaid with drawing</div>
            <div className="text-xs text-gray-500">The Mermaid block becomes <code>![[{drawingName}]]</code></div>
          </button>
          <button onClick={() => onChoose("append")} className={btn}>
            <div className="font-medium">Add drawing below</div>
            <div className="text-xs text-gray-500">Keep the Mermaid block and show the drawing under it</div>
          </button>
          <button onClick={() => onChoose("close")} className={btn}>
            <div className="font-medium">Just close</div>
            <div className="text-xs text-gray-500">Leave the note as it is</div>
          </button>
        </div>
        <div className="flex justify-end px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Keep drawing open
          </button>
        </div>
      </div>
    </div>
  );
}
