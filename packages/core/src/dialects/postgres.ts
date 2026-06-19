import type { Column, IntSize } from "../ir/types";
import type { ColumnSql, Dialect } from "./dialect";
import { renderDefault } from "./shared";

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function intType(size: IntSize): string {
  switch (size) {
    case "big":
      return "BIGINT";
    case "small":
    case "tiny":
      return "SMALLINT";
    case "regular":
      return "INTEGER";
  }
}

function serialType(size: IntSize): string {
  switch (size) {
    case "big":
      return "BIGSERIAL";
    case "small":
    case "tiny":
      return "SMALLSERIAL";
    case "regular":
      return "SERIAL";
  }
}

function pgType(column: Column): string {
  const t = column.type;
  switch (t.kind) {
    case "serial":
      return serialType(t.size);
    case "int":
      return intType(t.size);
    case "boolean":
      return "BOOLEAN";
    case "decimal":
      return `NUMERIC(${String(t.precision)}, ${String(t.scale)})`;
    case "float":
      return "REAL";
    case "double":
      return "DOUBLE PRECISION";
    case "string":
      return `VARCHAR(${String(t.length)})`;
    case "text":
      return "TEXT";
    case "uuid":
      return "UUID";
    case "json":
      return "JSONB";
    case "date":
      return "DATE";
    case "time":
      return "TIME";
    case "datetime":
      return "TIMESTAMP";
    case "timestamptz":
      return "TIMESTAMPTZ";
    case "binary":
      return "BYTEA";
  }
}

export const postgres: Dialect = {
  id: "postgres",
  label: "PostgreSQL",
  ifNotExists: true,
  foreignKeysInline: false,
  quoteIdent: q,
  columnSql(column): ColumnSql {
    const parts = [q(column.name), pgType(column)];
    if (!column.nullable) parts.push("NOT NULL");
    const def = renderDefault(column.default, false);
    if (def !== null) parts.push(`DEFAULT ${def}`);
    if (column.unique) parts.push("UNIQUE");
    return { sql: parts.join(" "), pkInline: false };
  },
  warnings: () => [],
};
