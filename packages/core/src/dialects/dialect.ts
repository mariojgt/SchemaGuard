import type { Column, Schema } from "../ir/types";

export interface ColumnSql {
  /** Full column-definition line, e.g. `"id" BIGSERIAL`. */
  sql: string;
  /** True if this column declared PRIMARY KEY inline (so the emitter skips the table constraint). */
  pkInline: boolean;
}

/**
 * The contract every database dialect implements. The emitter is generic and
 * delegates all dialect-specific decisions here.
 */
export interface Dialect {
  id: "postgres" | "mysql" | "sqlite";
  label: string;
  /** Supports `CREATE TABLE IF NOT EXISTS`. */
  ifNotExists: boolean;
  /** True if foreign keys must be declared inside CREATE TABLE (SQLite) vs. via ALTER. */
  foreignKeysInline: boolean;
  /** Quote/escape an identifier. */
  quoteIdent(name: string): string;
  /** Render a full column definition for this dialect. */
  columnSql(column: Column, isSinglePrimaryKey: boolean): ColumnSql;
  /** Up-front feature-gap notes for this schema (e.g. "uuid stored as CHAR(36)"). */
  warnings(schema: Schema): string[];
}
