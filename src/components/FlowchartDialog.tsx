import { useState, useRef, useEffect } from "react";

interface Props {
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

const TEMPLATES = [
  {
    name: "Basic Flow",
    preview: "A → B → C",
    code: `\`\`\`mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[End]
\`\`\``,
  },
  {
    name: "Decision",
    preview: "A → B? → C / D",
    code: `\`\`\`mermaid
graph TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Action A]
    B -->|No| D[Action B]
    C --> E[End]
    D --> E
\`\`\``,
  },
  {
    name: "Parallel",
    preview: "A → B & C → D",
    code: `\`\`\`mermaid
graph TD
    A[Start] --> B[Task 1]
    A --> C[Task 2]
    B --> D[Merge]
    C --> D
    D --> E[End]
\`\`\``,
  },
  {
    name: "Loop",
    preview: "A → B → C? → B",
    code: `\`\`\`mermaid
graph TD
    A[Start] --> B[Process]
    B --> C{Done?}
    C -->|No| B
    C -->|Yes| D[End]
\`\`\``,
  },
  {
    name: "Left to Right",
    preview: "A → B → C →",
    code: `\`\`\`mermaid
graph LR
    A[Input] --> B[Process]
    B --> C[Output]
\`\`\``,
  },
  {
    name: "Sequence Diagram",
    preview: "Alice → Bob → Alice",
    code: `\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob
    Bob-->>Alice: Hi Alice
    Alice->>Bob: How are you?
    Bob-->>Alice: I'm good!
\`\`\``,
  },
  {
    name: "Pie Chart",
    preview: "A: 40%, B: 35%, C: 25%",
    code: `\`\`\`mermaid
pie title Distribution
    "Category A" : 40
    "Category B" : 35
    "Category C" : 25
\`\`\``,
  },
  {
    name: "State Diagram",
    preview: "Idle → Active → Done",
    code: `\`\`\`mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Active: Start
    Active --> Done: Complete
    Active --> Idle: Cancel
    Done --> [*]
\`\`\``,
  },
];

export default function FlowchartDialog({ onInsert, onClose }: Props) {
  const [selected, setSelected] = useState(0);
  const [customCode, setCustomCode] = useState("");
  const [mode, setMode] = useState<"template" | "custom">("template");
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

  return (
    <div
      ref={ref}
      className="absolute bottom-10 right-0 z-50 w-[360px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl flex flex-col"
      style={{ maxHeight: "460px" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Insert Diagram</h3>
        <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            onClick={() => setMode("template")}
            className={`px-2 py-0.5 text-[10px] transition-colors ${
              mode === "template"
                ? "bg-accent text-white"
                : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => setMode("custom")}
            className={`px-2 py-0.5 text-[10px] transition-colors ${
              mode === "custom"
                ? "bg-accent text-white"
                : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {mode === "template" ? (
        <>
          {/* Template list */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((tmpl, i) => (
                <button
                  key={tmpl.name}
                  onClick={() => setSelected(i)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    selected === i
                      ? "border-accent bg-accent/10"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <p className="text-xs font-medium mb-1">{tmpl.name}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{tmpl.preview}</p>
                </button>
              ))}
            </div>
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
                onInsert("\n" + TEMPLATES[selected].code + "\n");
                onClose();
              }}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              Insert
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Custom mermaid editor */}
          <div className="flex-1 p-3">
            <p className="text-[10px] text-gray-400 mb-2">
              Write Mermaid syntax below:
            </p>
            <textarea
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              placeholder={`graph TD\n    A[Start] --> B[End]`}
              className="w-full h-40 p-2.5 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
              spellCheck={false}
            />
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
                if (customCode.trim()) {
                  onInsert("\n```mermaid\n" + customCode.trim() + "\n```\n");
                  onClose();
                }
              }}
              disabled={!customCode.trim()}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              Insert
            </button>
          </div>
        </>
      )}
    </div>
  );
}
