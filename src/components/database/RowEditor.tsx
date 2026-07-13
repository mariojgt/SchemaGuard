import { Check, KeyRound, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GRADIENT } from "./constants";
import { isJsonColumnType, jsonValueError } from "./valueEditing";
import { ValueEditor } from "./ValueEditor";

interface RowEditorProps {
  tableName?: string | undefined;
  columns: string[];
  columnTypes?: string[] | undefined;
  pkColumns?: string[] | undefined;
  original: (string | null)[];
  onCancel: () => void;
  onSave: (next: (string | null)[]) => Promise<boolean>;
}

/** A roomy, validated editor for one database row. */
export function RowEditor({
  tableName,
  columns,
  columnTypes,
  pkColumns = [],
  original,
  onCancel,
  onSave,
}: RowEditorProps) {
  const [draft, setDraft] = useState<(string | null)[]>(() => [...original]);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const changedIndexes = useMemo(
    () => columns.map((_, index) => index).filter((index) => original[index] !== draft[index]),
    [columns, draft, original],
  );
  const changedCount = changedIndexes.length;
  const invalidJson = draft.some(
    (value, index) => isJsonColumnType(columnTypes?.[index]) && jsonValueError(value) !== null,
  );

  const submit = async () => {
    if (saving || changedCount === 0 || invalidJson) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const ok = await onSave(draft);
      if (ok) {
        onCancel();
        return;
      }
      setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    }
    setSaving(false);
  };

  useEffect(() => {
    const firstEditor = dialogRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input:not(:disabled), textarea:not(:disabled)",
    );
    firstEditor?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onCancel();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  const primaryKeySummary = pkColumns
    .map((column) => {
      const index = columns.indexOf(column);
      const value = index >= 0 ? original[index] : null;
      return `${column}=${value ?? "NULL"}`;
    })
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && changedCount === 0 && !saving) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="row-editor-title"
        className="glass-strong flex max-h-[88vh] w-[780px] max-w-full animate-pop flex-col overflow-hidden rounded-2xl border border-line/70 shadow-2xl"
      >
        <header className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-acc/15 text-acc">
            <Pencil size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="row-editor-title" className="text-[14px] font-bold text-ink">
              Edit row{tableName ? ` in ${tableName}` : ""}
            </h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10.5px] text-faint">
              <span>{columns.length} columns</span>
              {primaryKeySummary && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0 truncate font-mono" title={primaryKeySummary}>
                    {primaryKeySummary}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close row editor"
            disabled={saving}
            onClick={onCancel}
            className="grid h-8 w-8 flex-none place-items-center rounded-lg text-faint hover:bg-panel2 hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {saveFailed && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[11.5px] text-crit"
            >
              The row could not be saved. Review the error message and try again.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {columns.map((column, index) => {
              const changed = changedIndexes.includes(index);
              const primaryKey = pkColumns.includes(column);
              const json = isJsonColumnType(columnTypes?.[index]);
              return (
                <div
                  key={column}
                  className={`min-w-0 rounded-xl border p-3 transition-colors ${
                    json ? "md:col-span-2" : ""
                  } ${
                    changed
                      ? "border-acc/50 bg-acc/5 ring-1 ring-acc/10"
                      : "border-line bg-panel/60"
                  }`}
                >
                  <div className="mb-2 flex min-h-5 items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-[11.5px] font-semibold text-ink">
                      {column}
                    </span>
                    {columnTypes?.[index] && (
                      <span className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-faint">
                        {columnTypes[index]}
                      </span>
                    )}
                    {primaryKey && (
                      <span
                        title="Primary key"
                        className="inline-flex items-center gap-1 rounded bg-low/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-low"
                      >
                        <KeyRound size={9} /> Key
                      </span>
                    )}
                    {changed && (
                      <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider text-acc">
                        Changed
                      </span>
                    )}
                  </div>
                  <ValueEditor
                    value={draft[index] ?? null}
                    columnType={columnTypes?.[index]}
                    ariaLabel={column}
                    disabled={saving}
                    onChange={(value) => {
                      setSaveFailed(false);
                      setDraft((current) =>
                        current.map((cell, cellIndex) => (cellIndex === index ? value : cell)),
                      );
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-panel/70 px-5 py-3">
          <span
            className={`text-[11px] ${
              invalidJson ? "text-crit" : changedCount > 0 ? "text-acc" : "text-faint"
            }`}
          >
            {invalidJson
              ? "Fix invalid JSON before saving"
              : changedCount === 0
                ? "No changes yet"
                : `${String(changedCount)} ${changedCount === 1 ? "field" : "fields"} changed`}
          </span>
          {changedCount > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft([...original]);
                setSaveFailed(false);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-faint hover:bg-panel2 hover:text-ink disabled:opacity-40"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[10px] text-faint sm:inline">⌘/Ctrl+Enter to save</span>
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="press rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-line2 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              title="Save row"
              disabled={saving || changedCount === 0 || invalidJson}
              onClick={() => {
                void submit();
              }}
              className="press inline-flex min-w-[118px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              style={{ background: GRADIENT }}
            >
              <Check size={13} />
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
