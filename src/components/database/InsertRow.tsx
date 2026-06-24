import { Check, Plus } from "lucide-react";
import { useState } from "react";

import { GRADIENT } from "./constants";

/** A blank-field form to INSERT a new row. Empty fields fall back to defaults. */
export function InsertRow({
  columns,
  onCancel,
  onInsert,
}: {
  columns: string[];
  onCancel: () => void;
  onInsert: (draft: (string | null)[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<(string | null)[]>(() => columns.map(() => ""));
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    void onInsert(draft).finally(() => {
      setSaving(false);
    });
  };

  return (
    <div className="border-b border-line bg-acc/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11.5px]">
        <Plus size={13} className="text-acc" />
        <span className="font-semibold text-ink">New row</span>
        <span className="text-faint">— leave a field blank to use its default</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {columns.map((c, j) => (
          <label key={c} className="flex flex-col gap-0.5">
            <span className="font-mono text-[10.5px] text-faint">{c}</span>
            <input
              value={draft[j] ?? ""}
              spellCheck={false}
              onChange={(e) => {
                setDraft((d) => d.map((x, k) => (k === j ? e.target.value : x)));
              }}
              className="w-40 rounded border border-line bg-panel px-1.5 py-1 font-mono text-[12px] outline-none focus:border-acc"
            />
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="press inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow disabled:opacity-40"
          style={{ background: GRADIENT }}
        >
          <Check size={13} />
          {saving ? "Inserting…" : "Insert"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="press rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-line2 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
