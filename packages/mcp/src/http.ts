/**
 * Streamable-HTTP transport for the SchemaGuard MCP server.
 *
 * Runs a long-lived local HTTP server that any MCP client can connect to by URL
 * (e.g. http://127.0.0.1:7331/mcp) — the counterpart to the stdio transport that
 * clients spawn themselves. Stateless: each request gets a fresh server +
 * transport, which is plenty for SchemaGuard's pure, side-effect-free tools.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { appBridge } from "./appBridge.js";
import { buildServer } from "./server.js";

export const MCP_PATH = "/mcp";
/** The open app polls this to receive and apply live control commands. */
export const APP_COMMANDS_PATH = "/app/commands";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const server = buildServer();
  // No `sessionIdGenerator` → the SDK's stateless mode: a fresh server per
  // request, which suits SchemaGuard's pure, side-effect-free tools.
  const transport = new StreamableHTTPServerTransport({});
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as Parameters<typeof server.connect>[0]);
  await transport.handleRequest(req, res, await readBody(req));
}

/** Start the HTTP MCP server and resolve once it is listening. */
export function startHttp(
  port: number,
  host = "127.0.0.1",
): Promise<{ url: string; close: () => void }> {
  const http = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/health") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ ok: true, server: "schemaguard" }));
      return;
    }
    // The open app polls this to drain pending live-control commands. CORS is
    // open because it's a localhost dev bridge reached from the app's webview.
    if (url.split("?")[0] === APP_COMMANDS_PATH) {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ commands: appBridge.drain() }));
      return;
    }
    if (url.split("?")[0] === MCP_PATH) {
      handleMcp(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Not found. The MCP endpoint is ${MCP_PATH}.` }));
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      resolve({ url: `http://${host}:${String(port)}${MCP_PATH}`, close: () => http.close() });
    });
  });
}
