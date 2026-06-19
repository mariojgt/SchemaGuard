/**
 * Indexing advisor.
 *
 * Looks at a schema purely from a "will this be fast and correct to query?"
 * angle and returns findings written in plain English — what the problem is,
 * *why* it matters, and the exact fix as both SQL and a Laravel migration line.
 * Deliberately high-signal: missing primary keys, unindexed foreign keys,
 * `*_id` columns that look like foreign keys but aren't indexed, and redundant
 * indexes that only slow writes down.
 */
import type { Schema, Table } from "./types";

export type IndexLevel = "high" | "medium" | "low";

export interface IndexFinding {
  id: string;
  level: IndexLevel;
  table: string;
  columns: string[];
  /** Short headline. */
  title: string;
  /** Plain-English: what it is and why it matters. */
  explanation: string;
  /** A concrete fix, when one applies. */
  fix?: { sql: string; laravel: string };
}

/** Every set of columns that already has index-like coverage (real indexes, the
 *  primary key, and single-column UNIQUE constraints). */
function coveringIndexes(t: Table): string[][] {
  const list: string[][] = t.indexes.map((i) => i.columns);
  if (t.primaryKey && t.primaryKey.length > 0) list.push(t.primaryKey);
  for (const c of t.columns) if (c.unique) list.push([c.name]);
  return list;
}

/** True if some index's leading columns match `cols` (a prefix match — the only
 *  ordering a B-tree can serve for these columns). */
function leadingCovered(indexes: string[][], cols: string[]): boolean {
  return indexes.some((idx) => cols.length <= idx.length && cols.every((c, i) => idx[i] === c));
}

const idxName = (table: string, cols: string[]) => `idx_${table}_${cols.join("_")}`;
const laravelCols = (cols: string[]) =>
  cols.length === 1 ? `'${cols[0] ?? ""}'` : `['${cols.join("', '")}']`;

/** Analyze a schema for indexing problems, newest/most-severe first. */
export function analyzeIndexing(schema: Schema): IndexFinding[] {
  const findings: IndexFinding[] = [];

  for (const t of schema.tables) {
    const covering = coveringIndexes(t);
    const fkCols = new Set(t.foreignKeys.flatMap((fk) => fk.columns));
    const pkCols = new Set(t.primaryKey ?? []);

    // 1. No primary key.
    if (!t.primaryKey || t.primaryKey.length === 0) {
      findings.push({
        id: `${t.name}:no-pk`,
        level: "high",
        table: t.name,
        columns: [],
        title: "No primary key",
        explanation:
          `"${t.name}" has no primary key. Without one, individual rows can't be reliably ` +
          `identified — an UPDATE or DELETE can hit the wrong row, most ORMs and replication ` +
          `tools won't work with the table, and there's no fast lookup by id. Add a primary key ` +
          `(an auto-incrementing "id" is the usual choice).`,
        fix: {
          sql: `ALTER TABLE ${t.name} ADD COLUMN id BIGSERIAL PRIMARY KEY;`,
          laravel: `$table->id();`,
        },
      });
    }

    // 2. Unindexed foreign keys.
    for (const fk of t.foreignKeys) {
      if (leadingCovered(covering, fk.columns)) continue;
      const cols = fk.columns;
      findings.push({
        id: `${t.name}:fk-no-index:${cols.join(",")}`,
        level: "high",
        table: t.name,
        columns: cols,
        title: "Foreign key has no index",
        explanation:
          `"${t.name}.${cols.join(", ")}" references "${fk.refTable}", but databases do NOT index ` +
          `foreign keys automatically. Every time you load related rows (e.g. one ${fk.refTable} ` +
          `row's ${t.name}) or delete a parent row, the whole "${t.name}" table is scanned. ` +
          `Add an index on ${cols.join(", ")} to make those joins and cascades fast.`,
        fix: {
          sql: `CREATE INDEX ${idxName(t.name, cols)} ON ${t.name} (${cols.join(", ")});`,
          laravel: `$table->index(${laravelCols(cols)});`,
        },
      });
    }

    // 3. `*_id` columns that look like foreign keys but aren't indexed or constrained.
    for (const c of t.columns) {
      if (!c.name.endsWith("_id")) continue;
      if (fkCols.has(c.name) || pkCols.has(c.name)) continue;
      if (leadingCovered(covering, [c.name])) continue;
      findings.push({
        id: `${t.name}:probable-fk:${c.name}`,
        level: "medium",
        table: t.name,
        columns: [c.name],
        title: "Probable foreign key not indexed",
        explanation:
          `"${t.name}.${c.name}" looks like a foreign key (its name ends in "_id"), but it has ` +
          `neither a foreign-key constraint nor an index. Filtering or joining on it scans the ` +
          `whole table, and nothing prevents values that point at rows which no longer exist. ` +
          `Add an index now, and ideally a foreign-key constraint too.`,
        fix: {
          sql: `CREATE INDEX ${idxName(t.name, [c.name])} ON ${t.name} (${c.name});`,
          laravel: `$table->foreignId('${c.name}')->constrained(); // indexes + adds the FK`,
        },
      });
    }

    // 4. Redundant indexes — one index whose columns are a leading prefix of another.
    for (let a = 0; a < t.indexes.length; a++) {
      for (let b = 0; b < t.indexes.length; b++) {
        if (a === b) continue;
        const small = t.indexes[a];
        const big = t.indexes[b];
        if (!small || !big) continue;
        const isPrefix =
          small.columns.length < big.columns.length &&
          small.columns.every((c, i) => big.columns[i] === c) &&
          small.unique === big.unique;
        // Skip the reverse duplicate when lengths are equal (handled once).
        const isDuplicate =
          small.columns.length === big.columns.length &&
          a < b &&
          small.columns.every((c, i) => big.columns[i] === c);
        if (!isPrefix && !isDuplicate) continue;
        findings.push({
          id: `${t.name}:redundant:${small.columns.join(",")}`,
          level: "low",
          table: t.name,
          columns: small.columns,
          title: "Redundant index",
          explanation:
            `The index on (${small.columns.join(", ")}) is redundant — the index on ` +
            `(${big.columns.join(", ")}) already starts with those columns and serves the same ` +
            `lookups. Every extra index slows down inserts and updates and wastes space, so you ` +
            `can drop the one on (${small.columns.join(", ")}).`,
          fix: {
            sql: small.name
              ? `DROP INDEX ${small.name};`
              : `-- drop the index on (${small.columns.join(", ")})`,
            laravel: `$table->dropIndex(${laravelCols(small.columns)});`,
          },
        });
      }
    }
  }

  const order: Record<IndexLevel, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((x, y) => order[x.level] - order[y.level]);
}

/** A one-paragraph plain-English summary of the indexing findings. */
export function explainIndexing(schema: Schema): string {
  const findings = analyzeIndexing(schema);
  if (findings.length === 0) {
    return "Indexing looks healthy: every table has a primary key and every foreign key is indexed.";
  }
  const high = findings.filter((f) => f.level === "high").length;
  const parts = [
    `${String(findings.length)} indexing finding${findings.length === 1 ? "" : "s"}`,
    high > 0 ? `${String(high)} worth fixing now` : "nothing urgent",
  ];
  return `${parts.join(", ")}. ${findings.map((f) => `• ${f.title} on ${f.table}`).join("  ")}`;
}
