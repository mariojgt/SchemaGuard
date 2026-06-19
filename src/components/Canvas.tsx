import "@xyflow/react/dist/style.css";

import { detectSmells } from "@schemaguard/core";
import type { Connection, Edge, EdgeTypes, Node } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { ImageDown, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { autoLayout } from "../lib/autoLayout";
import { exportDiagram } from "../lib/exportImage";
import { RELATION_STYLE } from "../lib/relationStyle";
import { useSchemaStore } from "../stores/schema";
import { useSettings } from "../stores/settings";
import type { TableNodeData } from "./TableNode";
import { TableNode } from "./TableNode";

const FLOW_BG = { dark: "#0b0710", light: "#f7f5fb" } as const;

const nodeTypes = { table: TableNode };
const edgeTypes: EdgeTypes = {};

const ACCENTS = ["#ff3fa4", "#a64bff", "#3ecf8e", "#f6c453", "#ff8a5b", "#5ad1ff", "#ff79c6"];

// Stroke + width come from the themed CSS rule (.react-flow__edge-path).
const defaultEdgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#a64bff", width: 16, height: 16 },
} as const;

function RelationLegend() {
  return (
    <Panel position="bottom-left">
      <div className="glass flex flex-col gap-1 rounded-lg border border-line/70 px-3 py-2 text-[11px] shadow-lg">
        <span className="mb-0.5 font-semibold text-dim">Model relations</span>
        {(Object.keys(RELATION_STYLE) as (keyof typeof RELATION_STYLE)[]).map((cat) => (
          <span key={cat} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded-full"
              style={{ background: RELATION_STYLE[cat].color }}
            />
            {RELATION_STYLE[cat].label}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function CanvasToolbar() {
  const schema = useSchemaStore((s) => s.schema);
  const arrange = useSchemaStore((s) => s.arrange);
  const theme = useSettings((s) => s.theme);
  const { fitView, getNodes } = useReactFlow();

  const projectName = schema.name && schema.name.length > 0 ? schema.name : "schema";

  const onExport = (format: "png" | "svg") => {
    void exportDiagram({
      nodes: getNodes(),
      format,
      background: theme === "light" ? FLOW_BG.light : FLOW_BG.dark,
      fileName: projectName,
    }).then((ok) => {
      if (!ok) alert("Nothing to export — add or import some tables first.");
    });
  };

  return (
    <Panel position="top-left">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            arrange(autoLayout(schema));
            setTimeout(() => {
              void fitView({ duration: 400, padding: 0.2 });
            }, 60);
          }}
          className="glass inline-flex items-center gap-1.5 rounded-lg border border-line/70 px-3 py-1.5 text-[12px] text-ink shadow-lg hover:border-acc"
        >
          <Wand2 size={14} />
          Auto-arrange
        </button>
        <button
          type="button"
          title="Export diagram as PNG"
          onClick={() => {
            onExport("png");
          }}
          className="glass inline-flex items-center gap-1.5 rounded-lg border border-line/70 px-3 py-1.5 text-[12px] text-ink shadow-lg hover:border-acc"
        >
          <ImageDown size={14} />
          PNG
        </button>
        <button
          type="button"
          title="Export diagram as SVG"
          onClick={() => {
            onExport("svg");
          }}
          className="glass inline-flex items-center gap-1.5 rounded-lg border border-line/70 px-3 py-1.5 text-[12px] text-ink shadow-lg hover:border-acc"
        >
          SVG
        </button>
      </div>
    </Panel>
  );
}

export function Canvas() {
  const schema = useSchemaStore((s) => s.schema);
  const positions = useSchemaStore((s) => s.positions);
  const selectedTable = useSchemaStore((s) => s.selectedTable);
  const setNodePosition = useSchemaStore((s) => s.setNodePosition);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const addForeignKey = useSchemaStore((s) => s.addForeignKey);
  const migrations = useSchemaStore((s) => s.migrations);
  const currentMigration = useSchemaStore((s) => s.currentMigration);
  const modelRelations = useSchemaStore((s) => s.modelRelations);
  const shownRelationModels = useSchemaStore((s) => s.shownRelationModels);
  const theme = useSettings((s) => s.theme);

  const changedTables = useMemo(
    () => new Set(migrations[currentMigration]?.affectedTables ?? []),
    [migrations, currentMigration],
  );

  const smellsByTable = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of detectSmells(schema)) m.set(s.table, (m.get(s.table) ?? 0) + 1);
    return m;
  }, [schema]);

  const buildNodes = useCallback(
    (): Node[] =>
      schema.tables.map((table, i) => ({
        id: table.name,
        type: "table",
        position: positions[table.name] ?? { x: i === 0 ? 80 : 480, y: 80 + i * 220 },
        selected: table.name === selectedTable,
        data: {
          name: table.name,
          columns: table.columns,
          primaryKey: table.primaryKey ?? [],
          fkColumns: table.foreignKeys.flatMap((fk) => fk.columns),
          accent: ACCENTS[i % ACCENTS.length] ?? "#ff3fa4",
          changed: changedTables.has(table.name),
          smellCount: smellsByTable.get(table.name) ?? 0,
        } satisfies TableNodeData,
      })),
    [schema, positions, selectedTable, changedTables, smellsByTable],
  );

  // React Flow owns node positions during interaction (smooth drag); we rebuild
  // from the schema/store only when those inputs actually change.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(buildNodes());
  useEffect(() => {
    setNodes(buildNodes());
  }, [buildNodes, setNodes]);

  const edges: Edge[] = useMemo(
    () =>
      schema.tables.flatMap((table) =>
        table.foreignKeys.map((fk, idx) => {
          const fromModel = fk.source === "model";
          return {
            id: `${table.name}-fk-${idx}`,
            source: table.name,
            target: fk.refTable,
            sourceHandle: fk.columns[0] ?? null,
            targetHandle: fk.refColumns[0] ?? null,
            label: fk.columns.join(", "),
            // Logical (model-inferred) relationships render dashed + tinted so
            // they read distinctly from enforced DB foreign keys.
            ...(fromModel ? { style: { stroke: "#a64bff", strokeDasharray: "6 4" } } : {}),
          };
        }),
      ),
    [schema],
  );

  // Overlay edges for Eloquent relations of the models the user toggled on in
  // the Models tab. Color-coded by category; many-to-many + polymorphic dashed.
  const relationEdges: Edge[] = useMemo(() => {
    if (shownRelationModels.length === 0) return [];
    const shown = new Set(shownRelationModels);
    const byTable = new Map(schema.tables.map((t) => [t.name, t]));
    const handleFor = (table: (typeof schema.tables)[number], prefer?: string): string | null =>
      (prefer && table.columns.some((c) => c.name === prefer) ? prefer : undefined) ??
      table.primaryKey?.[0] ??
      table.columns[0]?.name ??
      null;

    const out: Edge[] = [];
    modelRelations.forEach((r, i) => {
      if (!shown.has(r.model) || !r.relatedTable) return;
      const src = byTable.get(r.table);
      const dst = byTable.get(r.relatedTable);
      if (!src || !dst) return; // a side isn't in the current schema
      const style = RELATION_STYLE[r.category];
      const dashed = r.category === "manyToMany" || r.category === "polymorphic";
      out.push({
        id: `rel-${String(i)}`,
        source: r.table,
        target: r.relatedTable,
        sourceHandle: handleFor(src, r.fkColumn),
        targetHandle: handleFor(dst, "id"),
        label: r.method,
        labelStyle: { fill: style.color, fontWeight: 600 },
        style: { stroke: style.color, ...(dashed ? { strokeDasharray: "5 4" } : {}) },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 16, height: 16 },
      });
    });
    return out;
  }, [schema, modelRelations, shownRelationModels]);

  const allEdges = useMemo(() => [...edges, ...relationEdges], [edges, relationEdges]);

  // Connecting a source column handle to a target column handle creates the
  // exact foreign key between those two columns.
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;

      if (conn.sourceHandle && conn.targetHandle) {
        addForeignKey(conn.source, conn.sourceHandle, conn.target, conn.targetHandle);
        return;
      }

      // Fallback for node-level connects (e.g. an empty table): guess columns.
      const target = schema.tables.find((t) => t.name === conn.target);
      const source = schema.tables.find((t) => t.name === conn.source);
      const refColumn = target?.primaryKey?.[0] ?? target?.columns[0]?.name;
      const localColumn =
        source?.columns.find((c) => c.name === `${conn.target}_id`)?.name ??
        source?.columns.find((c) => !(source.primaryKey ?? []).includes(c.name))?.name ??
        source?.columns[0]?.name;
      if (refColumn && localColumn) addForeignKey(conn.source, localColumn, conn.target, refColumn);
    },
    [schema, addForeignKey],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={allEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, node) => {
        setNodePosition(node.id, node.position);
      }}
      onConnect={onConnect}
      onNodeClick={(_, node) => {
        selectTable(node.id);
      }}
      onPaneClick={() => {
        selectTable(null);
      }}
      fitView
      colorMode={theme === "light" ? "light" : "dark"}
      connectionMode={ConnectionMode.Loose}
      connectionRadius={48}
      proOptions={{ hideAttribution: false }}
    >
      <CanvasToolbar />
      {relationEdges.length > 0 && <RelationLegend />}
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1}
        color={theme === "light" ? "#d9d2ea" : "#2a2140"}
      />
      <MiniMap pannable maskColor="rgba(0,0,0,0.35)" />
      <Controls />
    </ReactFlow>
  );
}
