import type { DialectId } from "@schemaguard/core";
import { dialectFor, emitDdl } from "@schemaguard/core";
import { useMemo } from "react";

import { highlightSql } from "../lib/highlightSql";
import { useSchemaStore } from "../stores/schema";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";
const DIALECTS: { id: DialectId; label: string }[] = [
  { id: "sqlite", label: "SQLite" },
  { id: "mysql", label: "MySQL" },
  { id: "postgres", label: "PostgreSQL" },
];

export function SqlEditorPane() {
  const schema = useSchemaStore((s) => s.schema);
  const target = useSchemaStore((s) => s.target);
  const setTarget = useSchemaStore((s) => s.setTarget);

  const sql = useMemo(
    () => emitDdl(schema, dialectFor(target), { ifNotExists: false }),
    [schema, target],
  );
  const lines = useMemo(() => sql.split("\n"), [sql]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <div className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
          {DIALECTS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setTarget(d.id);
              }}
              className={`rounded-md px-2.5 py-1 text-[11.5px] ${
                target === d.id ? "font-semibold text-white" : "text-dim"
              }`}
              style={target === d.id ? { background: GRADIENT } : undefined}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="rounded-md bg-panel3 px-2 py-1 text-[11px] text-dim">
          DDL · Create Table
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-faint">
          {sql.length} chars · {lines.length} lines
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full font-mono text-[12px] leading-[1.65]">
          <div className="select-none border-r border-line px-3 py-3 text-right text-faint/50">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 whitespace-pre py-3 pl-4 pr-4 text-ink">
            {lines.map((line, i) => (
              <div key={i}>{highlightSql(line)}</div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
