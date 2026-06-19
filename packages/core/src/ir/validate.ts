import type { Schema } from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  table?: string;
}

/** Structural integrity checks over the Schema IR. */
export function validate(schema: Schema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenTables = new Set<string>();
  const byName = new Map(schema.tables.map((t) => [t.name, t]));

  for (const table of schema.tables) {
    if (seenTables.has(table.name)) {
      issues.push({
        severity: "error",
        message: `Duplicate table name "${table.name}".`,
        table: table.name,
      });
    }
    seenTables.add(table.name);

    const seenCols = new Set<string>();
    for (const col of table.columns) {
      if (seenCols.has(col.name)) {
        issues.push({
          severity: "error",
          message: `Duplicate column "${col.name}" in "${table.name}".`,
          table: table.name,
        });
      }
      seenCols.add(col.name);
    }

    if (!table.primaryKey || table.primaryKey.length === 0) {
      issues.push({
        severity: "warning",
        message: `Table "${table.name}" has no primary key.`,
        table: table.name,
      });
    }

    for (const fk of table.foreignKeys) {
      for (const lc of fk.columns) {
        if (!table.columns.some((c) => c.name === lc)) {
          issues.push({
            severity: "error",
            message: `Foreign key on "${table.name}" uses missing column "${lc}".`,
            table: table.name,
          });
        }
      }
      const ref = byName.get(fk.refTable);
      if (!ref) {
        issues.push({
          severity: "error",
          message: `Foreign key on "${table.name}" references missing table "${fk.refTable}".`,
          table: table.name,
        });
        continue;
      }
      for (const rc of fk.refColumns) {
        if (!ref.columns.some((c) => c.name === rc)) {
          issues.push({
            severity: "error",
            message: `Foreign key on "${table.name}" references missing column "${fk.refTable}.${rc}".`,
            table: table.name,
          });
        }
      }
    }
  }

  return issues;
}
