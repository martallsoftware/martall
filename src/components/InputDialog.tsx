import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DRAWING_TEMPLATE } from "../utils/drawing";

interface Props {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Show a template picker (files in the vault's `Templates/` folder). */
  withTemplates?: boolean;
  /**
   * `answers` holds the template's `{{ask:Label}}` values, keyed by label.
   * If it rejects (e.g. the note already exists) the dialog stays open and says why.
   */
  onConfirm: (value: string, template?: string, answers?: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
  /** Shown as "Open it" when a note with the typed name already exists. */
  onOpenExisting?: (value: string, template?: string) => void;
}

/** "Plan" → "Plan 2", "Plan 2" → "Plan 3"; a year like "Sprint 2026" is not a counter. */
function nextName(name: string): string {
  const m = name.match(/^(.*?)\s+(\d{1,3})$/);
  return m ? `${m[1]} ${Number(m[2]) + 1}` : `${name} 2`;
}

export default function InputDialog({
  title,
  placeholder,
  defaultValue = "",
  confirmLabel = "Create",
  withTemplates = false,
  onConfirm,
  onCancel,
  onOpenExisting,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  /** The name that clashed with an existing note. */
  const [exists, setExists] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [templates, setTemplates] = useState<string[]>([]);
  const [template, setTemplate] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!withTemplates) return;
    invoke<string[]>("list_templates")
      .then(setTemplates)
      .catch((err) => console.error("Failed to list templates:", err));
  }, [withTemplates]);

  useEffect(() => {
    setQuestions([]);
    setAnswers({});
    if (!template || template === DRAWING_TEMPLATE) return;
    let cancelled = false;
    invoke<string[]>("template_questions", { name: template })
      .then((q) => { if (!cancelled) setQuestions(q); })
      .catch((err) => console.error("Failed to read template:", err));
    return () => { cancelled = true; };
  }, [template]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setExists(null);
    try {
      await onConfirm(trimmed, template || undefined, template ? answers : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg)) {
        setValue(trimmed);
        setExists(trimmed);
      } else {
        setError(msg);
      }
    }
    setBusy(false);
  };
  const handleSubmit = () => submit(value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[360px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <div className="p-5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onCancel();
            }}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          {withTemplates && (
            <label className="block mt-3 text-xs text-gray-500 dark:text-gray-400">
              Template
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                  if (e.key === "Escape") onCancel();
                }}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="">Blank</option>
                <option value={DRAWING_TEMPLATE}>✏️ Excalidraw drawing</option>
                {templates.some((t) => !t.endsWith(".mmd")) && (
                  <optgroup label="Templates">
                    {templates.filter((t) => !t.endsWith(".mmd")).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                )}
                {templates.some((t) => t.endsWith(".mmd")) && (
                  <optgroup label="Mermaid (.mmd)">
                    {templates.filter((t) => t.endsWith(".mmd")).map((t) => (
                      <option key={t} value={t}>
                        ⇄ {t.replace(/\.mmd$/, "")}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          {questions.map((q) => (
            <label key={q} className="block mt-3 text-xs text-gray-500 dark:text-gray-400">
              {q}
              <input
                type="text"
                value={answers[q] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                  if (e.key === "Escape") onCancel();
                }}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </label>
          ))}
        </div>
        {exists && (
          <div className="mx-5 mb-4 -mt-1 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <p>A note called “{exists}” already exists in this folder.</p>
            <div className="mt-2 flex gap-2">
              {onOpenExisting && (
                <button
                  onClick={() => onOpenExisting(exists, template || undefined)}
                  className="px-2.5 py-1 rounded-md border border-amber-500/50 hover:bg-amber-500/10"
                >
                  Open it
                </button>
              )}
              <button
                onClick={() => submit(nextName(exists))}
                className="px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90"
              >
                Create “{nextName(exists)}”
              </button>
            </div>
          </div>
        )}
        {error && <p className="mx-5 mb-4 -mt-1 text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
