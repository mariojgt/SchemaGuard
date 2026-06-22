/**
 * Schema diff — the heart of the "guard" loop.
 *
 * Compares a `before` schema (typically a live database, reverse-engineered via
 * introspection) against an `after` schema (your design on the canvas) and
 * reports the structural delta needed to migrate before → after. Every change
 * carries a severity so destructive operations (dropping a table or column,
 * tightening nullability) stand out before they ever reach production.
 *
 * Pure and dialect-neutral: no DOM, no DB, just IR in / diff out. Scope is
 * intentionally focused on tables and columns (the 80% case). Index and
 * foreign-key drift are out of scope for now to avoid false positives from
 * best-effort introspection.
 */

import type { CanonicalType, Column, Schema, Table } from "./types";

export type ChangeSeverity = "safe" | "caution" | "destructive";

export interface FieldChange {
  field: "type" | "nullable" | "unique";
  before: string;
  after: string;
  severity: ChangeSeverity;
}

export interface ColumnDiff {
  name: string;
  status: "added" | "removed" | "modified";
  severity: ChangeSeverity;
  /** One-line, human-readable summary of the change. */
  detail: string;
  /** Field-level changes (only for status "modified"). */
  changes?: FieldChange[];
}

export interface TableDiff {
  name: string;
  status: "added" | "removed" | "modified";
  /** The worst severity among this table's changes. */
  severity: ChangeSeverity;
  detail: string;
  /** Changed columns (for "modified"); empty for whole-table add/remove. */
  columns: ColumnDiff[];
}

export interface DiffSummary {
  tablesAdded: number;
  tablesRemoved: number;
  tablesModified: number;
  columnsAdded: number;
  columnsRemoved: number;
  columnsModified: number;
  /** Total count of destructive changes across the whole diff. */
  destructive: number;
}

export interface SchemaDiff {
  /** Only tables that changed, sorted: removed → modified → added, then by name. */
  tables: TableDiff[];
  summary: DiffSummary;
  /** True when the two schemas are structurally identical (tables/columns). */
  identical: boolean;
}

/** A stable, dialect-neutral label for a canonical type, e.g. `string(255)`. */
export function typeLabel(t: CanonicalType): string {
  switch (t.kind) {
    case "serial":
      return `serial(${t.size})`;
    case "int":
      return `int(${t.size})`;
    case "decimal":
      return `decimal(${String(t.precision)},${String(t.scale)})`;
    case "string":
      return `string(${String(t.length)})`;
    case "boolean":
    case "float":
    case "double":
    case "text":
    case "uuid":
    case "json":
    case "date":
    case "time":
    case "datetime":
    case "timestamptz":
    case "binary":
      return t.kind;
  }
}

const RANK: Record<ChangeSeverity, number> = { safe: 0, caution: 1, destructive: 2 };

function worst(severities: ChangeSeverity[]): ChangeSeverity {
  return severities.reduce<ChangeSeverity>(
    (acc, s) => (RANK[s] > RANK[acc] ? s : acc),
    "safe",
  );
}

/** Match by lower-cased name so unquoted-identifier casing doesn't cause false diffs. */
function byLowerName<T extends { name: string }>(items: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(it.name.toLowerCase(), it);
  return m;
}

function diffColumns(before: Table, after: Table): ColumnDiff[] {
  const beforeCols = byLowerName(before.columns);
  const afterCols = byLowerName(after.columns);
  const diffs: ColumnDiff[] = [];

  // Removed: present in the live DB, absent from the design → DROP COLUMN.
  for (const [key, col] of beforeCols) {
    if (!afterCols.has(key)) {
      diffs.push({
        name: col.name,
        status: "removed",
        severity: "destructive",
        detail: `Column would be dropped — existing data in "${col.name}" is lost.`,
      });
    }
  }

  // Added: present in the design, absent from the live DB → ADD COLUMN.
  for (const [key, col] of afterCols) {
    if (!beforeCols.has(key)) {
      const needsBackfill = !col.nullable && col.default === undefined;
      diffs.push({
        name: col.name,
        status: "added",
        severity: needsBackfill ? "caution" : "safe",
        detail: needsBackfill
          ? `New NOT NULL column with no default — will fail on a table that already has rows.`
          : `New column — safe to add.`,
      });
    }
  }

  // Modified: present in both, compare field by field.
  for (const [key, beforeCol] of beforeCols) {
    const afterCol = afterCols.get(key);
    if (!afterCol) continue;
    const changes = compareColumn(beforeCol, afterCol);
    if (changes.length > 0) {
      diffs.push({
        name: afterCol.name,
        status: "modified",
        severity: worst(changes.map((c) => c.severity)),
        detail: changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join(", "),
        changes,
      });
    }
  }

  return diffs;
}

