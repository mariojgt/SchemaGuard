import type { Schema, Table } from "../ir/types";
import type { ModelInfo, ModelRelation } from "./eloquent";
import { mergeModelRelationships, parseModelFiles } from "./eloquent";
import { applySource, extractUpBody } from "./laravel";
import type { MigrationRisk } from "./migrationRisk";
import { analyzeMigrationSource } from "./migrationRisk";

export interface MigrationChangeSummary {
  table: string;
  kind: "create" | "alter";
  detail: string;
}

export interface MigrationEntry {
  filename: string;
  date: string; // "2024-01-15" parsed from the filename prefix
  title: string; // "create users table"
  changes: MigrationChangeSummary[];
  affectedTables: string[];
  /** Safety assessment of this migration's operations. */
  risk: MigrationRisk;
}

export interface MigrationHistory {
  migrations: MigrationEntry[];
  /** snapshots[i] = the full schema after migrations 0..i have been applied. */
  snapshots: Schema[];
  finalSchema: Schema;
  /** Eloquent relationships parsed from the models folder (empty if none given). */
  modelRelations: ModelRelation[];
  /** Per-model metadata (fillable, casts, timestamps…) parsed from the models folder. */
  modelInfos: ModelInfo[];
  warnings: string[];
}

function snapshot(tables: Table[]): Schema {
  // JSON clone keeps the engine free of DOM globals (structuredClone) — schema is plain data.
  return JSON.parse(JSON.stringify({ name: "Imported", tables })) as Schema;
}

function parseFilename(name: string): { date: string; title: string } {
  const base = name.replace(/\.php$/, "");
  const m = /^(\d{4})_(\d{2})_(\d{2})_\d{6}_(.+)$/.exec(base);
  if (m) {
    return {
      date: `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`,
      title: (m[4] ?? "").replace(/_/g, " "),
    };
  }
  return { date: "", title: base.replace(/_/g, " ") };
}

/**
 * Replay a folder of Laravel migration files (in filename order) into a
 * timeline: per-migration changes + a schema snapshot after each step.
 *
 * Optionally, a folder of Eloquent model files can be supplied. Their
 * `belongsTo` relationships are overlaid onto the *final* schema as logical
 * (`source: "model"`) foreign keys — they don't belong to any single migration
 * step, so they're not added to the historical snapshots.
 */
export function parseLaravelMigrations(
  files: { name: string; content: string }[],
  modelFiles: { name: string; content: string }[] = [],
): MigrationHistory {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map<string, Table>();
  const result: Table[] = [];
  const warnings: string[] = [];
  const migrations: MigrationEntry[] = [];
  const snapshots: Schema[] = [];

  for (const file of sorted) {
    const applied = applySource(extractUpBody(file.content), byName, result, warnings);
    if (applied.length === 0) continue; // not a schema migration (skip)
    const meta = parseFilename(file.name);
    migrations.push({
      filename: file.name,
      date: meta.date,
      title: meta.title,
      affectedTables: applied.map((a) => a.table),
      risk: analyzeMigrationSource(file.content),
      changes: applied.map((a) => ({
        table: a.table,
        kind: a.kind,
        detail:
          a.kind === "create"
            ? `created · ${String(a.totalColumns)} cols`
            : `+${String(a.addedColumns)} col`,
      })),
    });
    snapshots.push(snapshot(result));
  }

  const finalSchema = snapshot(result);
  let modelRelations: ModelRelation[] = [];
  let modelInfos: ModelInfo[] = [];

  if (modelFiles.length > 0) {
    const parsed = parseModelFiles(modelFiles);
    modelRelations = parsed.relations;
    modelInfos = parsed.models;
    const added = mergeModelRelationships(finalSchema, modelRelations);
    // Mirror the model edges onto the last snapshot so the timeline's final
    // step stays consistent with the final schema view.
    const last = snapshots[snapshots.length - 1];
    if (last) mergeModelRelationships(last, modelRelations);
    if (added > 0) {
      warnings.push(`Added ${String(added)} foreign key(s) inferred from Eloquent models.`);
    }
    warnings.push(...parsed.warnings);
  }

  return { migrations, snapshots, finalSchema, modelRelations, modelInfos, warnings };
}
