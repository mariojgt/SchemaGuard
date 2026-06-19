import type { RiskLevel } from "@schemaguard/core";
import { AlertTriangle, Pencil, Plus, ShieldCheck } from "lucide-react";

import { useSchemaStore } from "../stores/schema";

const RISK_STYLE: Record<RiskLevel, { color: string; label: string }> = {
  none: { color: "#3ecf8e", label: "safe" },
  low: { color: "#5ad1ff", label: "low" },
  medium: { color: "#f6c453", label: "medium" },
  high: { color: "#ff8a5b", label: "high" },
  critical: { color: "#ff6b6b", label: "critical" },
};

function riskOf(level: RiskLevel | undefined): RiskLevel {
  return level ?? "none";
}

export function MigrationTimeline() {
  const migrations = useSchemaStore((s) => s.migrations);
  const current = useSchemaStore((s) => s.currentMigration);
  const viewMigration = useSchemaStore((s) => s.viewMigration);

  const risky = migrations.filter((m) => {
    const lvl = riskOf(m.risk?.level);
    return lvl === "high" || lvl === "critical";
  }).length;

  return (
    <div className="h-full overflow-auto p-2">
      <div className="flex items-center gap-2 px-2 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">
          Migration timeline · {migrations.length}
        </span>
        {risky > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-crit/15 px-2 py-0.5 text-[10.5px] font-bold text-crit">
            <AlertTriangle size={11} />
            {risky} risky
          </span>
        ) : (
          migrations.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-low/15 px-2 py-0.5 text-[10.5px] font-bold text-low">
              <ShieldCheck size={11} />
              all safe
            </span>
          )
        )}
      </div>
      <div className="flex flex-col">
        {migrations.map((m, i) => {
          const isCurrent = i === current;
          const isFinal = i === migrations.length - 1;
          const level = riskOf(m.risk?.level);
          const rs = RISK_STYLE[level];
          const findings = m.risk?.findings ?? [];
          return (
            <button
              key={m.filename}
              type="button"
              onClick={() => {
                viewMigration(i);
              }}
              className={`mb-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                isCurrent ? "border-acc bg-acc/10" : "border-transparent hover:bg-panel2"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-faint">
                  {m.date || `#${String(i + 1)}`}
                </span>
                {isFinal && (
                  <span className="rounded bg-low/20 px-1.5 py-0.5 text-[9px] font-bold text-low">
                    FINAL
                  </span>
                )}
                {level !== "none" && (
                  <span
                    className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                    style={{ background: `${rs.color}22`, color: rs.color }}
                    title={`Migration risk: ${rs.label}`}
                  >
                    {rs.label} risk
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[12.5px] font-medium">{m.title}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {m.changes.map((c, j) => (
                  <span
                    key={j}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                      c.kind === "create" ? "bg-acc/15 text-acc" : "bg-med/15 text-med"
                    }`}
                  >
                    {c.kind === "create" ? <Plus size={10} /> : <Pencil size={10} />}
                    {c.table} · {c.detail}
                  </span>
                ))}
              </div>

              {/* Risk findings — shown for the migration being viewed. */}
              {isCurrent && findings.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-t border-line/60 pt-2">
                  {findings.map((f, k) => {
                    const fs = RISK_STYLE[f.level];
                    return (
                      <div key={k} className="flex items-start gap-1.5 text-[11px] leading-snug">
                        <span
                          className="mt-1 h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: fs.color }}
                        />
                        <span className="text-dim">{f.text}</span>
                      </div>
                    );
                  })}
                  {m.risk && (
                    <div className="mt-0.5 text-[10px] text-faint">
                      {m.risk.hasDown ? "✓ has down() — reversible" : "✗ no down() — not reversible"}
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