function compareColumn(before: Column, after: Column): FieldChange[] {
  const changes: FieldChange[] = [];

  const beforeType = typeLabel(before.type);
  const afterType = typeLabel(after.type);
  if (beforeType !== afterType) {
    changes.push({ field: "type", before: beforeType, after: afterType, severity: "caution" });
  }

  if (before.nullable !== after.nullable) {
    // Going from nullable → NOT NULL can fail on existing null rows; the reverse is always safe.
    changes.push({
      field: "nullable",
      before: before.nullable ? "nullable" : "not null",
      after: after.nullable ? "nullable" : "not null",
      severity: after.nullable ? "safe" : "caution",
    });
  }

  const beforeUnique = before.unique === true;
  const afterUnique = after.unique === true;
  if (beforeUnique !== afterUnique) {
    // Adding a unique constraint can fail on existing duplicate values.
    changes.push({
      field: "unique",
      before: beforeUnique ? "unique" : "not unique",
      after: afterUnique ? "unique" : "not unique",
      severity: afterUnique ? "caution" : "safe",
    });
  }

  return changes;
}

/**
 * Diff two schemas. `before` is the current state (e.g. the live database),
 * `after` is the desired state (e.g. your design). The result describes what it
 * would take to migrate `before` into `after`.
 */
export function diffSchemas(before: Schema, after: Schema): SchemaDiff {
  const beforeTables = byLowerName(before.tables);
  const afterTables = byLowerName(after.tables);
  const tables: TableDiff[] = [];

  // Tables only in the live DB → would be dropped.
  for (const [key, t] of beforeTables) {
    if (!afterTables.has(key)) {
      tables.push({
        name: t.name,
        status: "removed",
        severity: "destructive",
        detail: `Table is not in your design — would be dropped, losing all ${String(t.columns.length)} column(s) and their data.`,
        columns: [],
      });
    }
  }

  // Tables only in the design → would be created.
  for (const [key, t] of afterTables) {
    if (!beforeTables.has(key)) {
      tables.push({
        name: t.name,
        status: "added",
        severity: "safe",
        detail: `New table with ${String(t.columns.length)} column(s) — will be created.`,
        columns: [],
      });
    }
  }

  // Tables in both → compare columns.
  for (const [key, beforeT] of beforeTables) {
    const afterT = afterTables.get(key);
    if (!afterT) continue;
    const columns = diffColumns(beforeT, afterT);
    if (columns.length > 0) {
      tables.push({
        name: afterT.name,
        status: "modified",
        severity: worst(columns.map((c) => c.severity)),
        detail: `${String(columns.length)} column change(s).`,
        columns,
      });
    }
  }

  const order: Record<TableDiff["status"], number> = { removed: 0, modified: 1, added: 2 };
  tables.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  const summary: DiffSummary = {
    tablesAdded: tables.filter((t) => t.status === "added").length,
    tablesRemoved: tables.filter((t) => t.status === "removed").length,
    tablesModified: tables.filter((t) => t.status === "modified").length,
    columnsAdded: 0,
    columnsRemoved: 0,
    columnsModified: 0,
    destructive: 0,
  };
  for (const t of tables) {
    if (t.status === "removed") summary.destructive += 1;
    for (const c of t.columns) {
      if (c.status === "added") summary.columnsAdded += 1;
      else if (c.status === "removed") summary.columnsRemoved += 1;
      else summary.columnsModified += 1;
      if (c.severity === "destructive") summary.destructive += 1;
    }
  }

  return { tables, summary, identical: tables.length === 0 };
}
