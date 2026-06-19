import type { Column } from "@schemaguard/core";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

export interface TableNodeData {
  name: string;
  columns: Column[];
  primaryKey: string[];
  fkColumns: string[];
  accent: string;
  changed: boolean;
  smellCount: number;
  [key: string]: unknown;
}

function displayType(column: Column): string {
  const t = column.type;
  switch (t.kind) {
    case "serial":
    case "int":
      return t.size === "big"
        ? "bigint"
        : t.size === "small" || t.size === "tiny"
          ? "smallint"
          : "integer";
    case "string":
      return `varchar(${t.length})`;
    case "decimal":
      return `decimal(${t.precision},${t.scale})`;
    case "timestamptz":
      return "timestamptz";
    default:
      return t.kind;
  }
}

export function TableNode({ data, selected }: NodeProps) {
  const d = data as TableNodeData;
  return (
    <div
      className={`min-w-[210px] overflow-hidden rounded-lg border bg-node/95 text-ink shadow-2xl backdrop-blur-sm transition-shadow duration-150 ${
        selected
          ? "border-acc shadow-glow"
          : d.changed
            ? "border-med ring-2 ring-med/30"
            : "border-line hover:border-line2"
      }`}
    >
      {d.columns.length === 0 && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            className="!h-2 !w-2 !min-w-0 !border-0 !bg-acc2"
          />
          <Handle
            type="source"
            position={Position.Right}
            className="!h-2 !w-2 !min-w-0 !border-0 !bg-acc"
          />
        </>
      )}
      <div className="h-[3px] w-full" style={{ background: d.accent }} />
      <div className="border-b border-line px-3 py-2">
        <div className="text-[9.5px] font-medium tracking-wide text-faint">
          postgres.public.default
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[13.5px] font-bold">{d.name}</div>
          <span className="ml-auto flex items-center gap-1">
            {d.smellCount > 0 && (
              <span
                title={`${String(d.smellCount)} design smell${d.smellCount === 1 ? "" : "s"} — open Schema health`}
                className="inline-flex items-center gap-0.5 rounded bg-med/20 px-1.5 py-0.5 text-[8.5px] font-bold text-med"
              >
                ⚠ {d.smellCount}
              </span>
            )}
            {d.changed && (
              <span className="rounded bg-med/20 px-1.5 py-0.5 text-[8.5px] font-bold text-med">
                changed
              </span>
            )}
          </span>
        </div>
      </div>
      {d.columns.length === 0 && (
        <div className="px-3 py-2 text-[11px] italic text-faint">no columns</div>
      )}
      {d.columns.map((c) => {
        const isPk = d.primaryKey.includes(c.name);
        const isFk = d.fkColumns.includes(c.name);
        return (
          <div
            key={c.name}
            className="group/row relative flex items-center gap-2.5 border-b border-line/50 px-3 py-1.5 text-[12px] last:border-0"
          >
            <Handle
              type="target"
              id={c.name}
              position={Position.Left}
              className="!-left-1.5 !h-3 !w-3 !min-w-0 !border-2 !border-node !bg-acc2"
            />
            {isPk ? (
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: d.accent }} />
            ) : isFk ? (
              <span className="h-2 w-2 flex-none rounded-full border-2 border-acc2" />
            ) : (
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-faint/50" />
            )}
            <span className={isPk ? "font-semibold" : ""}>{c.name}</span>
            <span className="ml-auto font-mono text-[10px] text-faint">{displayType(c)}</span>
            <Handle
              type="source"
              id={c.name}
              position={Position.Right}
              className="!-right-1.5 !h-3 !w-3 !min-w-0 !border-2 !border-node !bg-acc"
            />
          </div>
        );
      })}
    </div>
  );
}
