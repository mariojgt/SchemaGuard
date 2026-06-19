/**
 * Export a query result (or browsed table) to CSV or SQL INSERT statements —
 * the phpMyAdmin "Export" staples. Pure string builders so they're easy to test
 * and reuse; the caller hands the text to a download helper.
 */
import { quoteIdent, sqlLiteral } from "./browseQuery";
import type { DbDialect } from "./db";

/** RFC-4180-ish CSV: quote fields containing quotes, commas, or newlines. */
export function toCsv(columns: string[], rows: (string | null)[][]): string {
  const cell = (v: string | null): string => {
    if (v === null) return "";
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const head = columns.map(cell).join(",");
  const body = rows.map((r) => r.map(cell).join(",")).join("\n");
  return body.length > 0 ? `${head}\n${body}` : head;
}

/** A batch of INSERT statements that recreate these rows in `table`. */
export function toSqlInserts(
  dialect: DbDialect,
  table: string,
  columns: string[],
  rows: (string | null)[][],
): string {
  if (rows.length === 0) return `-- no rows to export from ${table}`;
  const tbl = quoteIdent(dialect, table);
  const cols = columns.map((c) => quoteIdent(dialect, c)).join(", ");
  return rows
    .map((r) => `INSERT INTO ${tbl} (${cols}) VALUES (${r.map(sqlLiteral).join(", ")});`)
    .join("\n");
}
