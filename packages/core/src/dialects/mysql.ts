import type { Column, IntSize, Schema } from "../ir/types";
import type { ColumnSql, Dialect } from "./dialect";
import { collectTypeWarnings, renderDefault } from "./shared";

function q(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function intType(size: IntSize): string {
  switch (size) {
    case "big":
      return "BIGINT";
    case "small":
      return "SMALLINT";
    case "tiny":
      return "TINYINT";
    case "regular":
      return "INT";
  }
}

function myType(column: Column): string {
  const t = column.type;
  switch (t.kind) {
    case "serial":
    case "int":
      return intType(t.size);
    case "boolean":
      return "TINYINT(1)";
    case "decimal":
      return `DECIMAL(${String(t.precision)}, ${String(t.scale)})`;
    case "float":
      return "FLOAT";
    case "double":
      return "DOUBLE";
    case "string":
      return `VARCHAR(${String(t.length)})`;
    case "text":
      return "TEXT";
    case "uuid":
      return "CHAR(36)";
    case "json":
      return "JSON";
    case "date":
      return "DATE";
    case "time":
      return "TIME";
    case "datetime":
      return "DATETIME";
    case "timestamptz":
      return "TIMESTAMP";
    case "binary":
      return "BLOB";
  }
}

export const mysql: Dialect = {
  id: "mysql",
  label: "MySQL",
  ifNotExists: true,
  foreignKeysInline: false,
  quoteIdent: q,
  columnSql(column): ColumnSql {
    if (column.type.kind === "serial") {
      return {
        sql: [q(column.name), intType(column.type.size), "NOT NULL", "AUTO_INCREMENT"].join(" "),
        pkInline: false,
      };
    }
    const parts = [q(column.name), myType(column)];
    if (!column.nullable) parts.push("NOT NULL");
    const def = renderDefault(column.default, false);
    if (def !== null) parts.push(`DEFAULT ${def}`);
    if (column.unique) parts.push("UNIQUE");
    return { sql: parts.join(" "), pkInline: false };
  },
  warnings(schema: Schema): string[] {
    return collectTypeWarnings(schema, {
      boolean: "boolean columns are emitted as TINYINT(1).",
      uuid: "uuid columns are emitted as CHAR(36) (MySQL has no native UUID).",
      timestamptz: "timestamptz is emitted as TIMESTAMP (MySQL has no timezone-aware type).",
    });
  },
};
