import type { Schema } from "@schemaguard/core";
import { X } from "lucide-react";

import { useRecents } from "../stores/recents";
import type { Positions } from "../stores/schema";

function relativeTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${String(s)}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return `${String(Math.round(h / 24))}d ago`;
}

export function RecentsDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (schema: Schema, positions: Positions) => void;
}) {
  const items = useRecents((s) => s.items);
  const remove = useRecents((s) => s.remove);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-[520px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[14px] font-bold">Recent projects</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 overflow-auto p-3">
          {items.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-faint">
              No recent projects yet. They're remembered automatically as you work.
            </p>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 hover:border-line2"
            >
              <button
                type="button"
                onClick={() => {
                  onPick(item.schema, item.positions);
                  onClose();
                }}
                className="flex-1 text-left"
              >
                <div className="text-[13px] font-semibold">{item.name}</div>
                <div className="text-[11px] text-faint">
                  {item.tableCount} table{item.tableCount === 1 ? "" : "s"} ·{" "}
                  {relativeTime(item.savedAt)}
                </div>
              </button>
              <button
                type="button"
                title="Remove"
                onClick={() => {
                  remove(item.id);
                }}
                className="grid place-items-center text-faint opacity-0 transition-opacity hover:text-high group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
