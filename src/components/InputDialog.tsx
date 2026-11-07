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
  /** `answers` holds the template's `{{ask:Label}}` values, keyed by label. */
  onConfirm: (value: string, template?: string, answers?: Record<string, string>) => void;
  onCancel: () => void;
}

export default function InputDialog({
  title,
  placeholder,
  defaultValue = "",
  confirmLabel = "Create",
  withTemplates = false,
  onConfirm,
  onCancel,
}: Props) {
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

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed, template || undefined, template ? answers : undefined);
  };

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
