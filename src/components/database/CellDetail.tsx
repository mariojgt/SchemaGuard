import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

import { prettyMaybeJson } from "../../lib/exportData";

/** A modal showing a single cell's full value — Beekeeper's row/cell viewer. */
export function CellDetail({
  column,
  value,
  onClose,
}: {
  column: string;
  value: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = value === null ? { text: "NULL", isJson: false } : prettyMaybeJson(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-[640px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-mono text-[12.5px] font-semibold">{column}</span>
          {pretty.isJson && (
            <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] text-faint">JSON</span>
          )}
          {value !== null && (
            <span className="text-[11px] tabular-nums text-faint">{value.length} chars</span>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(value ?? "").then(() => {
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                }, 1200);
              });
            }}
            className="press ml-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] hover:border-line2"
          >
            {copied ? <Check size={12} color="#3ecf8e" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {value === null ? (
            <span className="italic text-faint">NULL</span>
          ) : value.length === 0 ? (
            <span className="italic text-faint">(empty string)</span>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
              {pretty.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
