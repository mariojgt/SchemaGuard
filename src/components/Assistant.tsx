import { dialectFor, emitDdl, parseSql } from "@schemaguard/core";
import { ArrowUp, Bot, Check, Copy, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { modelOption, PROVIDER_LABELS } from "../lib/ai";
import type { ChatTurn, SceneContext } from "../lib/assistant";
import { runAssistant } from "../lib/assistant";
import { gridLayout } from "../lib/layout";
import { useRecents } from "../stores/recents";
import { useSchemaStore } from "../stores/schema";
import { useSettings } from "../stores/settings";
import { toast } from "../stores/toasts";
import type { AppMode } from "../stores/ui";
import { useUi } from "../stores/ui";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

const SUGGESTIONS: Record<AppMode, string[]> = {
  designer: [
    "Audit my schema's indexing and explain the fixes",
    "Add a comments table with threaded replies",
    "Write a SQL query to find the top 10 customers by total spend",
  ],
  dataflow: [
    "Explain the relationships in the current schema",
    "Which tables have no foreign keys pointing at them?",
  ],
  database: [
    "Write a SQL query for the tables I have open",
    "Convert the current schema to MySQL DDL",
  ],
};

/** Render assistant text, turning ```fenced``` blocks into copyable code. */
function Message({ text }: { text: string }) {
  const parts = text.split(/```(?:\w+)?\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <CodeBlock key={i} code={part.replace(/\n$/, "")} />
        ) : part.trim().length > 0 ? (
          <p key={i} className="whitespace-pre-wrap">
            {part.trim()}
          </p>
        ) : null,
      )}
    </>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-1.5 rounded-lg border border-line bg-panel3">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          });
        }}
        className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[10px] text-dim hover:border-line2"
      >
        {copied ? <Check size={11} color="#3ecf8e" /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-2.5 pr-14 font-mono text-[11.5px] leading-relaxed text-ink">
        {code}
      </pre>
    </div>
  );
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const schema = useSchemaStore((s) => s.schema);
  const target = useSchemaStore((s) => s.target);
  const setTarget = useSchemaStore((s) => s.setTarget);
  const migrations = useSchemaStore((s) => s.migrations);
  const modelInfos = useSchemaStore((s) => s.modelInfos);
  const loadProject = useSchemaStore((s) => s.loadProject);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const setQuery = useUi((s) => s.setQuery);
  const recents = useRecents((s) => s.items);
  const keys = useSettings((s) => s.keys);
  const modelId = useSettings((s) => s.modelId);

  const option = modelOption(modelId);
  const apiKey = keys[option.provider];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const buildScene = (): SceneContext => ({
    mode,
    projectName: schema.name && schema.name.length > 0 ? schema.name : "Untitled",
    targetDialect: target,
    currentSql: emitDdl(schema, dialectFor("postgres"), {}),
    tables: schema.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name) })),
    migrationsCount: migrations.length,
    modelsCount: modelInfos.length,
    recentProjects: recents.map((r) => ({ name: r.name, tableCount: r.tableCount })),
  });

  const actions = {
    applySchema: (sql: string) => {
      const { schema: next, warnings } = parseSql(sql);
      if (next.tables.length === 0) return { error: "No valid tables in the generated SQL." };
      loadProject(next, gridLayout(next));
      return { tableCount: next.tables.length, warnings };
    },
    switchView: (m: AppMode) => {
      setMode(m);
    },
    setDialect: (d: "postgres" | "mysql" | "sqlite") => {
      setTarget(d);
    },
    writeQuery: (sql: string, note: string) => {
      setQuery({ sql, note });
    },
  };

  const run = (prompt: string) => {
    if (prompt.trim().length === 0 || busy) return;
    if (apiKey.trim().length === 0) {
      toast.error(
        `Add your ${PROVIDER_LABELS[option.provider]} API key in Settings to use the assistant.`,
      );
      return;
    }
    const history = messages;
    setInput("");
    // Seed an empty assistant bubble that fills in as the reply streams.
    setMessages((m) => [...m, { role: "user", text: prompt }, { role: "assistant", text: "" }]);
    setBusy(true);

    const onDelta = (textSoFar: string) => {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", text: textSoFar };
        return next;
      });
    };

    void runAssistant(option, apiKey, buildScene(), history, prompt, actions, onDelta)
      .then((reply) => {
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", text: reply.text || "(done)" };
          return next;
        });
        if (reply.appliedToCanvas) toast.success("Updated the schema on the canvas.");
      })
      .catch((err: unknown) => {
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: "assistant",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
          return next;
        });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      {/* floating launcher — present on every page */}
      {!open && (
        <button
          type="button"
          aria-label="Open AI assistant"
          onClick={() => {
            setOpen(true);
          }}
          className="fixed bottom-5 right-5 z-40 grid place-items-center rounded-full text-white shadow-glow transition-transform hover:-translate-y-0.5 active:translate-y-0"
          style={{ background: GRADIENT, height: 52, width: 52 }}
        >
          <Sparkles size={22} strokeWidth={2.2} />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[560px] max-h-[calc(100vh-2.5rem)] w-[400px] max-w-[calc(100vw-2.5rem)] animate-pop flex-col overflow-hidden rounded-2xl border border-line/70 bg-panel shadow-2xl">
          {/* header */}
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-lg text-white"
              style={{ background: GRADIENT }}
            >
              <Bot size={14} />
            </span>
            <span className="text-[13px] font-bold">Assistant</span>
            <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] text-faint">
              {option.label}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${apiKey.trim().length > 0 ? "" : "bg-faint/50"}`}
              style={apiKey.trim().length > 0 ? { background: "#3ecf8e" } : undefined}
              title={apiKey.trim().length > 0 ? "API key set" : "No API key — add it in Settings"}
            />
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                }}
                className="ml-auto text-[11px] text-faint hover:text-ink"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => {
                setOpen(false);
              }}
              className={`grid place-items-center text-faint hover:text-ink ${messages.length > 0 ? "" : "ml-auto"}`}
            >
              <X size={15} />
            </button>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-auto p-3">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-dim">
                  I can see the schema you have open ({schema.tables.length} table
                  {schema.tables.length === 1 ? "" : "s"}) and use SchemaGuard&apos;s tools — parse,
                  review, migration risk, model relations, generate DDL — and edit the canvas.
                </p>
                {apiKey.trim().length === 0 && (
                  <p className="rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
                    Add your {PROVIDER_LABELS[option.provider]} API key in Settings to enable the
                    assistant. Keys stay local.
                  </p>
                )}
                {SUGGESTIONS[mode].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      run(s);
                    }}
                    className="rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12px] hover:border-line2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "assistant" && m.text.length === 0 ? null : (
                <div
                  key={i}
                  className={`max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto border border-acc/30 bg-acc/15"
                      : "border border-line bg-panel2"
                  }`}
                >
                  <Message text={m.text} />
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-dim">
                <Loader2 size={13} className="animate-spin" />
                Working with {option.label}…
              </div>
            )}
          </div>

          {/* composer */}
          <div className="flex flex-none items-end gap-2 border-t border-line p-2.5">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  run(input);
                }
              }}
              placeholder="Ask about your schema, or describe a change…"
              className="h-10 max-h-28 flex-1 resize-none rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] outline-none focus:border-acc"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                run(input);
              }}
              className="grid h-10 w-10 flex-none place-items-center rounded-lg text-white shadow-glow transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:shadow-none"
              style={{ background: GRADIENT }}
            >
              <ArrowUp size={17} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
