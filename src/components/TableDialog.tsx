import { useState, useEffect, useRef } from "react";

interface Props {
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

export default function TableDialog({ onInsert, onClose }: Props) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [hasHeader, setHasHeader] = useState(true);
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const generateTable = () => {
    const lines: string[] = [];

    if (hasHeader) {
      // Header row
      const headerCells = Array.from({ length: cols }, (_, i) => ` Header ${i + 1} `);
      lines.push(`|${headerCells.join("|")}|`);
      // Separator
      const sep = Array.from({ length: cols }, () => " --- ");
      lines.push(`|${sep.join("|")}|`);
      // Data rows
      for (let r = 0; r < rows - 1; r++) {
        const cells = Array.from({ length: cols }, () => "     ");
        lines.push(`|${cells.join("|")}|`);
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const cells = Array.from({ length: cols }, () => "     ");
        lines.push(`|${cells.join("|")}|`);
        if (r === 0) {
          const sep = Array.from({ length: cols }, () => " --- ");
          lines.push(`|${sep.join("|")}|`);
        }
      }
    }

    return "\n" + lines.join("\n") + "\n";
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-10 right-0 z-50 w-[280px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold">Insert Table</h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Visual grid selector */}
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Select size: {hoverCol >= 0 ? `${hoverCol + 1} x ${hoverRow + 1}` : `${cols} x ${rows}`}
          </p>
          <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(6, 1fr)` }}>
            {Array.from({ length: 6 }).map((_, r) =>
              Array.from({ length: 6 }).map((_, c) => (
                <button
                  key={`${r}-${c}`}
                  className={`w-6 h-6 rounded-sm border transition-colors ${
                    (hoverRow >= 0 ? r <= hoverRow && c <= hoverCol : r < rows && c < cols)
                      ? "bg-accent/30 border-accent/50"
                      : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
                  }`}
                  onMouseEnter={() => {
                    setHoverRow(r);
                    setHoverCol(c);
                  }}
                  onMouseLeave={() => {
                    setHoverRow(-1);
                    setHoverCol(-1);
                  }}
                  onClick={() => {
                    setRows(r + 1);
                    setCols(c + 1);
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* Manual input */}
        <div className="flex gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Columns</label>
            <input
              type="number"
              min={1}
              max={10}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
              className="w-16 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Rows</label>
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className="w-16 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
        </div>

        {/* Header toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.target.checked)}
            className="rounded accent-accent"
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">Include header row</span>
        </label>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onInsert(generateTable());
            onClose();
          }}
          className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          Insert
        </button>
      </div>
    </div>
  );
}
