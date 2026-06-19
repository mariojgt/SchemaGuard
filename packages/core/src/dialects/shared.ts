import type { DefaultValue, Schema } from "../ir/types";

/** Render a column default literal/expression. `booleanAsInt` for engines with no boolean (SQLite). */
export function renderDefault(d: DefaultValue | undefined, booleanAsInt: boolean): string | null {
  if (!d || d.kind === "autoincrement") return null;
  if (d.kind === "expr") return d.expr;
  const v = d.value;
  if (v === null) return "NULL";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "boolean") return booleanAsInt ? (v ? "1" : "0") : v ? "TRUE" : "FALSE";
  return String(v);
}

/** Collect unique warnings by scanning every column's canonical type kind. */
export function collectTypeWarnings(
  schema: Schema,
  map: Partial<Record<string, string>>,
): string[] {
  const out = new Set<string>();
  for (const table of schema.tables) {
    for (const col of table.columns) {
      const note = map[col.type.kind];
      if (note) out.add(note);
    }
  }
  return [...out];
}
