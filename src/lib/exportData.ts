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

/** Pretty-print a string if it parses as JSON, else return it unchanged. Powers
 *  the cell detail viewer's "show formatted JSON" behavior. */
export function prettyMaybeJson(value: string): { text: string; isJson: boolean } {
  const t = value.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), isJson: true };
    } catch {
      /* not JSON after all */
    }
  }
  return { text: value, isJson: false };
}

/** Result rows as a pretty-printed JSON array of objects (Beekeeper-style). */
export function toJson(columns: string[], rows: (string | null)[][]): string {
  const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null])));
  return JSON.stringify(objects, null, 2);
}

/** A single row as a pretty-printed JSON object (for "Copy row as JSON"). */
export function rowToJson(columns: string[], row: (string | null)[]): string {
  return JSON.stringify(Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null])), null, 2);
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
    .map(
      (r) =>
        `INSERT INTO ${tbl} (${cols}) VALUES (${r.map((value) => sqlLiteral(value, dialect)).join(", ")});`,
    )
    .join("\n");
}
