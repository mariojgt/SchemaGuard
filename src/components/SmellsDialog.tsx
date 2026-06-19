import type { Smell } from "@schemaguard/core";
import { detectSmells, healthScore } from "@schemaguard/core";
import { Check, Sparkles, Wrench, X } from "lucide-react";
import { useMemo } from "react";

import { useSchemaStore } from "../stores/schema";

function scoreColor(score: number): string {
  if (score >= 85) return "#3ecf8e";
  if (score >= 60) return "#f6c453";
  return "#ff6b6b";
}

export function SmellsDialog({ onClose }: { onClose: () => void }) {
  const schema = useSchemaStore((s) => s.schema);
  const applyFix = useSchemaStore((s) => s.applyFix);
  const selectTable = useSchemaStore((s) => s.selectTable);

  const smells = useMemo(() => detectSmells(schema), [schema]);
  const score = useMemo(() => healthScore(smells), [smells]);
  const warns = smells.filter((s) => s.severity === "warn");
  const infos = smells.filter((s) => s.severity === "info");

  const fixAll = () => {
    // Re-detect after each fix so ids stay valid; fixable smells only.
    for (const s of detectSmells(schema)) if (s.fix) applyFix(s.fix);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[82vh] w-[620px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Sparkles size={15} className="text-acc" />
          <span className="text-[14px] font-bold">Schema health</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-extrabold" style={{ color: scoreColor(score) }}>
                {score}
              </span>
              <span className="text-[11px] text-faint">/ 100</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid place-items-center text-faint hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12px] text-dim">
          <span>
            {warns.length} warning{warns.length === 1 ? "" : "s"} · {infos.length} suggestion
            {infos.length === 1 ? "" : "s"}
          </span>
          {smells.some((s) => s.fix) && (
            <button
              type="button"
              aria-label="Fix all"
              onClick={fixAll}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-acc/40 bg-acc/10 px-2.5 py-1 text-[11.5px] font-semibold text-acc hover:border-acc"
            >
              <Wrench size={12} />
              Fix all
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {smells.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Check size={28} className="text-low" />
              <p className="text-[13px] font-semibold">No design smells found</p>
              <p className="text-[12px] text-faint">This schema looks clean. Nice.</p>
            </div>
          )}
          {[...warns, ...infos].map((s) => (
            <SmellRow
              key={s.id}
              smell={s}
              onFix={() => {
                if (s.fix) applyFix(s.fix);
              }}
              onGo={() => {
                selectTable(s.table);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SmellRow({
  smell,
  onFix,
  onGo,
}: {
  smell: Smell;
  onFix: () => void;
  onGo: () => void;
}) {
  const warn = smell.severity === "warn";
  return (
    <div className="mb-1.5 flex items-start gap-3 rounded-lg border border-line bg-panel2 px-3 py-2">
      <span
        className={`mt-0.5 h-2 w-2 flex-none rounded-full ${warn ? "bg-med" : "bg-acc2"}`}
        title={warn ? "Warning" : "Suggestion"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold">{smell.title}</span>
          <button
            type="button"
            onClick={onGo}
            className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[10px] text-dim hover:text-ink"
          >
            {smell.table}
            {smell.column ? `.${smell.column}` : ""}
          </button>
        </div>
        <p className="mt-0.5 text-[11.5px] text-dim">{smell.detail}</p>
      </div>
      {smell.fix && (
        <button
          type="button"
          onClick={onFix}
          className="flex-none inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] hover:border-acc"
        >
          <Wrench size={11} />
          Fix
        </button>
      )}
    </div>
  );
}
