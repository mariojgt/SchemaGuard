import type { Column, Schema } from "../ir/types";
import type { ColumnSql, Dialect } from "./dialect";
import { collectTypeWarnings, renderDefault } from "./shared";

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqliteType(column: Column): string {
  const t = column.type;
  switch (t.kind) {
    case "serial":
    case "int":
    case "boolean":
      return "INTEGER";
    case "decimal":
      return "NUMERIC";
    case "float":
    case "double":
      return "REAL";
    case "string":
    case "text":
    case "uuid":
    case "json":
    case "date":
    case "time":
    case "datetime":
    case "timestamptz":
      return "TEXT";
    case "binary":
      return "BLOB";
  }
}

export const sqlite: Dialect = {
  id: "sqlite",
  label: "SQLite",
  ifNotExists: true,
  foreignKeysInline: true,
  quoteIdent: q,
  columnSql(column, isSinglePrimaryKey): ColumnSql {
    // SQLite auto-increment requires `INTEGER PRIMARY KEY AUTOINCREMENT` inline.
    if (column.type.kind === "serial" && isSinglePrimaryKey) {
      return { sql: `${q(column.name)} INTEGER PRIMARY KEY AUTOINCREMENT`, pkInline: true };
    }
    const parts = [q(column.name), sqliteType(column)];
    if (!column.nullable) parts.push("NOT NULL");
    const def = renderDefault(column.default, true);
    if (def !== null) parts.push(`DEFAULT ${def}`);
    if (column.unique) parts.push("UNIQUE");
    return { sql: parts.join(" "), pkInline: false };
  },
  warnings(schema: Schema): string[] {
    return collectTypeWarnings(schema, {
      boolean: "boolean columns are stored as INTEGER (0/1).",
      uuid: "uuid columns are stored as TEXT.",
      json: "json columns are stored as TEXT.",
      datetime: "date/time columns are stored as TEXT.",
      timestamptz: "date/time columns are stored as TEXT.",
      string: "VARCHAR length is not enforced by SQLite.",
    });
  },
};
