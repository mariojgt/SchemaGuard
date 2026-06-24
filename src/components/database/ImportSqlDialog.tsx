import { AlertTriangle, FileText, Loader2, ShieldOff, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import type { DbDialect } from "../../lib/db";
import { dbDropTables, dbImportBegin, dbImportExec, dbImportFinish, dbTables } from "../../lib/db";
import { extractStatements, flushStatements } from "../../lib/sqlSplit";
import { toast } from "../../stores/toasts";
import { GRADIENT } from "./constants";

// Read this many bytes per slice. The whole file is never held in memory — we
// stream slices, split off complete statements, and send them in batches.
const IMPORT_CHUNK = 4 * 1024 * 1024;
const IMPORT_BATCH = 400;

// Per-dialect session statements to suspend / restore foreign-key enforcement
// for the duration of an import (mysqldump-style), so dumps restore regardless
// of statement order. Postgres uses session_replication_role (needs elevated
// rights — applied best-effort).
const FK_OFF: Record<DbDialect, string> = {
  mysql: "SET FOREIGN_KEY_CHECKS=0",
  postgres: "SET session_replication_role = replica",
};
const FK_ON: Record<DbDialect, string> = {
  mysql: "SET FOREIGN_KEY_CHECKS=1",
  postgres: "SET session_replication_role = origin",
};

/**
 * phpMyAdmin-style import: pick a .sql file and run it against the database.
 * The file is streamed in chunks so dumps of any size import without loading
 * the whole script into memory or sending it across the bridge at once.
 */
export function ImportSqlDialog({
  connId,
  database,
  dialect,
  tableCount,
  onClose,
  onDone,
}: {
  connId: string;
  database: string;
  dialect: DbDialect;
  tableCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // Opt-in: wipe the database before importing so a full dump restores cleanly
  // (avoids "table already exists" / 1050 on re-import).
  const [emptyFirst, setEmptyFirst] = useState(false);
  const [emptying, setEmptying] = useState(false);
  // On by default: disable FK checks for the import session so a full dump
  // restores regardless of table/row order (avoids 1452). Re-enabled at the end.
  const [disableFk, setDisableFk] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setProgress(0);
    let importId: string | null = null;
    try {
      // Drop every existing table first when requested. FK checks are disabled
      // so tables referenced by others still drop; this runs before the import
      // session opens, and DDL auto-commits, so the import sees a clean schema.
      if (emptyFirst) {
        setEmptying(true);
        const existing = await dbTables(connId);
        if (existing.length > 0) await dbDropTables(connId, existing, true);
        setEmptying(false);
      }
      importId = await dbImportBegin(connId);
      // Turn off FK enforcement for this one import connection so a full dump
      // restores regardless of statement/row order. Best-effort: on Postgres
      // this needs elevated rights, so a failure just leaves checks on.
      if (disableFk) {
        await dbImportExec(importId, [FK_OFF[dialect]]).catch(() => undefined);
      }
      let offset = 0;
      let buffer = "";
      let totalRows = 0;
      let pending: string[] = [];
      const flush = async () => {
        if (pending.length === 0) return;
        totalRows += await dbImportExec(importId as string, pending);
        pending = [];
      };
      while (offset < file.size) {
        const text = await file.slice(offset, offset + IMPORT_CHUNK).text();
        offset += IMPORT_CHUNK;
        buffer += text;
        const { statements, rest } = extractStatements(buffer);
        buffer = rest;
        for (const s of statements) {
          pending.push(s);
          if (pending.length >= IMPORT_BATCH) await flush();
        }
        await flush();
        setProgress(Math.min(100, Math.round((offset / file.size) * 100)));
      }
      // Emit any final statement that lacked a trailing semicolon.
      for (const s of flushStatements(buffer)) pending.push(s);
      await flush();

      toast.success(`Imported “${file.name}” · ${String(totalRows)} row(s) affected.`);
      onDone();
      onClose();
    } catch (e: unknown) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (importId) {
        // Restore FK enforcement before the connection returns to the pool so
        // the disabled setting never leaks into later queries. (Re-enabling
        // doesn't re-validate the rows just imported, so it can't error.)
        if (disableFk) await dbImportExec(importId, [FK_ON[dialect]]).catch(() => undefined);
        await dbImportFinish(importId).catch(() => undefined);
      }
      setEmptying(false);
      setRunning(false);
    }
  };

  const sizeLabel = (n: number): string =>
    n < 1024
      ? `${String(n)} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        className="glass-strong flex w-[460px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span
            className="grid h-[18px] w-[18px] place-items-center rounded text-white"
            style={{ background: GRADIENT }}
          >
            <Upload size={11} />
          </span>
          <span className="text-[14px] font-bold">Import SQL</span>
          <span className="font-mono text-[11px] text-faint">→ {database}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="relative ml-auto grid place-items-center text-faint after:absolute after:inset-[-10px] hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <input
            ref={inputRef}
            type="file"
            accept=".sql,.txt,application/sql,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={running}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 bg-panel2 px-3 py-3 text-left hover:border-acc/60 disabled:opacity-50"
          >
            <FileText size={16} className="flex-none text-acc" />
            {file ? (
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold">{file.name}</span>
                <span className="text-[11px] text-faint">
                  {sizeLabel(file.size)} · click to change
                </span>
              </span>
            ) : (
              <span className="text-[12.5px] text-dim">Choose a .sql file…</span>
            )}
          </button>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span className="text-pretty">
              Statements run directly against <span className="font-semibold">{database}</span>. This
              can create, modify, or overwrite data and isn&apos;t undoable.
            </span>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={emptyFirst}
              disabled={running}
              onChange={(e) => {
                setEmptyFirst(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-high" />
                Drop existing tables first
              </span>
              <span className="mt-0.5 block text-pretty text-[11px] text-faint">
                {tableCount > 0
                  ? `Permanently deletes all ${String(tableCount)} table${tableCount === 1 ? "" : "s"} in ${database} before importing, so a full dump restores without "already exists" errors.`
                  : `${database} is already empty — the dump will import as-is.`}
              </span>
            </span>
          </label>

          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={disableFk}
              disabled={running}
              onChange={(e) => {
                setDisableFk(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-med" />
                Disable foreign-key checks during import
              </span>
              <span className="mt-0.5 block text-pretty text-[11px] text-faint">
                Recommended for full dumps — lets tables and rows load in any order without
                constraint errors (1452). Re-enabled automatically when the import finishes.
              </span>
            </span>
          </label>

          {running && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
                <span>{emptying ? "Emptying database…" : "Streaming & importing…"}</span>
                <span className="font-mono tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full rounded-full bg-acc transition-[width]"
                  style={{ width: `${String(progress)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="press rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void run();
            }}
            disabled={!file || running}
            className="press inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow disabled:opacity-40 disabled:shadow-none"
            style={{ background: GRADIENT }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {emptying ? "Emptying…" : running ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
