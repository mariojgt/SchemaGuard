import { Check, Plus } from "lucide-react";
import { useState } from "react";

import { GRADIENT } from "./constants";
import { isJsonColumnType, jsonValueError } from "./valueEditing";
import { ValueEditor } from "./ValueEditor";

/** A blank-field form to INSERT a new row. Empty fields fall back to defaults. */
export function InsertRow({
  columns,
  columnTypes,
  onCancel,
  onInsert,
}: {
  columns: string[];
  columnTypes?: string[] | undefined;
  onCancel: () => void;
  onInsert: (draft: (string | null)[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<(string | null)[]>(() => columns.map(() => ""));
  const [saving, setSaving] = useState(false);
  const invalidJson = draft.some(
    (value, index) =>
      isJsonColumnType(columnTypes?.[index]) &&
      jsonValueError(value, { allowEmpty: true }) !== null,
  );

  const submit = () => {
    if (invalidJson) return;
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        {columns.map((c, j) => (
          <div
            key={c}
            className={`flex min-w-0 flex-col gap-0.5 ${
              isJsonColumnType(columnTypes?.[j]) ? "md:col-span-2" : ""
            }`}
          >
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
              {c}
              {columnTypes?.[j] && (
                <span className="rounded bg-panel3 px-1 text-[9px] uppercase">
                  {columnTypes[j]}
                </span>
              )}
            </span>
            <ValueEditor
              value={draft[j] ?? ""}
              columnType={columnTypes?.[j]}
              disabled={saving}
              allowEmpty
              onChange={(value) => {
                setDraft((d) => d.map((x, k) => (k === j ? value : x)));
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving || invalidJson}
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
