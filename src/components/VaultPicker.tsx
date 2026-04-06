import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Vault } from "../types";
import InputDialog from "./InputDialog";

interface Props {
  vaults: Vault[];
  activeVault: string;
  onSwitch: () => void;
}

export default function VaultPicker({ vaults, activeVault, onSwitch }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [addStep, setAddStep] = useState<"name" | "path">("name");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = useCallback(
    async (path: string) => {
      if (path === activeVault) return;
      try {
        await invoke("switch_vault", { path });
        onSwitch();
      } catch (err) {
        console.error("Failed to switch vault:", err);
      }
    },
    [activeVault, onSwitch],
  );

  const handleRemove = useCallback(
    async (path: string) => {
      try {
        await invoke("remove_vault", { path });
        onSwitch(); // Refresh settings
      } catch (err) {
        setError(String(err));
        setTimeout(() => setError(null), 3000);
      }
    },
    [onSwitch],
  );

  const handleAddVault = useCallback(
    async (path: string) => {
      try {
        await invoke("add_vault", { name: newName, path });
        setShowAdd(false);
        setAddStep("name");
        setNewName("");
        await invoke("switch_vault", { path });
        onSwitch();
      } catch (err) {
        setError(String(err));
        setTimeout(() => setError(null), 3000);
      }
    },
    [newName, onSwitch],
  );

  const handleOpenExisting = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select existing vault folder",
      });
      if (!selected || typeof selected !== "string") return;

      // Derive name from folder name
      const folderName = selected.split(/[/\\]/).pop() || "Vault";

      await invoke("add_vault", { name: folderName, path: selected });
      await invoke("switch_vault", { path: selected });
      onSwitch();
    } catch (err) {
      setError(String(err));
      setTimeout(() => setError(null), 3000);
    }
  }, [onSwitch]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Vaults
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenExisting}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
            title="Open existing vault"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h5l1.5 2H14v7H2V4z" />
              <path d="M2 7h12" />
            </svg>
          </button>
          <button
            onClick={() => {
              setShowAdd(true);
              setAddStep("name");
            }}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
            title="Create new vault"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-2 mt-2 px-2 py-1.5 text-[10px] text-red-400 bg-red-500/10 rounded-md">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {vaults.map((vault) => {
          const isActive = vault.path === activeVault;
          return (
            <div
              key={vault.path}
              className={`flex items-center gap-2 mx-1 px-2 py-2 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? "bg-accent/15 text-accent"
                  : "hover:bg-gray-200/60 dark:hover:bg-gray-700/40"
              }`}
              onClick={() => handleSwitch(vault.path)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0"
              >
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M5 5h6M5 8h6M5 11h3" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{vault.name}</p>
                <p className="text-[10px] text-gray-400 truncate">
                  {vault.path}
                </p>
              </div>
              {isActive && (
                <span className="text-[9px] text-accent font-medium flex-shrink-0">
                  ACTIVE
                </span>
              )}
              {!isActive && vaults.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(vault.path);
                  }}
                  className="p-0.5 rounded text-gray-400 hover:text-red-400 transition-colors flex-shrink-0"
                  title="Remove vault"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add vault - step 1: name */}
      {showAdd && addStep === "name" && (
        <InputDialog
          title="New Vault - Name"
          placeholder="e.g. Work, Personal, Dropbox"
          confirmLabel="Next"
          onConfirm={(name) => {
            setNewName(name);
            setAddStep("path");
          }}
          onCancel={() => {
            setShowAdd(false);
            setNewName("");
          }}
        />
      )}

      {/* Add vault - step 2: path with browse */}
      {showAdd && addStep === "path" && (
        <VaultPathDialog
          vaultName={newName}
          onConfirm={(path) => handleAddVault(path)}
          onCancel={() => {
            setShowAdd(false);
            setAddStep("name");
            setNewName("");
          }}
        />
      )}
    </div>
  );
}

function VaultPathDialog({
  vaultName,
  onConfirm,
  onCancel,
}: {
  vaultName: string;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: `Select folder for "${vaultName}" vault`,
      });
      if (selected && typeof selected === "string") {
        setPath(selected);
      }
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold">Vault "{vaultName}" - Location</h2>
        </div>
        <div className="p-5">
          <label className="text-xs text-gray-500 block mb-2">
            Choose where to store this vault
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && path.trim()) onConfirm(path.trim());
                if (e.key === "Escape") onCancel();
              }}
              placeholder="/path/to/folder"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <button
              onClick={handleBrowse}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h5l1.5 2H14v7H2V4z" />
              </svg>
              Browse
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (path.trim()) onConfirm(path.trim()); }}
            disabled={!path.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Vault
          </button>
        </div>
      </div>
    </div>
  );
}
