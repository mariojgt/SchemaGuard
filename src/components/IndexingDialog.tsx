import type { IndexFinding } from "@schemaguard/core";
import { analyzeIndexing } from "@schemaguard/core";
import { Check, Copy, Database, ListTree, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useSchemaStore } from "../stores/schema";

const LEVEL: Record<IndexFinding["level"], { dot: string; label: string }> = {
  high: { dot: "#ff6b6b", label: "Fix now" },
  medium: { dot: "#f6c453", label: "Recommended" },
  low: { dot: "#6ea8fe", label: "Minor" },
};

function CopyChip({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[10.5px] hover:border-acc"
    >
      {copied ? <Check size={11} color="#3ecf8e" /> : <Copy size={11} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function IndexingDialog({ onClose }: { onClose: () => void }) {
  const schema = useSchemaStore((s) => s.schema);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const findings = useMemo(() => analyzeIndexing(schema), [schema]);
  const high = findings.filter((f) => f.level === "high").length;

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[84vh] w-[640px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <ListTree size={15} className="text-acc" />
          <span className="text-[14px] font-bold">Indexing advisor</span>
          <span className="ml-auto text-[12px] text-dim">
            {findings.length === 0
              ? "all clear"
              : `${String(findings.length)} finding${findings.length === 1 ? "" : "s"}${high > 0 ? ` · ${String(high)} to fix now` : ""}`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {schema.tables.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Database size={26} className="text-faint" />
              <p className="text-[13px] font-semibold">No tables yet</p>
              <p className="text-[12px] text-faint">
                Design or import a schema, then I&apos;ll check how it&apos;s indexed.
              </p>
            </div>
          )}
          {schema.tables.length > 0 && findings.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Check size={28} className="text-low" />
              <p className="text-[13px] font-semibold">Indexing looks healthy</p>
              <p className="max-w-[360px] text-[12px] text-faint">
                Every table has a primary key and every foreign key is indexed. Lookups, joins and
                cascading deletes will use an index instead of scanning whole tables.
              </p>
            </div>
          )}
          {findings.map((f) => (
            <div key={f.id} className="mb-2 rounded-lg border border-line bg-panel2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: LEVEL[f.level].dot }}
                  title={LEVEL[f.level].label}
                />
                <span className="text-[12.5px] font-semibold">{f.title}</span>
                <button
                  type="button"
                  onClick={() => {
                    selectTable(f.table);
                    onClose();
                  }}
                  className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[10px] text-dim hover:text-ink"
                >
                  {f.table}
                  {f.columns.length > 0 ? `.${f.columns.join(", ")}` : ""}
                </button>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-faint">
                  {LEVEL[f.level].label}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{f.explanation}</p>
              {f.fix && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-faint">Fix:</span>
                  <CopyChip label="Copy SQL" text={f.fix.sql} />
                  <CopyChip label="Copy Laravel" text={f.fix.laravel} />
                  <code className="ml-1 truncate font-mono text-[10.5px] text-faint">
                    {f.fix.laravel}
                  </code>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
