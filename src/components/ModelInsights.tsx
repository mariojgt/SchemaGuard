import type { CanonicalType, ModelRelation } from "@schemaguard/core";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Box, History, Lightbulb, Plus, X } from "lucide-react";
import { useMemo } from "react";

import { detectDrift, tableHistory } from "../lib/importInsights";
import { buildInsights, describeRelation } from "../lib/modelInsights";
import { RELATION_STYLE } from "../lib/relationStyle";
import { useSchemaStore } from "../stores/schema";

function typeLabel(t: CanonicalType): string {
  switch (t.kind) {
    case "serial":
    case "int":
      return t.size === "big" ? "bigint" : t.size === "small" || t.size === "tiny" ? "smallint" : "int";
    case "string":
      return `varchar(${String(t.length)})`;
    case "decimal":
      return `decimal(${String(t.precision)},${String(t.scale)})`;
    default:
      return t.kind;
  }
}

const TONE: Record<string, string> = {
  good: "border-low/40 bg-low/10 text-low",
  info: "border-acc2/40 bg-acc2/10 text-acc2",
  warn: "border-med/40 bg-med/10 text-med",
};

export function ModelInsights({
  tableName,
  onClose,
  onNavigate,
}: {
  tableName: string;
  onClose: () => void;
  onNavigate: (table: string) => void;
}) {
  const schema = useSchemaStore((s) => s.schema);
  const modelInfos = useSchemaStore((s) => s.modelInfos);
  const modelRelations = useSchemaStore((s) => s.modelRelations);
  const migrations = useSchemaStore((s) => s.migrations);

  const table = useMemo(
    () => schema.tables.find((t) => t.name === tableName),
    [schema, tableName],
  );
  const info = useMemo(
    () => modelInfos.find((m) => m.table === tableName),
    [modelInfos, tableName],
  );
  const outgoing = useMemo(
    () => modelRelations.filter((r) => r.table === tableName),
    [modelRelations, tableName],
  );
  const incoming = useMemo(
    () => modelRelations.filter((r) => r.relatedTable === tableName),
    [modelRelations, tableName],
  );
  const insights = useMemo(
    () => buildInsights({ table, info, outgoing, incoming, schema }),
    [table, info, outgoing, incoming, schema],
  );
  const drift = useMemo(
    () => detectDrift(schema, modelInfos, modelRelations).filter((d) => d.table === tableName),
    [schema, modelInfos, modelRelations, tableName],
  );
  const history = useMemo(() => tableHistory(migrations, tableName), [migrations, tableName]);

  const title = info?.model ?? tableName;
  const fkCols = useMemo(
    () => new Set((table?.foreignKeys ?? []).flatMap((fk) => fk.columns)),
    [table],
  );
  const pkCols = useMemo(() => new Set(table?.primaryKey ?? []), [table]);
  const fillable = useMemo(() => new Set(info?.fillable ?? []), [info]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-[18px] w-[18px] place-items-center rounded bg-acc text-[#190a14]">
          <Box size={12} strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-bold">{title}</span>
          <span className="block font-mono text-[10px] text-faint">{tableName}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="grid place-items-center text-faint hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* Insights */}
        {insights.length > 0 && (
          <Section icon={<Lightbulb size={12} />} title="Insights">
            <div className="flex flex-col gap-1.5">
              {insights.map((ins, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${TONE[ins.tone] ?? TONE.info}`}
                >
                  {ins.text}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Schema ⇄ model drift */}
        {drift.length > 0 && (
          <Section icon={<AlertTriangle size={12} />} title={`Drift · ${String(drift.length)}`}>
            <div className="flex flex-col gap-1.5">
              {drift.map((d, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${TONE[d.tone] ?? TONE.warn}`}
                >
                  {d.text}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Relationships */}
        <Section icon={<ArrowLeftRight size={12} />} title={`Relationships · ${String(outgoing.length + incoming.length)}`}>
          {outgoing.length === 0 && incoming.length === 0 && (
            <p className="text-[11.5px] text-faint">No relationships found.</p>
          )}
          {outgoing.map((r, i) => (
            <RelationRow key={`o-${String(i)}`} r={r} dir="out" onNavigate={onNavigate} />
          ))}
          {incoming.map((r, i) => (
            <RelationRow key={`i-${String(i)}`} r={r} dir="in" onNavigate={onNavigate} />
          ))}
        </Section>

        {/* Columns */}
        {table && (
          <Section icon={<Box size={12} />} title={`Columns · ${String(table.columns.length)}`}>
            <div className="flex flex-col">
              {table.columns.map((c) => {
                const cast = info?.casts[c.name];
                return (
                  <div
                    key={c.name}
                    className="flex items-center gap-2 border-b border-line/40 py-1 text-[11.5px] last:border-0"
                  >
                    {pkCols.has(c.name) ? (
                      <span className="flex-none rounded bg-acc/20 px-1 py-0.5 text-[8.5px] font-bold text-acc">
                        PK
                      </span>
                    ) : fkCols.has(c.name) ? (
                      <span className="flex-none rounded bg-acc2/20 px-1 py-0.5 text-[8.5px] font-bold text-acc2">
                        FK
                      </span>
                    ) : (
                      <span className="h-1.5 w-1.5 flex-none rounded-full bg-faint/50" />
                    )}
                    <span className={fillable.has(c.name) ? "font-semibold" : ""}>{c.name}</span>
                    {fillable.has(c.name) && (
                      <span
                        title="Mass-assignable ($fillable)"
                        className="flex-none rounded bg-low/15 px-1 text-[8.5px] text-low"
                      >
                        fillable
                      </span>
                    )}
                    <span className="ml-auto flex-none font-mono text-[10px] text-faint">
                      {cast ? `${typeLabel(c.type)} · ${cast}` : typeLabel(c.type)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Model properties */}
        {info && (
          <Section icon={<Box size={12} />} title="Model properties">
            <dl className="flex flex-col gap-1 text-[11.5px]">
              <Prop k="Table" v={info.table} />
              <Prop k="Primary key" v={info.primaryKey ?? "id"} />
              <Prop k="Timestamps" v={info.timestamps ? "yes" : "no"} />
              <Prop k="Soft deletes" v={info.softDeletes ? "yes" : "no"} />
              {info.fillable.length > 0 && <Prop k="Fillable" v={info.fillable.join(", ")} />}
              {info.guarded.length > 0 && <Prop k="Guarded" v={info.guarded.join(", ")} />}
              {info.hidden.length > 0 && <Prop k="Hidden" v={info.hidden.join(", ")} />}
              {Object.keys(info.casts).length > 0 && (
                <Prop
                  k="Casts"
                  v={Object.entries(info.casts)
                    .map(([a, b]) => `${a}: ${b}`)
                    .join(", ")}
                />
              )}
            </dl>
          </Section>
        )}

        {/* Migration history for this table */}
        {history.length > 0 && (
          <Section icon={<History size={12} />} title={`History · ${String(history.length)}`}>
            <div className="flex flex-col gap-1.5">
              {history.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-[11.5px] leading-snug">
                  <span className="mt-0.5 font-mono text-[10px] text-faint">
                    {h.date || `#${String(i + 1)}`}
                  </span>
                  <span
                    className={`mt-0.5 flex-none rounded px-1 py-0.5 text-[8.5px] font-bold uppercase ${
                      h.kind === "create" ? "bg-acc/15 text-acc" : "bg-med/15 text-med"
                    }`}
                  >
                    {h.kind === "create" ? (
                      <Plus size={9} className="inline" />
                    ) : (
                      <ArrowRight size={9} className="inline" />
                    )}{" "}
                    {h.kind}
                  </span>
                  <span className="min-w-0 flex-1 text-dim">
                    {h.details.length > 0 ? h.details.join(", ") : h.title}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function RelationRow({
  r,
  dir,
  onNavigate,
}: {
  r: ModelRelation;
  dir: "in" | "out";
  onNavigate: (table: string) => void;
}) {
  const style = RELATION_STYLE[r.category];
  const target = dir === "out" ? r.relatedTable : r.table;
  const text = dir === "out" ? describeRelation(r) : `${r.model} ${describeRelation(r)}`;
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => {
        if (target) onNavigate(target);
      }}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11.5px] hover:bg-panel2 disabled:cursor-default"
    >
      <span
        className="flex-none rounded px-1.5 py-0.5 text-[8.5px] font-bold"
        style={{ background: `${style.color}22`, color: style.color }}
      >
        {dir === "out" ? "→" : "←"} {r.kind}
      </span>
      <span className="truncate">{text}</span>
      {target && <ArrowRight size={11} className="ml-auto flex-none text-faint" />}
    </button>
  );
}

function Prop({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 flex-none text-faint">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{v}</dd>
    </div>
  );
}
