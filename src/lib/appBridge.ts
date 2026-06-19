/**
 * Client side of the MCP → app bridge.
 *
 * Polls the running MCP HTTP server's `/app/commands` endpoint and applies each
 * command to the live stores, so an external MCP agent (Claude Code, Cursor, …)
 * can drive this app in real time — the same actions the in-app assistant has.
 *
 * Cadence is health-gated to stay quiet when no server is running: a slow
 * `/health` probe until the server answers, then fast command polling while it
 * does, dropping back to slow probing the moment it goes away.
 */
import type { Schema } from "@schemaguard/core";

import { useSchemaStore } from "../stores/schema";
import { toast } from "../stores/toasts";
import type { AppMode } from "../stores/ui";
import { useUi } from "../stores/ui";
import { gridLayout } from "./layout";
import { DEFAULT_MCP_PORT } from "./mcp";

type AppCommand =
  | { type: "apply_schema"; schema: Schema; warnings: string[] }
  | { type: "write_query"; sql: string; note: string }
  | { type: "switch_view"; mode: AppMode }
  | { type: "set_dialect"; dialect: "postgres" | "mysql" | "sqlite" };

const BASE = `http://127.0.0.1:${String(DEFAULT_MCP_PORT)}`;
const HEALTH_INTERVAL = 8000;
const POLL_INTERVAL = 1000;

function applyCommand(c: AppCommand): void {
  const schema = useSchemaStore.getState();
  const ui = useUi.getState();
  switch (c.type) {
    case "apply_schema":
      schema.loadProject(c.schema, gridLayout(c.schema));
      toast.success(
        `AI updated the schema · ${String(c.schema.tables.length)} table${
          c.schema.tables.length === 1 ? "" : "s"
        }`,
      );
      break;
    case "write_query":
      ui.setQuery({ sql: c.sql, note: c.note });
      break;
    case "switch_view":
      ui.setMode(c.mode);
      break;
    case "set_dialect":
      schema.setTarget(c.dialect);
      break;
  }
}

/**
 * Begin bridging MCP commands into this app. Returns a stop function. Safe to
 * call when no server is running — it just keeps probing health quietly.
 */
export function startAppBridge(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let healthy = false;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (!healthy) {
        const h = await fetch(`${BASE}/health`);
        healthy = h.ok;
        schedule(healthy ? POLL_INTERVAL : HEALTH_INTERVAL);
        return;
      }
      const res = await fetch(`${BASE}/app/commands`);
      if (!res.ok) throw new Error(`status ${String(res.status)}`);
      const data = (await res.json()) as { commands?: AppCommand[] };
      for (const command of data.commands ?? []) applyCommand(command);
      schedule(POLL_INTERVAL);
    } catch {
      // Server went away (or never started) — fall back to slow health probes.
      healthy = false;
      schedule(HEALTH_INTERVAL);
    }
  };

  schedule(POLL_INTERVAL);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
