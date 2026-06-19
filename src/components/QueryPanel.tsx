import { Check, Copy, Play, Terminal, X } from "lucide-react";
import { useState } from "react";

import { highlightSql } from "../lib/highlightSql";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

/**
 * A floating panel that shows the SQL query the assistant most recently wrote.
 * It sits above the assistant launcher and updates the instant the AI calls
 * `write_query`, so a "create a query" request reflects live. The user can copy
 * it or hand it to the Database workspace to run against a live connection.
 */
export function QueryPanel() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const runInDatabase = useUi((s) => s.runInDatabase);
  const [copied, setCopied] = useState(false);

  if (!query) return null;

  const lines = query.sql.split("\n");

  const copy = () => {
    void navigator.clipboard.writeText(query.sql).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  };

  return (
    <div className="fixed bottom-5 right-[420px] z-40 flex max-h-[60vh] w-[440px] max-w-[calc(100vw-2.5rem)] animate-slideright flex-col overflow-hidden rounded-2xl border border-line/70 bg-panel shadow-2xl">
      <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2.5">
        <span
          className="grid h-6 w-6 place-items-center rounded-lg text-white"
          style={{ background: GRADIENT }}
        >
          <Terminal size={13} />
        </span>
        <span className="text-[13px] font-bold">Query</span>
        {query.note.length > 0 && (
          <span className="truncate text-[11.5px] text-dim" title={query.note}>
            {query.note}
          </span>
        )}
        <button
          type="button"
          aria-label="Dismiss query"
          onClick={() => {
            setQuery(null);
          }}
          className="ml-auto grid place-items-center text-faint hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full font-mono text-[12px] leading-[1.65]">
          <div className="select-none border-r border-line px-3 py-3 text-right text-faint/50">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 whitespace-pre py-3 pl-4 pr-4 text-ink">
            {lines.map((line, i) => (
              <div key={i}>{highlightSql(line)}</div>
            ))}
          </pre>
        </div>
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-line p-2.5">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12px] hover:border-line2"
        >
          {copied ? <Check size={13} color="#3ecf8e" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => {
            runInDatabase(query.sql);
            setQuery(null);
            toast.info("Sent to the Database workspace — connect to run it.");
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow transition-transform hover:-translate-y-px active:translate-y-0"
          style={{ background: GRADIENT }}
        >
          <Play size={13} />
          Run in Database
        </button>
      </div>
    </div>
  );
}
