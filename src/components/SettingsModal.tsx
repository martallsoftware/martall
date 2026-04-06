import { useState } from "react";
import type { Settings } from "../types";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<Settings>({ ...settings });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Theme */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              Theme
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setLocal({ ...local, dark_theme: true })}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  local.dark_theme
                    ? "bg-accent text-white border-accent"
                    : "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setLocal({ ...local, dark_theme: false })}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  !local.dark_theme
                    ? "bg-accent text-white border-accent"
                    : "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                Light
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await onSave(local);
              onClose();
            }}
            className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
