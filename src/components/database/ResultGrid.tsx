import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import type { QueryResult } from "../../lib/db";
import { RowEditor } from "./RowEditor";
import { isJsonColumnType } from "./valueEditing";

export function ResultGrid({
  result,
  tableName,
  sort,
  onSort,
  pkColumns,
  onSaveRow,
  onDeleteRow,
  onCellMenu,
  onCellClick,
}: {
  result: QueryResult;
  tableName?: string | undefined;
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
  const [deleting, setDeleting] = useState(false);

  if (result.columns.length === 0) {
    return (
      <div className="p-4 text-[12px] text-dim">{result.rowsAffected} row(s). No columns.</div>
    );
  }

  const editingRow = editing === null ? undefined : result.rows[editing];

  return (
    <>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {editable && (
              <th className="sticky left-0 z-20 w-px border-b border-r border-line bg-panel2 px-2 py-2 text-left">
                <span className="sr-only">Row actions</span>
              </th>
            )}
            {result.columns.map((column, index) => (
              <th
                key={column}
                className="border-b border-line bg-panel2 px-3 py-2 text-left font-semibold text-dim"
              >
                <div className="flex items-center gap-1.5">
                  {onSort ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSort(column);
                      }}
                      className="inline-flex items-center gap-1 hover:text-ink"
                      title="Sort by this column"
                    >
                      {column}
                      <span className="text-acc">
                        {sort?.col === column ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                      </span>
                    </button>
                  ) : (
                    column
                  )}
                  {result.columnTypes?.[index] && (
                    <span
                      className={`rounded px-1 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide ${
                        isJsonColumnType(result.columnTypes[index])
                          ? "bg-acc2/15 text-acc2"
                          : "bg-panel3 text-faint"
                      }`}
                    >
                      {result.columnTypes[index]}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="group hover:bg-panel2/60">
              {editable && (
                <td className="sticky left-0 z-[5] w-px border-b border-r border-line/50 bg-panel px-2 py-1 align-middle group-hover:bg-panel2">
                  {confirmDelete === rowIndex ? (
                    <div className="flex gap-1" aria-label="Confirm row deletion">
                      <button
                        type="button"
                        title="Confirm delete"
                        disabled={deleting}
                        onClick={() => {
                          if (!onDeleteRow) return;
                          setDeleting(true);
                          void onDeleteRow(row).finally(() => {
                            setDeleting(false);
                            setConfirmDelete(null);
                          });
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md bg-crit/20 text-crit hover:bg-crit/30 disabled:opacity-40"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Cancel delete"
                        disabled={deleting}
                        onClick={() => {
                          setConfirmDelete(null);
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md border border-line hover:border-line2 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Edit row"
                        aria-label={`Edit row ${String(rowIndex + 1)}`}
                        onClick={() => {
                          setConfirmDelete(null);
                          setEditing(rowIndex);
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-acc/15 hover:text-acc"
                      >
                        <Pencil size={12} />
                      </button>
                      {onDeleteRow && (
                        <button
                          type="button"
                          title="Delete row"
                          aria-label={`Delete row ${String(rowIndex + 1)}`}
                          onClick={() => {
                            setConfirmDelete(rowIndex);
                          }}
                          className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-crit/15 hover:text-crit"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              )}
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  onClick={
                    onCellClick
                      ? () => {
                          onCellClick(result.columns[cellIndex] ?? "", cell);
                        }
                      : undefined
                  }
                  onContextMenu={
                    onCellMenu
                      ? (event) => {
                          onCellMenu(event, result.columns[cellIndex] ?? "", cell, row);
                        }
                      : undefined
                  }
                  title={onCellClick ? "Click to view full value" : undefined}
                  className={`max-w-[360px] truncate border-b border-line/50 px-3 py-1.5 font-mono ${
                    onCellClick ? "cursor-pointer" : ""
                  }`}
                >
                  {cell === null ? <span className="italic text-faint">NULL</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {editingRow && onSaveRow && (
        <RowEditor
          tableName={tableName}
          columns={result.columns}
          columnTypes={result.columnTypes}
          pkColumns={pkColumns}
          original={editingRow}
          onCancel={() => {
            setEditing(null);
          }}
          onSave={(next) => onSaveRow(editingRow, next)}
        />
      )}
    </>
  );
}
