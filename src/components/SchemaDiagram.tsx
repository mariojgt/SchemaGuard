import "@xyflow/react/dist/style.css";

import { detectSmells, type Schema } from "@schemaguard/core";
import type { Edge, Node } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { ImageDown } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { autoLayout } from "../lib/autoLayout";
import { exportDiagram } from "../lib/exportImage";
import { useSettings } from "../stores/settings";
import type { TableNodeData } from "./TableNode";
import { TableNode } from "./TableNode";

const nodeTypes = { table: TableNode };
const ACCENTS = ["#ff3fa4", "#a64bff", "#3ecf8e", "#f6c453", "#ff8a5b", "#5ad1ff", "#ff79c6"];
const defaultEdgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#a64bff", width: 16, height: 16 },
} as const;

/**
 * Read-only ER diagram for an arbitrary schema (not the editor store) — used to
 * visualize a live database inline in the Database client. Tables are laid out
 * by their foreign keys; nodes can be dragged to explore but nothing is edited.
 */
export function SchemaDiagram({ schema, name }: { schema: Schema; name: string }) {
  const theme = useSettings((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);

  const positions = useMemo(() => autoLayout(schema), [schema]);
  const smellsByTable = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of detectSmells(schema)) m.set(s.table, (m.get(s.table) ?? 0) + 1);
    return m;
  }, [schema]);

  const initialNodes = useMemo<Node[]>(
    () =>
      schema.tables.map((table, i) => ({
        id: table.name,
        type: "table",
        position: positions[table.name] ?? { x: 80 + i * 40, y: 80 + i * 30 },
        data: {
          name: table.name,
          columns: table.columns,
          primaryKey: table.primaryKey ?? [],
          fkColumns: table.foreignKeys.flatMap((fk) => fk.columns),
          accent: ACCENTS[i % ACCENTS.length] ?? "#ff3fa4",
          changed: false,
          smellCount: smellsByTable.get(table.name) ?? 0,
        } satisfies TableNodeData,
      })),
    [schema, positions, smellsByTable],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      schema.tables.flatMap((table) =>
        table.foreignKeys.map((fk, idx) => ({
          id: `${table.name}-fk-${String(idx)}`,
          source: table.name,
          target: fk.refTable,
          sourceHandle: fk.columns[0] ?? null,
          targetHandle: fk.refColumns[0] ?? null,
          label: fk.columns.join(", "),
        })),
      ),
    [schema],
  );

  return (
    <div ref={containerRef} className="h-full w-full bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        colorMode={theme === "light" ? "light" : "dark"}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-right">
          <button
            type="button"
            title="Export diagram as PNG"
            onClick={() => {
              void exportDiagram({
                nodes,
                format: "png",
                background: theme === "light" ? "#f7f5fb" : "#0b0710",
                fileName: name || "database",
                container: containerRef.current,
              });
            }}
            className="glass inline-flex items-center gap-1.5 rounded-lg border border-line/70 px-3 py-1.5 text-[12px] text-ink shadow-lg hover:border-acc"
          >
            <ImageDown size={14} />
            PNG
          </button>
        </Panel>
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color={theme === "light" ? "#d9d2ea" : "#2a2140"}
        />
        <MiniMap pannable maskColor="rgba(0,0,0,0.35)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
