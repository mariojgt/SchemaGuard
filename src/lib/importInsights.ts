/**
 * Aggregate insights for a Laravel import — built purely from the parsed
 * migration history + model metadata, so they're easy to test and reuse.
 *
 *  - summarizeImport: a bird's-eye overview of the whole import
 *  - detectDrift: where a model and its migrations disagree
 *  - tableHistory: how one table evolved across migrations
 *  - destructiveOps: every prod-dangerous operation, in one list
 */
import type {
  MigrationEntry,
  MigrationOp,
  MigrationOpKind,
  ModelInfo,
  ModelRelation,
  RiskLevel,
  Schema,
} from "@schemaguard/core";

export interface ImportSummary {
  migrations: number;
  tables: number;
  columns: number;
  foreignKeys: number;
  indexes: number;
  relationships: number;
  models: number;
  /** Migrations rated high or critical risk. */
  risky: number;
  /** Migrations with no (or empty) down() — not reversible. */
  irreversible: number;
  /** Total prod-dangerous operations across all migrations. */
  destructive: number;
  driftIssues: number;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface DriftIssue {
  model: string;
  table: string;
  tone: "warn" | "info";
  text: string;
}

export interface TableHistoryEntry {
  date: string;
  filename: string;
  title: string;
  kind: "create" | "alter";
  details: string[];
}

export interface DestructiveEntry {
  date: string;
  filename: string;
  title: string;
  level: RiskLevel;
  op: MigrationOp;
}

const DESTRUCTIVE_KINDS = new Set<MigrationOpKind>([
  "dropTable",
  "dropColumn",
  "dropForeignKey",
  "dropIndex",
  "renameTable",
  "renameColumn",
  "changeColumn",
]);

const RISKY_LEVELS = new Set<RiskLevel>(["high", "critical"]);

function firstDate(migrations: MigrationEntry[]): string | null {
  for (const m of migrations) if (m.date) return m.date;
  return null;
}
function lastDate(migrations: MigrationEntry[]): string | null {
  for (let i = migrations.length - 1; i >= 0; i--) {
    const d = migrations[i]?.date;
    if (d) return d;
  }
  return null;
}

/** A one-glance overview of everything an import produced. */
export function summarizeImport(input: {
  schema: Schema;
  migrations: MigrationEntry[];
  modelInfos: ModelInfo[];
  modelRelations: ModelRelation[];
  driftIssues: number;
}): ImportSummary {
  const { schema, migrations, modelInfos, modelRelations, driftIssues } = input;
  let columns = 0;
  let foreignKeys = 0;
  let indexes = 0;
  for (const t of schema.tables) {
    columns += t.columns.length;
    foreignKeys += t.foreignKeys.length;
    indexes += t.indexes.length;
  }
  return {
    migrations: migrations.length,
    tables: schema.tables.length,
    columns,
    foreignKeys,
    indexes,
    relationships: modelRelations.length,
    models: modelInfos.length,
    risky: migrations.filter((m) => RISKY_LEVELS.has(m.risk.level)).length,
    irreversible: migrations.filter((m) => !m.risk.hasDown).length,
    destructive: migrations.reduce(
      (n, m) => n + m.risk.ops.filter((o) => DESTRUCTIVE_KINDS.has(o.kind)).length,
      0,
    ),
    driftIssues,
    dateFrom: firstDate(migrations),
    dateTo: lastDate(migrations),
  };
}

/**
 * Find places where a model's declarations don't match the columns its
 * migrations actually create — the most common source of silent bugs.
 */
export function detectDrift(
  schema: Schema,
  modelInfos: ModelInfo[],
  modelRelations: ModelRelation[],
): DriftIssue[] {
  const out: DriftIssue[] = [];
  const tableByName = new Map(schema.tables.map((t) => [t.name, t]));

  for (const info of modelInfos) {
    const table = tableByName.get(info.table);
    if (!table) {
      out.push({
        model: info.model,
        table: info.table,
        tone: "warn",
        text: `Model maps to table "${info.table}", but no migration creates it.`,
      });
      continue;
    }
    const cols = new Set(table.columns.map((c) => c.name));
    const flag = (names: string[], what: string, tone: DriftIssue["tone"] = "warn") => {
      for (const n of names) {
        if (n === "*" || cols.has(n)) continue;
        out.push({
          model: info.model,
          table: info.table,
          tone,
          text: `${what} "${n}" — no such column on ${info.table}.`,
        });
      }
    };

    flag(info.fillable, "$fillable lists");
    flag(info.hidden, "$hidden lists");
    flag(info.guarded, "$guarded lists");
    flag(Object.keys(info.casts), "$casts references");

    if (info.primaryKey && !cols.has(info.primaryKey)) {
      out.push({
        model: info.model,
        table: info.table,
        tone: "warn",
        text: `Primary key "${info.primaryKey}" isn't a column on ${info.table}.`,
      });
    }
    const hasTs = cols.has("created_at") || cols.has("updated_at");
    if (info.timestamps && !hasTs) {
      out.push({
        model: info.model,
        table: info.table,
        tone: "warn",
        text: `Model uses timestamps, but ${info.table} has no created_at / updated_at.`,
      });
    }
    if (!info.timestamps && hasTs) {
      out.push({
        model: info.model,
        table: info.table,
        tone: "info",
        text: `${info.table} has timestamp columns, but the model sets $timestamps = false.`,
      });
    }
    if (info.softDeletes && !cols.has("deleted_at")) {
      out.push({
        model: info.model,
        table: info.table,
        tone: "warn",
        text: `Model uses SoftDeletes, but ${info.table} has no deleted_at column.`,
      });
    }

    for (const r of modelRelations) {
      if (r.table !== info.table) continue;
      if (r.kind === "belongsTo" && r.fkColumn && !cols.has(r.fkColumn)) {
        out.push({
          model: info.model,
          table: info.table,
          tone: "warn",
          text: `"${r.method}" expects foreign key "${r.fkColumn}", which ${info.table} doesn't have.`,
        });
      }
    }
  }
  return out;
}

/** How one table changed across the migration history, oldest first. */
export function tableHistory(migrations: MigrationEntry[], tableName: string): TableHistoryEntry[] {
  const out: TableHistoryEntry[] = [];
  for (const m of migrations) {
    if (!m.affectedTables.includes(tableName)) continue;
    const own = m.changes.filter((c) => c.table === tableName);
    out.push({
      date: m.date,
      filename: m.filename,
      title: m.title,
      kind: own.some((c) => c.kind === "create") ? "create" : "alter",
      details: own.map((c) => c.detail).filter((d) => d.length > 0),
    });
  }
  return out;
}

/** Every prod-dangerous operation across all migrations, in timeline order. */
export function destructiveOps(migrations: MigrationEntry[]): DestructiveEntry[] {
  const out: DestructiveEntry[] = [];
  for (const m of migrations) {
    for (const op of m.risk.ops) {
      if (DESTRUCTIVE_KINDS.has(op.kind)) {
        out.push({ date: m.date, filename: m.filename, title: m.title, level: m.risk.level, op });
      }
    }
  }
  return out;
}
