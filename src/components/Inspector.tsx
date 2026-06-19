import { ArrowRight, Plus, Table2, Trash2, X } from "lucide-react";
import { useState } from "react";

import { presetIdForType, TYPE_PRESETS } from "../lib/typePresets";
import { useSchemaStore } from "../stores/schema";

export function Inspector() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTable = useSchemaStore((s) => s.selectedTable);
  const renameTable = useSchemaStore((s) => s.renameTable);
  const deleteTable = useSchemaStore((s) => s.deleteTable);
  const addColumn = useSchemaStore((s) => s.addColumn);
  const updateColumn = useSchemaStore((s) => s.updateColumn);
  const deleteColumn = useSchemaStore((s) => s.deleteColumn);
  const togglePrimaryKey = useSchemaStore((s) => s.togglePrimaryKey);
  const addForeignKey = useSchemaStore((s) => s.addForeignKey);
  const deleteForeignKey = useSchemaStore((s) => s.deleteForeignKey);
  const addTable = useSchemaStore((s) => s.addTable);
  const selectTable = useSchemaStore((s) => s.selectTable);

  const table = selectedTable ? schema.tables.find((t) => t.name === selectedTable) : undefined;

  if (!table) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[13px] text-dim">Select a table to edit it,</p>
        <button
          type="button"
          onClick={addTable}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] hover:border-line2"
        >
          <Plus size={14} />
          Add a table
        </button>
      </div>
    );
  }

  const otherTables = schema.tables.filter((t) => t.name !== table.name);

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-[18px] w-[18px] place-items-center rounded bg-acc text-[#190a14]">
          <Table2 size={12} strokeWidth={2.5} />
        </span>
        <input
          key={table.name}
          defaultValue={table.name}
          onBlur={(e) => {
            renameTable(table.name, e.target.value);
          }}
          className="flex-1 rounded bg-transparent px-1 py-0.5 text-[13.5px] font-bold outline-none focus:bg-panel2"
        />
        <button
          type="button"
          title="Delete table"
          onClick={() => {
            deleteTable(table.name);
          }}
          className="grid place-items-center rounded-md border border-line px-2 py-1 text-high hover:border-high/50"
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => {
            selectTable(null);
          }}
          className="grid place-items-center rounded-md px-2 py-1 text-faint hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {/* columns */}
        <div className="mb-2 flex items-center">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-faint">Columns</h4>
          <button
            type="button"
            onClick={() => {
              addColumn(table.name);
            }}
            className="ml-auto grid h-[22px] w-[22px] place-items-center rounded-md border border-line bg-panel2 text-dim hover:border-line2"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {table.columns.map((col, i) => {
            const isPk = (table.primaryKey ?? []).includes(col.name);
            return (
              <div key={i} className="rounded-lg border border-line bg-panel2 p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    defaultValue={col.name}
                    key={col.name}
                    onBlur={(e) => {
                      updateColumn(table.name, i, { name: e.target.value.trim() || col.name });
                    }}
                    className="min-w-0 flex-1 rounded bg-panel3 px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-acc"
                  />
                  <button
                    type="button"
                    title="Toggle primary key"
                    onClick={() => {
                      togglePrimaryKey(table.name, col.name);
                    }}
                    className={`rounded px-1.5 py-1 text-[9px] font-extrabold ${
                      isPk ? "bg-acc/20 text-acc" : "bg-panel3 text-faint"
                    }`}
                  >
                    PK
                  </button>
                  <button
                    type="button"
                    title="Delete column"
                    onClick={() => {
                      deleteColumn(table.name, i);
                    }}
                    className="grid place-items-center rounded px-1.5 py-1 text-faint hover:text-high"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <select
                    value={presetIdForType(col.type)}
                    onChange={(e) => {
                      const preset = TYPE_PRESETS.find((p) => p.id === e.target.value);
                      if (preset) updateColumn(table.name, i, { type: preset.type });
                    }}
                    className="flex-1 rounded bg-panel3 px-2 py-1 font-mono text-[11px] text-dim outline-none"
                  >
                    {TYPE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-dim">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      onChange={(e) => {
                        updateColumn(table.name, i, { nullable: e.target.checked });
                      }}
                    />
                    null
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-dim">
                    <input
                      type="checkbox"
                      checked={col.unique ?? false}
                      onChange={(e) => {
                        updateColumn(table.name, i, { unique: e.target.checked });
                      }}
                    />
                    unique
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* foreign keys */}
        <h4 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wider text-faint">
          Foreign keys
        </h4>
        <div className="flex flex-col gap-2">
          {table.foreignKeys.map((fk, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11.5px] text-dim"
            >
              <span>
                <b className="text-ink">{fk.columns.join(", ")}</b>
                <ArrowRight size={11} className="mx-1 inline align-[-1px] text-acc2" />
                <b className="text-ink">
                  {fk.refTable}.{fk.refColumns.join(", ")}
                </b>
                {fk.onDelete ? <span className="text-faint"> · {fk.onDelete}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  deleteForeignKey(table.name, i);
                }}
                className="ml-auto grid place-items-center text-faint hover:text-high"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {otherTables.length > 0 && (
            <ForeignKeyAdder
              columns={table.columns.map((c) => c.name)}
              tables={otherTables.map((t) => ({
                name: t.name,
                columns: t.columns.map((c) => c.name),
              }))}
              onAdd={(localCol, refTable, refCol) => {
                addForeignKey(table.name, localCol, refTable, refCol);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface AdderProps {
  columns: string[];
  tables: { name: string; columns: string[] }[];
  onAdd: (localColumn: string, refTable: string, refColumn: string) => void;
}

function ForeignKeyAdder({ columns, tables, onAdd }: AdderProps) {
  const [localCol, setLocalCol] = useState(columns[0] ?? "");
  const [refTable, setRefTable] = useState(tables[0]?.name ?? "");
  const refCols = tables.find((t) => t.name === refTable)?.columns ?? [];
  const [refCol, setRefCol] = useState(refCols[0] ?? "");

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line2 p-2 text-[11px]">
      <select
        value={localCol}
        onChange={(e) => {
          setLocalCol(e.target.value);
        }}
        className="rounded bg-panel3 px-1.5 py-1 outline-none"
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <ArrowRight size={12} className="flex-none text-acc2" />
      <select
        value={refTable}
        onChange={(e) => {
          setRefTable(e.target.value);
          const next = tables.find((t) => t.name === e.target.value)?.columns ?? [];
          setRefCol(next[0] ?? "");
        }}
        className="rounded bg-panel3 px-1.5 py-1 outline-none"
      >
        {tables.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        value={refCol}
        onChange={(e) => {
          setRefCol(e.target.value);
        }}
        className="rounded bg-panel3 px-1.5 py-1 outline-none"
      >
        {refCols.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!localCol || !refTable || !refCol}
        onClick={() => {
          onAdd(localCol, refTable, refCol);
        }}
        className="ml-auto inline-flex items-center gap-1 rounded border border-line bg-panel2 px-2 py-1 font-semibold text-ink hover:border-line2 disabled:opacity-40"
      >
        <Plus size={12} />
        Add FK
      </button>
    </div>
  );
}
