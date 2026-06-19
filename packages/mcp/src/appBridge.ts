/**
 * The bridge that lets MCP tools drive a *running* SchemaGuard app in real time.
 *
 * The MCP server is otherwise pure and stateless — but when an agent calls a
 * control tool (apply_schema, write_query, switch_view, set_dialect) we enqueue
 * a command here. The HTTP transport exposes `GET /app/commands`, which the open
 * app polls and drains, applying each command to its live stores. If no app is
 * listening the queue simply caps and drops the oldest, so the control tools are
 * harmless no-ops when nothing is open.
 *
 * This is a module-level singleton: `buildServer()` runs fresh per HTTP request,
 * but this module is imported once per process, so the queue is shared across
 * every tool call and the drain endpoint within the same daemon.
 */
import type { Schema } from "@schemaguard/core";

export type AppCommand =
  | { type: "apply_schema"; schema: Schema; warnings: string[] }
  | { type: "write_query"; sql: string; note: string }
  | { type: "switch_view"; mode: "designer" | "dataflow" | "database" }
  | { type: "set_dialect"; dialect: "postgres" | "mysql" | "sqlite" };

const MAX_QUEUED = 100;
const queue: AppCommand[] = [];

export const appBridge = {
  /** Enqueue a command for the open app to apply on its next poll. */
  push(command: AppCommand): void {
    queue.push(command);
    while (queue.length > MAX_QUEUED) queue.shift();
  },
  /** Take and clear all pending commands (called by the drain endpoint). */
  drain(): AppCommand[] {
    return queue.splice(0, queue.length);
  },
  /** How many commands are waiting (for diagnostics). */
  size(): number {
    return queue.length;
  },
};
