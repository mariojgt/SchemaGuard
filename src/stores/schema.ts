import type {
  Column,
  DialectId,
  MigrationEntry,
  ModelInfo,
  ModelRelation,
  Schema,
  SmellFix,
  Table,
} from "@schemaguard/core";
import { sampleSchema } from "@schemaguard/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface XY {
  x: number;
  y: number;
}
export type Positions = Record<string, XY>;

interface Snapshot {
  schema: Schema;
  positions: Positions;
}

interface SchemaState {
  schema: Schema;
  positions: Positions;
  target: DialectId;
  selectedTable: string | null;
  past: Snapshot[];
  future: Snapshot[];

  // Migration history (timeline) — populated by importing a migrations folder.
  migrations: MigrationEntry[];
  migrationSnapshots: Schema[];
  currentMigration: number; // index into migrations being viewed; -1 = none

  // Eloquent relationships parsed from a models folder, plus the set of model
  // names whose relations are currently overlaid on the diagram.
  modelRelations: ModelRelation[];
  shownRelationModels: string[];
  // Per-model metadata (fillable, casts, timestamps…) for the insights panel.
  modelInfos: ModelInfo[];

  setTarget: (target: DialectId) => void;
  selectTable: (name: string | null) => void;
  setNodePosition: (name: string, pos: XY) => void;
  arrange: (positions: Positions) => void;

  newProject: () => void;
  loadProject: (schema: Schema, positions?: Positions) => void;
  loadHistory: (
    data: {
      migrations: MigrationEntry[];
      snapshots: Schema[];
      finalSchema: Schema;
      modelRelations?: ModelRelation[];
      modelInfos?: ModelInfo[];
    },
    positions: Positions,
  ) => void;
  loadFullProject: (data: {
    schema: Schema;
    positions: Positions;
    migrations?: MigrationEntry[];
    migrationSnapshots?: Schema[];
    currentMigration?: number;
    modelRelations?: ModelRelation[];
    shownRelationModels?: string[];
    modelInfos?: ModelInfo[];
  }) => void;
  viewMigration: (index: number) => void;
  toggleRelationModel: (model: string) => void;
  setShownRelationModels: (models: string[]) => void;

  addTable: () => void;
  renameTable: (oldName: string, newName: string) => void;
  deleteTable: (name: string) => void;
  addColumn: (table: string) => void;
  updateColumn: (table: string, index: number, patch: Partial<Column>) => void;
  deleteColumn: (table: string, index: number) => void;
  togglePrimaryKey: (table: string, column: string) => void;
  addForeignKey: (table: string, column: string, refTable: string, refColumn: string) => void;
  deleteForeignKey: (table: string, index: number) => void;
  applyFix: (fix: SmellFix) => void;

  undo: () => void;
  redo: () => void;
}

