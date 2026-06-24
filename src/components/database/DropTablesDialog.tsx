import { AlertTriangle, GitCompare, ShieldOff, Table2, Trash2, X } from "lucide-react";
import { useState } from "react";

import type { DbDialect } from "../../lib/db";

/**
 * Confirm dropping several tables at once, with an opt-in to skip FK checks.
 *
 * The "guard" twist: tables that are part of the current canvas design are
 * flagged, because dropping one of those diverges the live database from the
 * design you're maintaining. When any are involved, the drop is gated behind an
 * explicit acknowledgement — routine cleanup (tables not in your design) drops
 * with no extra friction.
 */
export function DropTablesDialog({
  tables,
  designTables,
  dialect,
  dropping,
  onCancel,
  onDrop,
}: {
  tables: string[];
  /** Table names in the current canvas design (any case). */
  designTables: string[];
  dialect: DbDialect;
  dropping: boolean;
  onCancel: () => void;
  onDrop: (disableFk: boolean) => void;
}) {
  const [disableFk, setDisableFk] = useState(false);
  const [ack, setAck] = useState(false);

  const designSet = new Set(designTables.map((t) => t.toLowerCase()));
  const inDesign = new Set(tables.filter((t) => designSet.has(t.toLowerCase())));
  const guarded = inDesign.size > 0;
  const canDrop = !dropping && (!guarded || ack);

  const fkHint =
    dialect === "mysql"
      ? "Runs with FOREIGN_KEY_CHECKS = 0 so tables referenced by others still drop."
      : "Uses DROP TABLE … CASCADE, which also drops dependent foreign keys.";

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-[460px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-[18px] w-[18px] place-items-center rounded bg-crit/20 text-crit">
            <Trash2 size={12} />
          </span>
          <span className="text-[14px] font-bold">
            Drop {tables.length} table{tables.length === 1 ? "" : "s"}?
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="flex items-start gap-2 rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-[11.5px] text-crit">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>This permanently deletes the table(s) and all their data. It can't be undone.</span>
          </div>

          {guarded && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-acc/40 bg-acc/10 px-3 py-2 text-[11.5px] text-acc">
              <GitCompare size={14} className="mt-0.5 flex-none" />
              <span>
                <span className="font-semibold">
                  {inDesign.size} of these {inDesign.size === 1 ? "is" : "are"} in your design.
                </span>{" "}
                Dropping {inDesign.size === 1 ? "it" : "them"} diverges the live database from the
                schema you're maintaining on the canvas.
              </span>
            </div>
          )}

          <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-panel2 p-2">
            {tables.map((t) => (
              <div key={t} className="flex items-center gap-2 py-0.5 font-mono text-[12px]">
                <Table2 size={12} className="flex-none text-faint" />
                {t}
                {inDesign.has(t) && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded border border-acc/40 bg-acc/10 px-1.5 py-0.5 text-[10px] font-semibold not-italic text-acc">
                    <GitCompare size={10} /> in design
                  </span>
                )}
              </div>
            ))}
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={disableFk}
              disabled={dropping}
              onChange={(e) => {
                setDisableFk(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-med" />
                Drop without foreign-key checks
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">{fkHint}</span>
            </span>
          </label>

          {guarded && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-acc/30 bg-acc/5 px-3 py-2 text-[12px]">
              <input
                type="checkbox"
                checked={ack}
                disabled={dropping}
                onChange={(e) => {
                  setAck(e.target.checked);
                }}
                className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
              />
              <span className="font-medium text-ink">
                I understand {inDesign.size === 1 ? "this table is" : "these tables are"} part of my
                design and still want to drop {inDesign.size === 1 ? "it" : "them"}.
              </span>
            </label>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={dropping}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDrop(disableFk);
            }}
            disabled={!canDrop}
            className="inline-flex items-center gap-1.5 rounded-lg border border-crit/50 bg-crit/15 px-3 py-1.5 text-[12.5px] font-semibold text-crit hover:bg-crit/25 disabled:opacity-40"
          >
            <Trash2 size={13} />
            {dropping ? "Dropping…" : `Drop ${String(tables.length)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
