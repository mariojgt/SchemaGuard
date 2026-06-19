#!/usr/bin/env -S npx tsx
/**
 * SchemaGuard MCP server — entry point & command-line control.
 *
 * Exposes the deterministic SchemaGuard engine over the Model Context Protocol
 * so any agent (Claude Desktop, Claude Code, Cursor, VS Code…) can parse,
 * analyze, and generate database schemas.
 *
 * Usage (run via `pnpm mcp <command>` from the repo root):
 *   pnpm mcp                  start the stdio server (default; what clients spawn)
 *   pnpm mcp http [--port N]  run a long-lived HTTP server in the foreground
 *   pnpm mcp start [--port N] start the HTTP server in the background
 *   pnpm mcp stop             stop the background HTTP server
 *   pnpm mcp status           show whether the background server is running
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { startHttp } from "./http.js";
import { buildServer } from "./server.js";

const DEFAULT_PORT = Number(process.env.SCHEMAGUARD_MCP_PORT) || 7331;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const STATE_DIR = resolve(homedir(), ".schemaguard");
const STATE_FILE = resolve(STATE_DIR, "mcp.json");
const LOG_FILE = resolve(STATE_DIR, "mcp.log");

interface State {
  pid: number;
  port: number;
  url: string;
  startedAt: string;
}

function readState(): State | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return null;
  }
}

/** True if a process with this pid is currently alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portFlag(argv: string[]): number {
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1]) return Number(argv[i + 1]);
  return DEFAULT_PORT;
}

async function runStdio() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

async function runHttp(port: number) {
  const { url } = await startHttp(port);
  process.stderr.write(`SchemaGuard MCP server listening on ${url}\n`);
}

function start(port: number) {
  const existing = readState();
  if (existing && alive(existing.pid)) {
    process.stdout.write(`Already running (pid ${String(existing.pid)}) at ${existing.url}\n`);
    return;
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(LOG_FILE, "a");
  const child = spawn("pnpm", ["-s", "mcp", "http", "--port", String(port)], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const url = `http://127.0.0.1:${String(port)}/mcp`;
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ pid: child.pid, port, url, startedAt: new Date().toISOString() }, null, 2),
  );
  process.stdout.write(
    `SchemaGuard MCP server started (pid ${String(child.pid)}) at ${url}\nLogs: ${LOG_FILE}\n`,
  );
}

function stop() {
  const state = readState();
  if (!state || !alive(state.pid)) {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
    process.stdout.write("Not running.\n");
    return;
  }
  try {
    process.kill(state.pid);
  } catch {
    /* already gone */
  }
  rmSync(STATE_FILE, { force: true });
  process.stdout.write(`Stopped (pid ${String(state.pid)}).\n`);
}

function status() {
  const state = readState();
  if (state && alive(state.pid)) {
    process.stdout.write(
      `running\npid:   ${String(state.pid)}\nurl:   ${state.url}\nsince: ${state.startedAt}\n`,
    );
  } else {
    process.stdout.write("stopped\n");
  }
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case undefined:
  case "stdio":
    await runStdio();
    break;
  case "http":
    await runHttp(portFlag(rest));
    break;
  case "start":
    start(portFlag(rest));
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  default:
    process.stderr.write(
      `Unknown command: ${command}\nUse: stdio | http | start | stop | status\n`,
    );
    process.exit(1);
}
