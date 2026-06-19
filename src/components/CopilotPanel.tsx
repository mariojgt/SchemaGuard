import { dialectFor, emitDdl, parseSql } from "@schemaguard/core";
import { ArrowUp } from "lucide-react";
import { useState } from "react";

import { generateSchemaSql, MODEL_OPTIONS, modelOption, PROVIDER_LABELS } from "../lib/ai";
import { gridLayout } from "../lib/layout";
import { useSchemaStore } from "../stores/schema";
import { useSettings } from "../stores/settings";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "Design a SaaS billing schema (users, subscriptions, invoices)",
  "Add a comments table with threaded replies",
  "Add soft deletes to every table",
];

export function CopilotPanel() {
  const schema = useSchemaStore((s) => s.schema);
  const loadProject = useSchemaStore((s) => s.loadProject);
  const keys = useSettings((s) => s.keys);
  const modelId = useSettings((s) => s.modelId);
  const setModelId = useSettings((s) => s.setModelId);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);

  const option = modelOption(modelId);
  const apiKey = keys[option.provider];

  const run = (prompt: string) => {
    if (prompt.trim().length === 0 || busy) return;
    if (apiKey.trim().length === 0) {
      alert(`Add your ${PROVIDER_LABELS[option.provider]} API key in Settings to use this model.`);
      return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setBusy(true);

    const currentSql = emitDdl(schema, dialectFor("postgres"), {});
    void generateSchemaSql(option, apiKey, currentSql, prompt)
      .then((sql) => {
        const { schema: next, warnings } = parseSql(sql);
        if (next.tables.length === 0) {
          setMessages((m) => [
            ...m,
            { role: "assistant", text: "I couldn't produce a valid schema — try rephrasing." },
          ]);
          return;
        }
        loadProject(next, gridLayout(next));
        const note = warnings.length > 0 ? ` Notes: ${warnings.slice(0, 3).join("; ")}` : "";
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Updated the schema — ${String(next.tables.length)} table(s) now on the canvas.${note}`,
          },
        ]);
      })
      .catch((err: unknown) => {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
        ]);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* model picker */}
      <div className="flex h-9 flex-none items-center gap-2 border-b border-line px-3">
        <span className="text-[11px] text-faint">Model</span>
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
          }}
          className="flex-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[12px] outline-none"
        >
          {(["anthropic", "openai", "google"] as const).map((provider) => (
            <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
              {MODEL_OPTIONS.filter((m) => m.provider === provider).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span
          className={`h-2 w-2 rounded-full ${apiKey.trim().length > 0 ? "bg-low" : "bg-faint/50"}`}
          title={apiKey.trim().length > 0 ? "API key set" : "No API key — add it in Settings"}
        />
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-dim">
              Describe what you want to model. The Copilot proposes SQL, which SchemaGuard parses
              and validates before applying.
            </p>
            {apiKey.trim().length === 0 && (
              <p className="rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
                Add your {PROVIDER_LABELS[option.provider]} API key in Settings to enable this
                model. Keys are stored locally and sent only to the provider you choose.
              </p>
            )}
            {SUGGESTIONS.map((s) => (
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
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] ${
              m.role === "user"
                ? "ml-auto border border-acc/30 bg-acc/15"
                : "border border-line bg-panel2"
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-[12px] text-dim">Designing with {option.label}…</div>}
      </div>

      <div className="flex items-end gap-2 border-t border-line p-3">
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
          placeholder="Describe a change…"
          className="h-11 flex-1 resize-none rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] outline-none focus:border-acc"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            run(input);
          }}
          className="grid h-11 w-11 place-items-center rounded-lg text-white shadow-glow transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:shadow-none"
          style={{ background: "linear-gradient(135deg,#ff3fa4,#a64bff)" }}
        >
          <ArrowUp size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
