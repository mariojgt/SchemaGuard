import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import type { QueryResult } from "../../lib/db";

export function ResultGrid({
  result,
  sort,
  onSort,
  pkColumns,
  onSaveRow,
  onDeleteRow,
  onCellMenu,
  onCellClick,
}: {
  result: QueryResult;
  sort?: { col: string; dir: "asc" | "desc" } | null;
  onSort?: (col: string) => void;
  pkColumns?: string[];
  onSaveRow?: (original: (string | null)[], next: (string | null)[]) => Promise<boolean>;
  onDeleteRow?: (row: (string | null)[]) => Promise<boolean>;
  onCellMenu?: (
    e: React.MouseEvent,
    column: string,
    value: string | null,
    row: (string | null)[],
  ) => void;
  onCellClick?: (column: string, value: string | null) => void;
}) {
  const editable = !!onSaveRow && (pkColumns?.length ?? 0) > 0;
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [draft, setDraft] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);

  if (result.columns.length === 0) {
    return (
      <div className="p-4 text-[12px] text-dim">{result.rowsAffected} row(s). No columns.</div>
    );
  }

  const startEdit = (i: number) => {
    const r = result.rows[i];
    if (!r) return;
    setEditing(i);
    setDraft([...r]);
  };

  const save = async (original: (string | null)[]) => {
    if (!onSaveRow) return;
    setSaving(true);
    const ok = await onSaveRow(original, draft);
    setSaving(false);
    if (ok) setEditing(null);
  };

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0">
        <tr>
          {editable && <th className="w-px border-b border-line bg-panel2" />}
          {result.columns.map((c) => (
            <th
              key={c}
              className="border-b border-line bg-panel2 px-3 py-1.5 text-left font-semibold text-dim"
            >
              {onSort ? (
                <button
                  type="button"
                  onClick={() => {
                    onSort(c);
                  }}
                  className="inline-flex items-center gap-1 hover:text-ink"
                  title="Sort by this column"
                >
                  {c}
                  <span className="text-acc">
                    {sort?.col === c ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                  </span>
                </button>
              ) : (
                c
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => {
          const isEdit = editing === i;
          return (
            <tr key={i} className={isEdit ? "bg-acc/5" : "hover:bg-panel2/60"}>
              {editable && (
                <td className="border-b border-line/50 px-2 py-1 align-top">
                  {isEdit ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Save row"
                        disabled={saving}
                        onClick={() => {
                          void save(row);
                        }}
                        className="grid h-6 w-6 place-items-center rounded bg-acc/20 text-acc hover:bg-acc/30 disabled:opacity-40"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Cancel"
                        disabled={saving}
                        onClick={() => {
                          setEditing(null);
                        }}
                        className="grid h-6 w-6 place-items-center rounded border border-line hover:border-line2 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : confirmDelete === i ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Confirm delete"
                        disabled={saving}
                        onClick={() => {
                          if (!onDeleteRow) return;
                          setSaving(true);
                          void onDeleteRow(row).finally(() => {
                            setSaving(false);
                            setConfirmDelete(null);
                          });
                        }}
                        className="grid h-6 w-6 place-items-center rounded bg-crit/20 text-crit hover:bg-crit/30 disabled:opacity-40"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Cancel"
                        disabled={saving}
                        onClick={() => {
                          setConfirmDelete(null);
                        }}
                        className="grid h-6 w-6 place-items-center rounded border border-line hover:border-line2 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Edit row"
                        onClick={() => {
                          startEdit(i);
                        }}
                        className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-panel2 hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      {onDeleteRow && (
                        <button
                          type="button"
                          title="Delete row"
                          onClick={() => {
                            setConfirmDelete(i);
                          }}
                          className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-crit/15 hover:text-crit"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              )}
              {row.map((cell, j) => (
                <td
                  key={j}
                  onClick={
                    onCellClick && !isEdit
                      ? () => {
                          onCellClick(result.columns[j] ?? "", cell);
                        }
                      : undefined
                  }
                  onContextMenu={
                    onCellMenu && !isEdit
                      ? (e) => {
                          onCellMenu(e, result.columns[j] ?? "", cell, row);
                        }
                      : undefined
                  }
                  title={onCellClick && !isEdit ? "Click to view full value" : undefined}
                  className={`max-w-[360px] border-b border-line/50 px-3 py-1.5 font-mono ${isEdit ? "" : "cursor-pointer truncate"}`}
                >
                  {isEdit ? (
                    <CellEditor
                      value={draft[j] ?? null}
                      disabled={saving}
                      onChange={(v) => {
                        setDraft((d) => d.map((x, k) => (k === j ? v : x)));
                      }}
                    />
                  ) : cell === null ? (
                    <span className="italic text-faint">NULL</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CellEditor({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] italic text-faint">NULL</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange("");
          }}
          className="text-[10px] text-acc2 hover:underline disabled:opacity-40"
        >
          set value
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-full min-w-[90px] rounded border border-line bg-panel px-1.5 py-0.5 text-[12px] outline-none focus:border-acc disabled:opacity-50"
      />
      <button
        type="button"
        title="Set NULL"
        disabled={disabled}
        onClick={() => {
          onChange(null);
        }}
        className="flex-none rounded px-1 text-[11px] text-faint hover:text-ink disabled:opacity-40"
      >
        ∅
      </button>
    </div>
  );
}