function uniqueTableName(schema: Schema, base: string): string {
  const taken = new Set(schema.tables.map((t) => t.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

function uniqueColumnName(table: Table, base: string): string {
  const taken = new Set(table.columns.map((c) => c.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

interface Draft {
  schema: Schema;
  positions: Positions;
  selectedTable: string | null;
}

export const useSchemaStore = create<SchemaState>()(
  persist(
    (set) => {
      // Every structural edit clones, mutates, and pushes an undo snapshot.
      const commit = (recipe: (draft: Draft) => void): void =>
        set((s) => {
          const past = [...s.past, { schema: s.schema, positions: s.positions }].slice(-100);
          const draft: Draft = {
            schema: structuredClone(s.schema),
            positions: { ...s.positions },
            selectedTable: s.selectedTable,
          };
          recipe(draft);
          return {
            schema: draft.schema,
            positions: draft.positions,
            selectedTable: draft.selectedTable,
            past,
            future: [],
          };
        });

      const find = (schema: Schema, name: string): Table | undefined =>
        schema.tables.find((t) => t.name === name);

      return {
        schema: sampleSchema,
        positions: {},
        target: "postgres",
        selectedTable: null,
        past: [],
        future: [],
        migrations: [],
        migrationSnapshots: [],
        currentMigration: -1,
        modelRelations: [],
        shownRelationModels: [],
        modelInfos: [],

        setTarget: (target) => set({ target }),
        selectTable: (selectedTable) => set({ selectedTable }),

        // Dragging updates positions without polluting undo history.
        setNodePosition: (name, pos) =>
          set((s) => ({ positions: { ...s.positions, [name]: pos } })),

        // Auto-arrange replaces all positions (undoable).
        arrange: (positions) =>
          commit((d) => {
            d.positions = positions;
          }),

        // Full reset to a blank project (undoable) — also clears any imported
        // migration timeline + model data so every panel returns to empty.
        newProject: () =>
          set((s) => ({
            past: [...s.past, { schema: s.schema, positions: s.positions }].slice(-100),
            future: [],
            schema: { name: "Untitled", tables: [] },
            positions: {},
            selectedTable: null,
            migrations: [],
            migrationSnapshots: [],
            currentMigration: -1,
            modelRelations: [],
            shownRelationModels: [],
            modelInfos: [],
          })),

        loadProject: (schema, positions) =>
          set((s) => ({
            past: [...s.past, { schema: s.schema, positions: s.positions }].slice(-100),
            future: [],
            schema,
            positions: positions ?? {},
            selectedTable: null,
            migrations: [],
            migrationSnapshots: [],
            currentMigration: -1,
            modelRelations: [],
            shownRelationModels: [],
            modelInfos: [],
          })),

        loadHistory: (data, positions) =>
          set((s) => ({
            past: [...s.past, { schema: s.schema, positions: s.positions }].slice(-100),
            future: [],
            migrations: data.migrations,
            migrationSnapshots: data.snapshots,
            currentMigration: data.migrations.length - 1,
            schema: data.finalSchema,
            positions,
            selectedTable: null,
            modelRelations: data.modelRelations ?? [],
            shownRelationModels: [],
            modelInfos: data.modelInfos ?? [],
          })),

        loadFullProject: (data) =>
          set((s) => ({
            past: [...s.past, { schema: s.schema, positions: s.positions }].slice(-100),
            future: [],
            schema: data.schema,
            positions: data.positions,
            selectedTable: null,
            migrations: data.migrations ?? [],
            migrationSnapshots: data.migrationSnapshots ?? [],
            currentMigration: data.currentMigration ?? -1,
            modelRelations: data.modelRelations ?? [],
            shownRelationModels: data.shownRelationModels ?? [],
            modelInfos: data.modelInfos ?? [],
          })),

        toggleRelationModel: (model) =>
          set((s) => ({
            shownRelationModels: s.shownRelationModels.includes(model)
              ? s.shownRelationModels.filter((m) => m !== model)
              : [...s.shownRelationModels, model],
          })),

        setShownRelationModels: (models) => set({ shownRelationModels: models }),

        viewMigration: (index) =>
          set((s) => {
            const snap = s.migrationSnapshots[index];
            if (!snap) return {};
            return { currentMigration: index, schema: snap, selectedTable: null };
          }),

        addTable: () =>
          commit((d) => {
            const name = uniqueTableName(d.schema, "new_table");
            d.schema.tables.push({
              name,
              columns: [
                {
                  name: "id",
                  type: { kind: "serial", size: "big" },
                  nullable: false,
                  default: { kind: "autoincrement" },
                },
              ],
              primaryKey: ["id"],
              indexes: [],
              foreignKeys: [],
            });
            const n = d.schema.tables.length;
            d.positions[name] = { x: 120 + n * 36, y: 120 + n * 28 };
            d.selectedTable = name;
          }),

        renameTable: (oldName, newName) =>
          commit((d) => {
            const t = find(d.schema, oldName);
            const finalName = newName.trim();
            if (!t || finalName.length === 0 || finalName === oldName) return;
            if (find(d.schema, finalName)) return; // name collision — ignore
            for (const tb of d.schema.tables) {
              for (const fk of tb.foreignKeys) {
                if (fk.refTable === oldName) fk.refTable = finalName;
              }
            }
            t.name = finalName;
            const pos = d.positions[oldName];
            if (pos) {
              d.positions[finalName] = pos;
              delete d.positions[oldName];
            }
            if (d.selectedTable === oldName) d.selectedTable = finalName;
          }),

        deleteTable: (name) =>
          commit((d) => {
            d.schema.tables = d.schema.tables.filter((t) => t.name !== name);
            for (const t of d.schema.tables) {
              t.foreignKeys = t.foreignKeys.filter((fk) => fk.refTable !== name);
            }
            delete d.positions[name];
            if (d.selectedTable === name) d.selectedTable = null;
          }),

        addColumn: (table) =>
          commit((d) => {
            const t = find(d.schema, table);
            if (!t) return;
            t.columns.push({
              name: uniqueColumnName(t, "column"),
              type: { kind: "string", length: 255 },
              nullable: true,
            });
          }),

        updateColumn: (table, index, patch) =>
          commit((d) => {
            const t = find(d.schema, table);
            const col = t?.columns[index];
            if (!t || !col) return;
            const oldName = col.name;
            Object.assign(col, patch);
            if (patch.name && patch.name !== oldName) {
              if (t.primaryKey) {
                t.primaryKey = t.primaryKey.map((c) => (c === oldName ? col.name : c));
              }
              for (const fk of t.foreignKeys) {
                fk.columns = fk.columns.map((c) => (c === oldName ? col.name : c));
              }
            }
          }),

        deleteColumn: (table, index) =>
          commit((d) => {
            const t = find(d.schema, table);
            const col = t?.columns[index];
            if (!t || !col) return;
            t.columns.splice(index, 1);
            if (t.primaryKey) t.primaryKey = t.primaryKey.filter((c) => c !== col.name);
            t.foreignKeys = t.foreignKeys.filter((fk) => !fk.columns.includes(col.name));
          }),

        togglePrimaryKey: (table, column) =>
          commit((d) => {
            const t = find(d.schema, table);
            if (!t) return;
            const pk = new Set(t.primaryKey ?? []);
            if (pk.has(column)) pk.delete(column);
            else pk.add(column);
            t.primaryKey = [...pk];
          }),

        addForeignKey: (table, column, refTable, refColumn) =>
          commit((d) => {
            const t = find(d.schema, table);
            if (!t) return;
            t.foreignKeys.push({
              columns: [column],
              refTable,
              refColumns: [refColumn],
              onDelete: "cascade",
            });
          }),

        deleteForeignKey: (table, index) =>
          commit((d) => {
            const t = find(d.schema, table);
            if (!t) return;
            t.foreignKeys.splice(index, 1);
          }),

        // Apply a deterministic design-smell fix to the IR (undoable).
        applyFix: (fix) =>
          commit((d) => {
            const t = find(d.schema, fix.table);
            if (!t) return;
            switch (fix.kind) {
              case "add-index":
                t.indexes.push({ columns: fix.columns, unique: false });
                break;
              case "to-decimal": {
                const col = t.columns.find((c) => c.name === fix.column);
                if (col) col.type = { kind: "decimal", precision: 12, scale: 2 };
                break;
              }
              case "add-fk":
                if (!t.foreignKeys.some((fk) => fk.columns[0] === fix.column)) {
                  t.foreignKeys.push({
                    columns: [fix.column],
                    refTable: fix.refTable,
                    refColumns: ["id"],
                    onDelete: "cascade",
                  });
                }
                break;
              case "bool-not-null": {
                const col = t.columns.find((c) => c.name === fix.column);
                if (col) {
                  col.nullable = false;
                  col.default = { kind: "literal", value: false };
                }
                break;
              }
              case "add-id-pk": {
                if (!t.columns.some((c) => c.name === "id")) {
                  t.columns.unshift({
                    name: "id",
                    type: { kind: "serial", size: "big" },
                    nullable: false,
                    default: { kind: "autoincrement" },
                  });
                }
                t.primaryKey = ["id"];
                break;
              }
              case "add-timestamps": {
                for (const name of ["created_at", "updated_at"]) {
                  if (!t.columns.some((c) => c.name === name)) {
                    t.columns.push({ name, type: { kind: "timestamptz" }, nullable: true });
                  }
                }
                break;
              }
            }
          }),

        undo: () =>
          set((s) => {
            const prev = s.past[s.past.length - 1];
            if (!prev) return {};
            return {
              schema: prev.schema,
              positions: prev.positions,
              past: s.past.slice(0, -1),
              future: [{ schema: s.schema, positions: s.positions }, ...s.future].slice(0, 100),
            };
          }),

        redo: () =>
          set((s) => {
            const next = s.future[0];
            if (!next) return {};
            return {
              schema: next.schema,
              positions: next.positions,
              past: [...s.past, { schema: s.schema, positions: s.positions }].slice(-100),
              future: s.future.slice(1),
            };
          }),
      };
    },
    {
      name: "schemaguard:project",
      // Autosave the project + migration timeline — not transient undo history.
      partialize: (s) => ({
        schema: s.schema,
        positions: s.positions,
        target: s.target,
        migrations: s.migrations,
        migrationSnapshots: s.migrationSnapshots,
        currentMigration: s.currentMigration,
        modelRelations: s.modelRelations,
        shownRelationModels: s.shownRelationModels,
        modelInfos: s.modelInfos,
      }),
    },
  ),
);
