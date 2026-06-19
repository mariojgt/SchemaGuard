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

export function dbQuery(id: string, sql: string): Promise<QueryResult> {
  return invoke<QueryResult>("db_query", { id, sql });
}

/** Run a write (UPDATE/INSERT/DELETE) and return the number of rows affected. */
export function dbExecute(id: string, sql: string): Promise<number> {
  return invoke<number>("db_execute", { id, sql });
}

export function dbTableData(
  id: string,
  table: string,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  return invoke<QueryResult>("db_table_data", { id, table, limit, offset });
}
