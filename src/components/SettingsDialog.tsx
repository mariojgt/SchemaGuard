import type { DialectId } from "@schemaguard/core";
import { X } from "lucide-react";

import type { Provider } from "../lib/ai";
import { PROVIDER_LABELS } from "../lib/ai";
import { useSchemaStore } from "../stores/schema";
import { useSettings } from "../stores/settings";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

const DIALECTS: { id: DialectId; label: string }[] = [
  { id: "sqlite", label: "SQLite" },
  { id: "mysql", label: "MySQL" },
  { id: "postgres", label: "PostgreSQL" },
];

const KEY_PLACEHOLDERS: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  google: "AIza…",
};

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘K", label: "Command palette" },
  { keys: "⌘S", label: "Save project" },
  { keys: "⌘E", label: "Export SQL" },
  { keys: "⌘Z", label: "Undo" },
  { keys: "⌘⇧Z", label: "Redo" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const target = useSchemaStore((s) => s.target);
  const setTarget = useSchemaStore((s) => s.setTarget);
  const keys = useSettings((s) => s.keys);
  const setKey = useSettings((s) => s.setKey);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[82vh] w-[520px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[14px] font-bold">Settings</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-auto p-4">
          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              Default SQL dialect
            </h4>
            <div className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5 text-[12px]">
              {DIALECTS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setTarget(d.id);
                  }}
                  className={`rounded-md px-3 py-1.5 ${
                    target === d.id ? "font-semibold text-white" : "text-dim"
                  }`}
                  style={target === d.id ? { background: GRADIENT } : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              AI Copilot — API keys
            </h4>
            <div className="flex flex-col gap-2">
              {(["anthropic", "openai", "google"] as const).map((provider) => (
                <label key={provider} className="flex flex-col gap-1">
                  <span className="text-[11px] text-dim">{PROVIDER_LABELS[provider]}</span>
                  <input
                    type="password"
                    value={keys[provider]}
                    onChange={(e) => {
                      setKey(provider, e.target.value);
                    }}
                    placeholder={KEY_PLACEHOLDERS[provider]}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-[12px] outline-none focus:border-acc"
                  />
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-faint">
              Pick the model in the Copilot tab. Keys are stored locally and sent only to the
              provider you choose. Never written to project files.
            </p>
          </section>

          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              Keyboard shortcuts
            </h4>
            <div className="flex flex-col gap-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center text-[12.5px]">
                  <span className="text-dim">{s.label}</span>
                  <span className="ml-auto rounded bg-panel3 px-2 py-0.5 font-mono text-[11px] text-faint">
                    {s.keys}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              About
            </h4>
            <p className="text-[12px] leading-relaxed text-dim">
              SchemaGuard is a local-first schema designer. Your schema is stored in this app and
              never leaves your machine. Theme: dark.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
