import type { CanonicalType, Table } from "@schemaguard/core";
import { GitBranch, KeyRound, ListTree, Table2 } from "lucide-react";

/** A compact, human-readable label for a canonical column type. */
function typeLabel(t: CanonicalType): string {
  switch (t.kind) {
    case "serial":
      return t.size === "big" ? "bigserial" : t.size === "small" ? "smallserial" : "serial";
    case "int":
      return t.size === "big" ? "bigint" : t.size === "small" ? "smallint" : "int";
    case "decimal":
      return `decimal(${String(t.precision)},${String(t.scale)})`;
    case "string":
      return `varchar(${String(t.length)})`;
    default:
      return t.kind;
  }
}

/** phpMyAdmin-style "Structure" view: columns, keys, indexes and FKs of a table. */
export function StructureView({
  loading,
  error,
  selected,
  table,
  onColumnMenu,
}: {
  loading: boolean;
  error: string | null;
  selected: string | null;
  table: Table | undefined;
  onColumnMenu: (e: React.MouseEvent, column: string) => void;
}) {
  if (loading) return <div className="p-4 text-[12px] text-dim">Reading the database schema…</div>;
  if (error)
    return (
      <div className="m-3 rounded-lg border border-crit/40 bg-crit/10 p-3 font-mono text-[11.5px] text-crit">
        {error}
      </div>
    );
  if (!selected) return <div className="p-4 text-[12px] text-dim">Select a table on the left to view its structure.</div>;
  if (!table)
    return <div className="p-4 text-[12px] text-dim">No structure found for “{selected}”.</div>;

  const pk = new Set(table.primaryKey ?? []);

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold">
          <Table2 size={14} className="text-acc" />
          {table.name}
          <span className="text-[11px] font-normal text-faint">· {table.columns.length} columns</span>
        </div>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
              <th className="border-b border-line px-3 py-1.5 font-semibold">Column</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Type</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Null</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Key</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr
                key={col.name}
                onContextMenu={(e) => {
                  onColumnMenu(e, col.name);
                }}
                className="cursor-context-menu hover:bg-panel2/60"
              >
                <td className="border-b border-line/50 px-3 py-1.5 font-mono">{col.name}</td>
                <td className="border-b border-line/50 px-3 py-1.5 font-mono text-acc2">
                  {typeLabel(col.type)}
                </td>
                <td className="border-b border-line/50 px-3 py-1.5 text-dim">
                  {col.nullable ? "YES" : "NO"}
                </td>
                <td className="border-b border-line/50 px-3 py-1.5">
                  {pk.has(col.name) && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-high">
                      <KeyRound size={11} /> PK
                    </span>
                  )}
                  {col.unique && !pk.has(col.name) && (
                    <span className="text-[11px] text-dim">unique</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.indexes.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
            <ListTree size={13} className="text-acc" /> Indexes
          </div>
          <ul className="space-y-1 text-[12px]">
            {table.indexes.map((idx, i) => (
              <li key={i} className="font-mono text-dim">
                {idx.unique ? "UNIQUE " : ""}({idx.columns.join(", ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {table.foreignKeys.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
            <GitBranch size={13} className="text-acc" /> Foreign keys
          </div>
          <ul className="space-y-1 text-[12px]">
            {table.foreignKeys.map((fk, i) => (
              <li key={i} className="font-mono text-dim">
                ({fk.columns.join(", ")}) → {fk.refTable} ({fk.refColumns.join(", ")})
                {fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
