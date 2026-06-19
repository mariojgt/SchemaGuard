/**
 * Design-smell detection — the "analyzer" half of SchemaGuard.
 *
 * Validation (validate.ts) answers "is this schema broken?". Smells answer
 * "is this schema *well-designed*?" — surfacing the quiet mistakes that hurt a
 * Laravel/SQL schema in production (unindexed foreign keys, money stored as
 * float, missing primary keys…). Each smell is advisory and most carry a
 * deterministic one-click fix the UI can apply to the IR.
 */
import type { Schema } from "./types";

export type SmellSeverity = "warn" | "info";

/** A deterministic, automatically-applicable repair for a smell. */
export type SmellFix =
  | { kind: "add-index"; table: string; columns: string[] }
  | { kind: "to-decimal"; table: string; column: string }
  | { kind: "add-fk"; table: string; column: string; refTable: string }
  | { kind: "bool-not-null"; table: string; column: string }
  | { kind: "add-id-pk"; table: string }
  | { kind: "add-timestamps"; table: string };

export interface Smell {
  id: string;
  severity: SmellSeverity;
  table: string;
  column?: string;
  title: string;
  detail: string;
  fix?: SmellFix;
}

const MONEY_RE = /(price|amount|total|cost|balance|salary|fee|payment|subtotal|tax|revenue)/i;

function pluralize(word: string): string {
  if (word.endsWith("y")) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}s`;
  return `${word}s`;
}

/** Inspect a schema and return every design smell found, table by table. */
export function detectSmells(schema: Schema): Smell[] {
  const out: Smell[] = [];
  const tableNames = new Set(schema.tables.map((t) => t.name));

  for (const t of schema.tables) {
    const pk = new Set(t.primaryKey ?? []);
    const colNames = new Set(t.columns.map((c) => c.name));
    // A column is "indexed" if it leads an index, is unique, or is part of the PK.
    const indexed = new Set<string>();
    for (const c of t.columns) if (c.unique) indexed.add(c.name);
    for (const idx of t.indexes) if (idx.columns[0]) indexed.add(idx.columns[0]);
    for (const c of pk) indexed.add(c);

    // 1. Missing primary key.
    if (pk.size === 0) {
      out.push({
        id: `${t.name}:no-pk`,
        severity: "warn",
        table: t.name,
        title: "No primary key",
        detail: `Table "${t.name}" has no primary key. Most ORMs and replication tools require one.`,
        fix: { kind: "add-id-pk", table: t.name },
      });
    }

    // 2. Foreign keys that aren't indexed (slow joins; Postgres doesn't auto-index).
    for (const fk of t.foreignKeys) {
      const col = fk.columns[0];
      if (col && !indexed.has(col)) {
        out.push({
          id: `${t.name}:${col}:unindexed-fk`,
          severity: "warn",
          table: t.name,
          column: col,
          title: "Unindexed foreign key",
          detail: `"${col}" references ${fk.refTable} but has no index. Joins and lookups on it will be slow.`,
          fix: { kind: "add-index", table: t.name, columns: [col] },
        });
      }
    }

    const fkCols = new Set(t.foreignKeys.flatMap((fk) => fk.columns));

    for (const c of t.columns) {
      // 3. Money-ish value stored as float/double (precision loss).
      if ((c.type.kind === "float" || c.type.kind === "double") && MONEY_RE.test(c.name)) {
        out.push({
          id: `${t.name}:${c.name}:money-float`,
          severity: "warn",
          table: t.name,
          column: c.name,
          title: "Monetary value as float",
          detail: `"${c.name}" looks monetary but is a ${c.type.kind}. Floats lose precision — use decimal.`,
          fix: { kind: "to-decimal", table: t.name, column: c.name },
        });
      }

      // 4. Looks like a foreign key (*_id) but has no relationship.
      if (c.name.endsWith("_id") && !pk.has(c.name) && !fkCols.has(c.name)) {
        const base = c.name.slice(0, -3);
        const target = tableNames.has(pluralize(base))
          ? pluralize(base)
          : tableNames.has(base)
            ? base
            : undefined;
        if (target) {
          out.push({
            id: `${t.name}:${c.name}:missing-fk`,
            severity: "info",
            table: t.name,
            column: c.name,
            title: "Possible missing foreign key",
            detail: `"${c.name}" looks like it references ${target}, but no foreign key is defined.`,
            fix: { kind: "add-fk", table: t.name, column: c.name, refTable: target },
          });
        }
      }

      // 5. Nullable boolean (three-valued logic is usually unintended).
      if (c.type.kind === "boolean" && c.nullable) {
        out.push({
          id: `${t.name}:${c.name}:nullable-bool`,
          severity: "info",
          table: t.name,
          column: c.name,
          title: "Nullable boolean",
          detail: `"${c.name}" is a nullable boolean. Consider NOT NULL with a default of false.`,
          fix: { kind: "bool-not-null", table: t.name, column: c.name },
        });
      }
    }

    // 6. No timestamps (no created_at / updated_at).
    if (!colNames.has("created_at") && !colNames.has("updated_at") && t.columns.length > 0) {
      out.push({
        id: `${t.name}:no-timestamps`,
        severity: "info",
        table: t.name,
        title: "No timestamps",
        detail: `Table "${t.name}" has no created_at / updated_at columns.`,
        fix: { kind: "add-timestamps", table: t.name },
      });
    }
  }

  return out;
}

const WEIGHT: Record<SmellSeverity, number> = { warn: 8, info: 3 };

/** A 0–100 design-health score derived from the smells (100 = clean). */
export function healthScore(smells: Smell[]): number {
  const penalty = smells.reduce((sum, s) => sum + WEIGHT[s.severity], 0);
  return Math.max(0, 100 - penalty);
}
