import { Check, Copy, Loader2, Plug, Power, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DEFAULT_MCP_PORT,
  httpConfig,
  isDesktop,
  mcpStart,
  type McpStatus,
  mcpStatus,
  mcpStop,
  stdioConfig,
} from "../lib/mcp";
import { toast } from "../stores/toasts";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

type ClientId = "claude" | "claude-code" | "cursor" | "vscode";

const CLIENTS: { id: ClientId; label: string; file: string }[] = [
  { id: "claude", label: "Claude Desktop", file: "claude_desktop_config.json" },
  { id: "claude-code", label: "Claude Code", file: ".mcp.json (project root)" },
  { id: "cursor", label: "Cursor", file: ".cursor/mcp.json" },
  { id: "vscode", label: "VS Code", file: ".vscode/mcp.json" },
];

// Claude Code and Claude Desktop share the `mcpServers` config shape.
const configShape = (id: ClientId): "claude" | "cursor" | "vscode" =>
  id === "vscode" ? "vscode" : id === "cursor" ? "cursor" : "claude";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1200);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 text-[11px] hover:border-line2"
    >
      {copied ? <Check size={12} color="#3ecf8e" /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function McpDialog({ onClose }: { onClose: () => void }) {
  const desktop = isDesktop();
  const [status, setStatus] = useState<McpStatus>({ running: false, port: null, url: null });
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<ClientId>("claude");
  const [mode, setMode] = useState<"http" | "stdio">("stdio");

  // On open, ask the backend whether the server is already running.
  useEffect(() => {
    if (!desktop) return;
    void mcpStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, [desktop]);

  // Prefer the HTTP (URL) snippet once the in-app server is up.
  useEffect(() => {
    if (status.running) setMode("http");
  }, [status.running]);

  const toggle = () => {
    setBusy(true);
    const action = status.running ? mcpStop() : mcpStart();
    void action
      .then((s) => {
        setStatus(s);
        toast.success(s.running ? `MCP server running at ${s.url ?? ""}` : "MCP server stopped");
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const url = status.url ?? `http://127.0.0.1:${String(DEFAULT_MCP_PORT)}/mcp`;
  const shape = configShape(client);
  const snippet =
    mode === "http" ? httpConfig(shape, url) : stdioConfig(shape, "/path/to/SchemaGuard");
  const activeClient = CLIENTS.find((c) => c.id === client);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[86vh] w-[600px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Plug size={15} className="text-acc" />
          <span className="text-[14px] font-bold">MCP Server</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-auto p-4">
          <p className="text-[12.5px] leading-relaxed text-dim">
            The MCP server exposes SchemaGuard&apos;s engine — parse schemas, find design smells,
            assess migration risk, read Eloquent models, generate DDL — to any AI tool that speaks{" "}
            the Model Context Protocol.
          </p>

          {/* Start / stop control (desktop app only) */}
          <section className="rounded-lg border border-line bg-panel2 p-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${status.running ? "" : "bg-faint"}`}
                style={
                  status.running
                    ? { background: "#3ecf8e", boxShadow: "0 0 8px #3ecf8e" }
                    : undefined
                }
              />
              <div className="flex flex-col">
                <span className="text-[12.5px] font-semibold">
                  {status.running ? "Running" : "Stopped"}
                </span>
                {status.running && status.url && (
                  <span className="font-mono text-[11px] text-faint">{status.url}</span>
                )}
              </div>
              {desktop ? (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  style={{ background: status.running ? "#ff6b6b" : GRADIENT }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                  {status.running ? "Stop" : "Start"}
                </button>
              ) : (
                <span className="ml-auto text-[11px] text-faint">
                  Open the desktop app to start it here
                </span>
              )}
            </div>
            {desktop && (
              <p className="mt-2 text-[11px] text-faint">
                Or from a terminal: <span className="font-mono text-dim">pnpm mcp:start</span> ·{" "}
                <span className="font-mono text-dim">pnpm mcp:stop</span> ·{" "}
                <span className="font-mono text-dim">pnpm mcp:status</span>
              </p>
            )}
          </section>

          {/* Tutorial: connect a client */}
          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              Connect your AI tool
            </h4>

            <div className="mb-2 flex flex-wrap gap-1">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClient(c.id);
                  }}
                  className={`rounded-md px-2.5 py-1 text-[12px] ${
                    client === c.id
                      ? "font-semibold text-white"
                      : "border border-line bg-panel2 text-dim"
                  }`}
                  style={client === c.id ? { background: GRADIENT } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="mb-2 flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  setMode("stdio");
                }}
                className={`flex-1 rounded-md px-3 py-1.5 ${
                  mode === "stdio" ? "bg-panel3 font-semibold text-ink" : "text-dim"
                }`}
              >
                Standalone (no app)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("http");
                }}
                className={`flex-1 rounded-md px-3 py-1.5 ${
                  mode === "http" ? "bg-panel3 font-semibold text-ink" : "text-dim"
                }`}
              >
                Via running server (URL)
              </button>
            </div>

            <ol className="mb-2 list-decimal space-y-1 pl-4 text-[12px] text-dim">
              {mode === "http" ? (
                <>
                  <li>
                    Click <span className="font-semibold text-ink">Start</span> above (or run{" "}
                    <span className="font-mono">pnpm mcp:start</span>).
                  </li>
                  <li>
                    Add this to <span className="font-mono text-ink">{activeClient?.file}</span>:
                  </li>
                </>
              ) : (
                <>
                  <li>No need to start anything — the client launches the server on demand.</li>
                  <li>
                    Add this to <span className="font-mono text-ink">{activeClient?.file}</span>,
                    replacing <span className="font-mono">/path/to/SchemaGuard</span> with this
                    project&apos;s folder:
                  </li>
                </>
              )}
            </ol>

            <div className="relative rounded-lg border border-line bg-panel3 p-3">
              <div className="absolute right-2 top-2">
                <CopyButton text={snippet} />
              </div>
              <pre className="overflow-x-auto pr-16 font-mono text-[11.5px] leading-relaxed text-ink">
                {snippet}
              </pre>
            </div>

            <p className="mt-2 text-[11px] text-faint">
              {client === "claude"
                ? "Claude Desktop → Settings → Developer → Edit Config. Restart Claude after saving."
                : client === "claude-code"
                  ? "Claude Code reads .mcp.json from the project root automatically. Run /mcp to confirm it connected."
                  : client === "cursor"
                    ? "Cursor → Settings → MCP, or commit .cursor/mcp.json to the repo."
                    : "VS Code (Copilot agent mode) reads .vscode/mcp.json. Reload the window after saving."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
