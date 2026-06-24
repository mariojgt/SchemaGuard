import { Database, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DbDialect } from "../../lib/db";
import { GRADIENT } from "./constants";

/** Name and create a new database on the connected server, then switch to it. */
export function CreateDatabaseDialog({
  dialect,
  creating,
  existing,
  onCancel,
  onCreate,
}: {
  dialect: DbDialect;
  creating: boolean;
  existing: string[];
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const duplicate = existing.some((d) => d.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !duplicate && !creating;
  const submit = () => {
    if (canCreate) onCreate(trimmed);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-strong flex w-[440px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-[18px] w-[18px] place-items-center rounded bg-acc/20 text-acc">
            <Database size={12} />
          </span>
          <span className="text-[14px] font-bold">Create database</span>
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="relative ml-auto grid place-items-center text-faint after:absolute after:inset-[-10px] hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-faint">
            Name
          </label>
          <input
            ref={inputRef}
            value={name}
            disabled={creating}
            placeholder="my_new_database"
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded-lg border border-line bg-panel2 px-2.5 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-acc disabled:opacity-50"
          />
          {duplicate ? (
            <p className="mt-2 text-[11px] text-med">
              A database named “{trimmed}” already exists.
            </p>
          ) : (
            <p className="mt-2 text-pretty text-[11px] text-faint">
              Creates an empty database on this {dialect === "mysql" ? "MySQL" : "PostgreSQL"}{" "}
              server and switches to it.
            </p>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="press rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canCreate}
            className="press inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow disabled:opacity-40"
            style={{ background: GRADIENT }}
          >
            <Plus size={13} />
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
