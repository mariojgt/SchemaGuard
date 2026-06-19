import { invoke } from "@tauri-apps/api/core";

import { isDesktop } from "./db";

export { isDesktop };

export interface McpStatus {
  running: boolean;
  port: number | null;
  url: string | null;
}

export const DEFAULT_MCP_PORT = 7331;

/** Start the MCP server (HTTP transport) from the desktop backend. */
export function mcpStart(port?: number): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_start", { port: port ?? null });
}

export function mcpStop(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_stop");
}

export function mcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_status");
}

/** A client-config snippet for connecting to the running HTTP server by URL. */
export function httpConfig(client: "claude" | "cursor" | "vscode", url: string): string {
  if (client === "vscode") {
    return JSON.stringify({ servers: { schemaguard: { type: "http", url } } }, null, 2);
  }
  return JSON.stringify({ mcpServers: { schemaguard: { type: "http", url } } }, null, 2);
}

/** A client-config snippet that spawns the stdio server directly (no app needed). */
export function stdioConfig(client: "claude" | "cursor" | "vscode", cwd: string): string {
  const command = "pnpm";
  const args = ["-s", "mcp"];
  if (client === "vscode") {
    return JSON.stringify(
      { servers: { schemaguard: { type: "stdio", command, args, cwd } } },
      null,
      2,
    );
  }
  return JSON.stringify({ mcpServers: { schemaguard: { command, args, cwd } } }, null, 2);
}
