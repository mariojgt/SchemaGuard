import { validate } from "@schemaguard/core";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useSchemaStore } from "../stores/schema";

export function CatalogDialog({ onClose }: { onClose: () => void }) {
  const schema = useSchemaStore((s) => s.schema);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const [query, setQuery] = useState("");

  const issues = useMemo(() => validate(schema), [schema]);

  const tables = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return schema.tables;
    return schema.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [schema, query]);

  const totals = useMemo(() => {
    let cols = 0;
    let fks = 0;
    for (const t of schema.tables) {
      cols += t.columns.length;
      fks += t.foreignKeys.length;
    }
    return { tables: schema.tables.length, cols, fks };
  }, [schema]);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[84vh] w-[760px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="text-[14px] font-bold">Catalog</span>
          <span className="text-[11px] text-faint">
            {totals.tables} tables · {totals.cols} columns · {totals.fks} relationships
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search tables and columns…"
          className="mx-4 mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] outline-none focus:border-acc"
        />

        {issues.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-line bg-panel2 p-2">
            <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-faint">
              {issues.length} validation issue{issues.length === 1 ? "" : "s"}
            </div>
            <div className="flex max-h-24 flex-col gap-1 overflow-auto">
              {issues.map((i, k) => (
                <div key={k} className="flex items-center gap-2 px-1 text-[11.5px]">
                  {i.severity === "error" ? (
                    <AlertCircle size={13} className="flex-none text-crit" />
                  ) : (
                    <AlertTriangle size={13} className="flex-none text-med" />
                  )}
                  <span className="text-dim">{i.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="m-4 min-h-0 flex-1 overflow-auto">
          {tables.length === 0 && <div className="text-[12px] text-faint">No matches.</div>}
          <div className="flex flex-col gap-2">
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  selectTable(t.name);
                  onClose();
                }}
                className="rounded-lg border border-line bg-panel2 p-3 text-left hover:border-line2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">{t.name}</span>
                  <span className="text-[10.5px] text-faint">{t.columns.length} cols</span>
                  {t.foreignKeys.length > 0 && (
                    <span className="rounded bg-acc2/15 px-1.5 text-[10px] text-[#f3a6ff]">
                      {t.foreignKeys.length} FK
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {t.columns.map((c) => {
                    const isPk = (t.primaryKey ?? []).includes(c.name);
                    const isFk = t.foreignKeys.some((fk) => fk.columns.includes(c.name));
                    return (
                      <span
                        key={c.name}
                        className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[10.5px] text-dim"
                      >
                        {c.name}
                        {isPk && <span className="ml-1 text-acc">PK</span>}
                        {isFk && <span className="ml-1 text-[#f3a6ff]">FK</span>}
                      </span>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
