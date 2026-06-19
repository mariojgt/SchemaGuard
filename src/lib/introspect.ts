import type { CanonicalType, ReferentialAction, Schema, Table } from "@schemaguard/core";

import type { DbDialect, QueryResult } from "./db";
import { dbQuery } from "./db";

/**
 * Reverse-engineer a live database into the Schema IR by querying its system
 * catalogs through the existing db_query bridge — no extra native code needed.
 * Best-effort: index lookups that fail (permissions, exotic catalogs) are
 * skipped rather than aborting the whole import.
 */

/** Turn a QueryResult into row objects keyed by lower-cased column name. */
function rows(r: QueryResult): Record<string, string | null>[] {
  const keys = r.columns.map((c) => c.toLowerCase());
  return r.rows.map((row) => {
    const o: Record<string, string | null> = {};
    keys.forEach((k, i) => (o[k] = row[i] ?? null));
    return o;
  });
}

function num(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function mapType(
  dialect: DbDialect,
  dataType: string,
  charLen: number | undefined,
  prec: number | undefined,
  scale: number | undefined,
  autoInc: boolean,
): CanonicalType {
  const t = dataType.toLowerCase();
  const intSize = t.includes("big")
    ? "big"
    : t.includes("small") || t.includes("tiny")
      ? "small"
      : "regular";

  if (autoInc && (t.includes("int") || t === "serial" || t.includes("serial"))) {
    return { kind: "serial", size: intSize };
  }
  if (t === "boolean" || t === "bool") return { kind: "boolean" };
  if (t.includes("int")) return { kind: "int", size: intSize };
  if (t === "numeric" || t === "decimal")
    return { kind: "decimal", precision: prec ?? 10, scale: scale ?? 0 };
  if (t === "real" || t === "float") return { kind: "float" };
  if (t === "double precision" || t === "double") return { kind: "double" };
  if (t === "uuid") return { kind: "uuid" };
  if (t === "json" || t === "jsonb") return { kind: "json" };
  if (t === "date") return { kind: "date" };
  if (t.startsWith("time") && !t.includes("stamp") && !t.includes("date")) return { kind: "time" };
  if (t.includes("timestamp") && t.includes("with time zone")) return { kind: "timestamptz" };
  if (t === "timestamp" && dialect === "mysql") return { kind: "timestamptz" };
  if (t.includes("timestamp") || t === "datetime") return { kind: "datetime" };
  if (t.includes("char") || t === "character varying" || t === "varchar")
    return { kind: "string", length: charLen ?? 255 };
  if (t.includes("text") || t === "clob") return { kind: "text" };
  if (t.includes("blob") || t === "bytea" || t.includes("binary")) return { kind: "binary" };
  return { kind: "text" };
}

function mapAction(rule: string | null | undefined): ReferentialAction | undefined {
  switch ((rule ?? "").toUpperCase()) {
    case "CASCADE":
      return "cascade";
    case "SET NULL":
      return "set null";
    case "RESTRICT":
      return "restrict";
    case "NO ACTION":
      return "no action";
    default:
      return undefined;
  }
}

const Q = {
  postgres: {
    columns: `SELECT table_name, column_name, data_type, is_nullable, column_default,
        character_maximum_length, numeric_precision, numeric_scale, '' AS extra
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
    pk: `SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ORDER BY kcu.table_name, kcu.ordinal_position`,
    fk: `SELECT kcu.table_name, kcu.column_name,
        ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.constraint_name AND ccu.constraint_schema = rc.constraint_schema
      WHERE kcu.table_schema = 'public'`,
    idx: `SELECT t.relname AS table_name, i.relname AS index_name,
        a.attname AS column_name, ix.indisunique AS is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relkind = 'r' AND NOT ix.indisprimary
      ORDER BY t.relname, i.relname`,
  },
  mysql: {
    columns: `SELECT table_name, column_name, data_type, is_nullable, column_default,
        character_maximum_length, numeric_precision, numeric_scale, extra
      FROM information_schema.columns WHERE table_schema = database()
      ORDER BY table_name, ordinal_position`,
    pk: `SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = database()
      ORDER BY kcu.table_name, kcu.ordinal_position`,
    fk: `SELECT kcu.table_name, kcu.column_name,
        kcu.referenced_table_name AS ref_table, kcu.referenced_column_name AS ref_column,
        rc.delete_rule
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name AND rc.constraint_schema = kcu.constraint_schema
      WHERE kcu.table_schema = database() AND kcu.referenced_table_name IS NOT NULL`,
    idx: `SELECT table_name, index_name, column_name,
        non_unique, seq_in_index
      FROM information_schema.statistics
      WHERE table_schema = database() AND index_name <> 'PRIMARY'
      ORDER BY table_name, index_name, seq_in_index`,
  },
} as const;

/** Fetch the primary-key column names for one table (empty if it has none). */
export async function fetchPrimaryKey(
  connId: string,
  dialect: DbDialect,
  table: string,
): Promise<string[]> {
  const schemaFilter = dialect === "mysql" ? "database()" : "'public'";
  const t = table.replace(/'/g, "''");
  // Join on table_name too: in MySQL every PK constraint is named "PRIMARY",
  // so matching on constraint_name + schema alone pulls in PK columns from
  // every table in the database.
  const sql = `SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = ${schemaFilter} AND tc.table_name = '${t}'
    ORDER BY kcu.ordinal_position`;
  const res = await dbQuery(connId, sql);
  return rows(res)
    .map((r) => r.column_name)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
}

export async function introspectSchema(
  connId: string,
  dialect: DbDialect,
  name: string,
): Promise<Schema> {
  const q = Q[dialect];
  const colRes = await dbQuery(connId, q.columns);
  const pkRes = await dbQuery(connId, q.pk);
  const fkRes = await dbQuery(connId, q.fk);
  let idxRes: QueryResult = { columns: [], rows: [], rowsAffected: 0 };
  try {
    idxRes = await dbQuery(connId, q.idx);
  } catch {
    /* indexes are best-effort */
  }
  return buildSchemaFromCatalog(dialect, name, colRes, pkRes, fkRes, idxRes);
}

/**
 * Pure assembly of system-catalog query results into the Schema IR. Separated
 * from the I/O above so it can be unit-tested without a live database.
 */
export function buildSchemaFromCatalog(
  dialect: DbDialect,
  name: string,
  colRes: QueryResult,
  pkRes: QueryResult,
  fkRes: QueryResult,
  idxRes: QueryResult,
): Schema {
  const colRows = rows(colRes);
  const pkRows = rows(pkRes);
  const fkRows = rows(fkRes);
  const idxRows = rows(idxRes);

  const tables = new Map<string, Table>();
  const tableOf = (n: string): Table => {
    let t = tables.get(n);
    if (!t) {
      t = { name: n, columns: [], indexes: [], foreignKeys: [] };
      tables.set(n, t);
    }
    return t;
  };

  // Columns.
  for (const r of colRows) {
    const tn = r.table_name ?? "";
    const cn = r.column_name ?? "";
    if (!tn || !cn) continue;
    const def = r.column_default ?? "";
    const autoInc =
      (r.extra ?? "").toLowerCase().includes("auto_increment") || /nextval\(/i.test(def);
    tableOf(tn).columns.push({
      name: cn,
      type: mapType(
        dialect,
        r.data_type ?? "text",
        num(r.character_maximum_length),
        num(r.numeric_precision),
        num(r.numeric_scale),
        autoInc,
      ),
      nullable: (r.is_nullable ?? "YES").toUpperCase() === "YES",
      ...(autoInc ? { default: { kind: "autoincrement" as const } } : {}),
    });
  }

  // Primary keys.
  const pkByTable = new Map<string, string[]>();
  for (const r of pkRows) {
    const tn = r.table_name ?? "";
    const cn = r.column_name ?? "";
    if (!tn || !cn) continue;
    pkByTable.set(tn, [...(pkByTable.get(tn) ?? []), cn]);
  }
  for (const [tn, cols] of pkByTable) {
    const t = tables.get(tn);
    if (t) t.primaryKey = cols;
  }

  // Foreign keys.
  for (const r of fkRows) {
    const tn = r.table_name ?? "";
    const col = r.column_name ?? "";
    const refTable = r.ref_table ?? "";
    const refCol = r.ref_column ?? "id";
    if (!tn || !col || !refTable) continue;
    const action = mapAction(r.delete_rule);
    tableOf(tn).foreignKeys.push({
      columns: [col],
      refTable,
      refColumns: [refCol],
      ...(action ? { onDelete: action } : {}),
    });
  }

  // Indexes — group by (table, index_name), preserving column order.
  const idxGroups = new Map<string, { table: string; unique: boolean; columns: string[] }>();
  for (const r of idxRows) {
    const tn = r.table_name ?? "";
    const idxName = r.index_name ?? "";
    const col = r.column_name ?? "";
    if (!tn || !idxName || !col) continue;
    const unique =
      r.is_unique !== undefined && r.is_unique !== null
        ? r.is_unique === "t" || r.is_unique === "true" || r.is_unique === "1"
        : r.non_unique === "0";
    const key = `${tn}::${idxName}`;
    const g = idxGroups.get(key) ?? { table: tn, unique, columns: [] };
    g.columns.push(col);
    idxGroups.set(key, g);
  }
  for (const g of idxGroups.values()) {
    const t = tables.get(g.table);
    if (!t) continue;
    // A single-column unique index is represented as a column flag.
    if (g.unique && g.columns.length === 1) {
      const c = t.columns.find((x) => x.name === g.columns[0]);
      if (c) {
        c.unique = true;
        continue;
      }
    }
    t.indexes.push({ columns: g.columns, unique: g.unique });
  }

  return {
    name: name || "Database",
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sourceDialect: dialect === "mysql" ? "mysql" : "postgres",
  };
}
