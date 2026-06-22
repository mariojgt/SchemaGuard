import { invoke } from "@tauri-apps/api/core";

export type DbDialect = "postgres" | "mysql";

export interface ConnInfo {
  dialect: DbDialect;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  rowsAffected: number;
}

/** Live DB connections require the native (Tauri) backend, not the browser. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function dbConnect(info: ConnInfo): Promise<string> {
  return invoke<string>("db_connect", { info });
}

export function dbDisconnect(id: string): Promise<void> {
  return invoke<void>("db_disconnect", { id });
}

export function dbTables(id: string): Promise<string[]> {
  return invoke<string[]>("db_tables", { id });
}

/** List the databases on the connected server (for the database switcher). */
export function dbDatabases(id: string): Promise<string[]> {
  return invoke<string[]>("db_databases", { id });
}

/**
 * Drop one or more tables. When `disableFk` is true the drop ignores foreign-key
 * constraints (MySQL: FOREIGN_KEY_CHECKS off for the operation; Postgres:
 * DROP … CASCADE). Resolves with the number of tables dropped.
 */
export function dbDropTables(
  id: string,
  tables: string[],
  disableFk: boolean,
): Promise<number> {
  return invoke<number>("db_drop_tables", { id, tables, disableFk });
}

export function dbQuery(id: string, sql: string): Promise<QueryResult> {
  return invoke<QueryResult>("db_query", { id, sql });
}

/** Run a write (UPDATE/INSERT/DELETE) and return the number of rows affected. */
export function dbExecute(id: string, sql: string): Promise<number> {
  return invoke<number>("db_execute", { id, sql });
}

/**
 * Run a full multi-statement SQL script (e.g. a dump) against the database on a
 * single connection — like piping a .sql file to `mysql`/`psql`. Resolves with
 * the total rows affected; rejects on the first failing statement.
 *
 * For large files prefer the streamed import (dbImportBegin/Exec/Finish), which
 * never holds the whole script in memory.
 */
export function dbRunScript(id: string, sql: string): Promise<number> {
  return invoke<number>("db_run_script", { id, sql });
}

/** Begin a streamed import session; resolves with an import id. */
export function dbImportBegin(id: string): Promise<string> {
  return invoke<string>("db_import_begin", { id });
}

/** Run one batch of complete statements on the import session's connection. */
export function dbImportExec(importId: string, statements: string[]): Promise<number> {
  return invoke<number>("db_import_exec", { importId, statements });
}

/** End a streamed import, returning the connection to the pool. */
export function dbImportFinish(importId: string): Promise<void> {
  return invoke<void>("db_import_finish", { importId });
}

export function dbTableData(
  id: string,
  table: string,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  return invoke<QueryResult>("db_table_data", { id, table, limit, offset });
}
