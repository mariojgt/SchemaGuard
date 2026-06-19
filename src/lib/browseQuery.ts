import type { DbDialect } from "./db";

export interface BrowseOptions {
  dialect: DbDialect;
  table: string;
  columns: string[];
  /** Free-text search across all columns (cast to text + LIKE). */
  search?: string;
  sortColumn?: string;
  sortDir?: "asc" | "desc";
  limit: number;
  offset: number;
}

/**
 * Build a phpMyAdmin-style "browse" query: optional free-text search across
 * every column, optional sort, and paging. Identifiers are dialect-quoted and
 * the search term is escaped. This powers the Data tab's search + sort; it is a
 * local dev DB client (the user can already run arbitrary SQL), so escaping is
 * for correctness, not a security boundary.
 */
export function buildBrowseQuery(opts: BrowseOptions): string {
  const mysql = opts.dialect === "mysql";
  const qid = (id: string) =>
    mysql ? `\`${id.replace(/`/g, "``")}\`` : `"${id.replace(/"/g, '""')}"`;
  const asText = (col: string) =>
    mysql ? `CAST(${qid(col)} AS CHAR)` : `CAST(${qid(col)} AS TEXT)`;
  const escLiteral = (s: string) => s.replace(/'/g, "''");

  let sql = `SELECT * FROM ${qid(opts.table)}`;

  const term = (opts.search ?? "").trim();
  if (term.length > 0 && opts.columns.length > 0) {
    const conds = opts.columns.map((c) => `${asText(c)} LIKE '%${escLiteral(term)}%'`);
    sql += ` WHERE ${conds.join(" OR ")}`;
  }

  if (opts.sortColumn) {
    sql += ` ORDER BY ${qid(opts.sortColumn)} ${opts.sortDir === "desc" ? "DESC" : "ASC"}`;
  }

  const limit = Math.max(1, Math.min(1000, opts.limit));
  const offset = Math.max(0, opts.offset);
  sql += ` LIMIT ${String(limit)} OFFSET ${String(offset)}`;
  return sql;
}

export interface ColumnValue {
  column: string;
  value: string | null;
}

export interface UpdateOptions {
  dialect: DbDialect;
  table: string;
  /** Columns to change, with their new values (null → SQL NULL). */
  set: ColumnValue[];
  /** Primary-key columns with their ORIGINAL values, identifying the row. */
  where: ColumnValue[];
}

/**
 * Build a single-row UPDATE. Values are emitted as quoted string literals (or
 * NULL) and the database coerces them to each column's real type — which is the
 * type-safe path that works across Postgres and MySQL (binding text params to
 * typed columns fails in Postgres). The WHERE clause targets the row by its
 * primary key, so exactly one row is affected. Throws if there's no key.
 */
export function buildUpdateQuery(opts: UpdateOptions): string {
  if (opts.where.length === 0) throw new Error("Cannot update a row without a primary key.");
  if (opts.set.length === 0) throw new Error("No changed columns to update.");

  const mysql = opts.dialect === "mysql";
  const qid = (id: string) =>
    mysql ? `\`${id.replace(/`/g, "``")}\`` : `"${id.replace(/"/g, '""')}"`;
  const lit = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

  const setClause = opts.set.map((s) => `${qid(s.column)} = ${lit(s.value)}`).join(", ");
  const whereClause = opts.where
    .map((w) =>
      w.value === null ? `${qid(w.column)} IS NULL` : `${qid(w.column)} = ${lit(w.value)}`,
    )
    .join(" AND ");

  return `UPDATE ${qid(opts.table)} SET ${setClause} WHERE ${whereClause}`;
}

/** Dialect-correct identifier quoting (`backticks` for MySQL, "double" otherwise). */
export function quoteIdent(dialect: DbDialect, id: string): string {
  return dialect === "mysql" ? `\`${id.replace(/`/g, "``")}\`` : `"${id.replace(/"/g, '""')}"`;
}

/** A quoted string literal, or NULL. Values from the grid arrive as strings and
 *  the database coerces them to each column's type (works in Postgres & MySQL). */
export function sqlLiteral(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

/** `column = 'value'` / `column <> 'value'` (or `IS [NOT] NULL`) for a WHERE clause. */
export function whereSnippet(
  dialect: DbDialect,
  column: string,
  op: "=" | "<>",
  value: string | null,
): string {
  const id = quoteIdent(dialect, column);
  if (value === null) return `${id} IS ${op === "=" ? "" : "NOT "}NULL`;
  return `${id} ${op} ${sqlLiteral(value)}`;
}

/** A ready-to-run "find rows where this cell matches" query for SQL users. */
export function buildFilterQuery(opts: {
  dialect: DbDialect;
  table: string;
  column: string;
  op: "=" | "<>";
  value: string | null;
  limit: number;
}): string {
  return (
    `SELECT * FROM ${quoteIdent(opts.dialect, opts.table)} ` +
    `WHERE ${whereSnippet(opts.dialect, opts.column, opts.op, opts.value)} ` +
    `LIMIT ${String(Math.max(1, opts.limit))};`
  );
}
