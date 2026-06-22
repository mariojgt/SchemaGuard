import type { ChangeSeverity, Schema, TableDiff } from "@schemaguard/core";
import { diffSchemas } from "@schemaguard/core";
import { AlertTriangle, ArrowRight, Check, GitCompare, Minus, Pencil, Plus, X } from "lucide-react";
import { useMemo } from "react";

const SEV: Record<ChangeSeverity, { text: string; dot: string; label: string }> = {
  safe: { text: "text-low", dot: "bg-low", label: "Safe" },
  caution: { text: "text-high", dot: "bg-high", label: "Caution" },
  destructive: { text: "text-crit", dot: "bg-crit", label: "Destructive" },
};

const STATUS: Record<TableDiff["status"], { verb: string; icon: React.ReactNode }> = {
  added: { verb: "New table", icon: <Plus size={13} className="text-low" /> },
  removed: { verb: "Drop table", icon: <Minus size={13} className="text-crit" /> },
  modified: { verb: "Alter table", icon: <Pencil size={13} className="text-high" /> },
};

/**
 * The "guard" view: shows the structural delta between the live database
 * (`before`) and the design on the canvas (`after`) — what it would take to
 * migrate the database into the design — with destructive operations flagged.
 */
export function DiffDialog({
  before,
  after,
  liveName,
  onClose,
}: {
  before: Schema;
  after: Schema;
  liveName: string;
  onClose: () => void;
}) {
  const diff = useMemo(() => diffSchemas(before, after), [before, after]);
  const { summary } = diff;

  const counts = [
    summary.tablesAdded > 0 && `+${String(summary.tablesAdded)} table`,
    summary.tablesRemoved > 0 && `-${String(summary.tablesRemoved)} table`,
    summary.tablesModified > 0 && `${String(summary.tablesModified)} altered`,
    summary.columnsAdded > 0 && `+${String(summary.columnsAdded)} col`,
    summary.columnsRemoved > 0 && `-${String(summary.columnsRemoved)} col`,
    summary.columnsModified > 0 && `${String(summary.columnsModified)} col changed`,
  ].filter(Boolean) as string[];

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[82vh] w-[680px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <GitCompare size={15} className="text-acc" />
          <span className="text-[14px] font-bold">Design vs live database</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-[12px] text-dim">
          <span className="font-mono text-[11px] text-faint">{liveName}</span>
          <ArrowRight size={12} className="text-faint" />
          <span className="font-mono text-[11px] text-faint">your design</span>
          {counts.length > 0 && <span className="text-faint">·</span>}
          <span>{counts.join(" · ")}</span>
          {summary.destructive > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-crit/40 bg-crit/10 px-2 py-1 text-[11.5px] font-semibold text-crit">
              <AlertTriangle size={12} />
              {summary.destructive} destructive change{summary.destructive === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {diff.identical ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Check size={28} className="text-low" />
              <p className="text-[13px] font-semibold">In sync</p>
              <p className="text-[12px] text-faint">
                Your design matches the live database — no structural changes.
              </p>
            </div>
          ) : (
            diff.tables.map((t) => <TableRow key={`${t.status}:${t.name}`} table={t} />)
          )}
        </div>

        <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
          Compares tables and columns. Index and foreign-key drift aren&apos;t shown yet.
        </div>
      </div>
    </div>
  );
}

function TableRow({ table }: { table: TableDiff }) {
  const status = STATUS[table.status];
  const sev = SEV[table.severity];
  return (
    <div className="mb-1.5 rounded-lg border border-line bg-panel2 px-3 py-2">
      <div className="flex items-center gap-2">
        {status.icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          {status.verb}
        </span>
        <span className="font-mono text-[12.5px] font-semibold text-ink">{table.name}</span>
        <span className={`ml-auto inline-flex items-center gap-1.5 text-[11px] ${sev.text}`}>
          <span className={`h-2 w-2 rounded-full ${sev.dot}`} />
          {sev.label}
        </span>
      </div>
      <p className="mt-0.5 pl-[21px] text-[11.5px] text-dim">{table.detail}</p>

      {table.columns.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 pl-[21px]">
          {table.columns.map((c) => (
            <div key={c.name} className="flex items-start gap-2 text-[11.5px]">
              <span className={`mt-1 h-1.5 w-1.5 flex-none rounded-full ${SEV[c.severity].dot}`} />
              <span className="font-mono text-dim">{c.name}</span>
              <span className="text-faint">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
