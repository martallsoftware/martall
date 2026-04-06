import { useState, useRef, useEffect } from "react";

interface Props {
  onPrint: () => void;
  onEmail: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
}

export default function ShareMenu({ onPrint, onEmail, onExportHtml, onExportPdf }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-md transition-colors ${
          open
            ? "bg-accent/15 text-accent"
            : "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
        }`}
        title="Share & Export"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 8V13H12V8" />
          <path d="M8 2V10" />
          <path d="M5 5L8 2L11 5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-44 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#252538] shadow-xl">
          <button
            onClick={() => { onPrint(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="4" y="1" width="8" height="4" />
              <rect x="1" y="5" width="14" height="7" rx="1" />
              <rect x="4" y="10" width="8" height="5" />
              <circle cx="12" cy="8" r="0.5" fill="currentColor" />
            </svg>
            Print
          </button>
          <button
            onClick={() => { onEmail(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="14" height="10" rx="1.5" />
              <path d="M1 4.5L8 9L15 4.5" />
            </svg>
            Email
          </button>
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            onClick={() => { onExportPdf(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="1" width="12" height="14" rx="1.5" />
              <path d="M5 5h6M5 8h6M5 11h3" />
            </svg>
            Export PDF
          </button>
          <button
            onClick={() => { onExportHtml(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 1H2.5A1.5 1.5 0 001 2.5v11A1.5 1.5 0 002.5 15h11a1.5 1.5 0 001.5-1.5V11" />
              <path d="M9 1h6v6" />
              <path d="M15 1L7 9" />
            </svg>
            Export HTML
          </button>
        </div>
      )}
    </div>
  );
}
