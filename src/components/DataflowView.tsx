import "@xyflow/react/dist/style.css";

import dagre from "@dagrejs/dagre";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { ImageDown } from "lucide-react";
import { useMemo, useState } from "react";

import { exportDiagram } from "../lib/exportImage";
import { RELATION_STYLE } from "../lib/relationStyle";
import type { Positions } from "../stores/schema";
import { useSchemaStore } from "../stores/schema";
import { useSettings } from "../stores/settings";
import { ModelInsights } from "./ModelInsights";

type FlowCategory = keyof typeof RELATION_STYLE | "fk";

const FLOW_COLOR: Record<FlowCategory, string> = {
  ...Object.fromEntries(
    (Object.keys(RELATION_STYLE) as (keyof typeof RELATION_STYLE)[]).map((k) => [
      k,
      RELATION_STYLE[k].color,
    ]),
  ),
  fk: "#8a7fb0",
} as Record<FlowCategory, string>;

interface FlowLink {
  source: string;
  target: string;
  label: string;
  category: FlowCategory;
}

interface ModelNodeData {
  label: string;
  sub: string;
  count: number;
  state: "selected" | "neighbor" | "dim" | "normal";
  accent: string;
  [key: string]: unknown;
}

const nodeTypes = { model: ModelNode };

function ModelNode({ data }: NodeProps) {
  const d = data as ModelNodeData;
  const ring =
    d.state === "selected"
      ? "border-acc shadow-glow"
      : d.state === "neighbor"
        ? "border-acc2"
        : "border-line";
  const dim = d.state === "dim" ? "opacity-40" : "opacity-100";
  return (
    <div
      className={`min-w-[170px] rounded-xl border bg-node/95 px-3 py-2 text-ink shadow-xl backdrop-blur-sm transition-all duration-200 ${ring} ${dim}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-acc2" />
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: d.accent }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold leading-tight">{d.label}</span>
          <span className="block font-mono text-[10px] text-faint">{d.sub}</span>
        </span>
        {d.count > 0 && (
          <span className="flex-none rounded-full bg-panel3 px-1.5 py-0.5 text-[10px] text-dim">
            {d.count}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-acc" />
    </div>
  );
}

const ACCENTS = ["#ff3fa4", "#a64bff", "#3ecf8e", "#f6c453", "#ff8a5b", "#5ad1ff", "#ff79c6"];

function layoutGraph(ids: string[], links: FlowLink[]): Positions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 130, marginx: 48, marginy: 48 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) g.setNode(id, { width: 184, height: 56 });
  for (const l of links) if (l.source !== l.target) g.setEdge(l.source, l.target);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  dagre.layout(g);
  const pos: Positions = {};
  for (const id of ids) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number } | undefined;
    if (n) pos[id] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) };
  }
  return pos;
}

export function DataflowView() {
  const schema = useSchemaStore((s) => s.schema);
  const modelRelations = useSchemaStore((s) => s.modelRelations);
  const theme = useSettings((s) => s.theme);
  const [selected, setSelected] = useState<string | null>(null);

  // Map a table name -> the model class that owns it (for nicer labels).
  const modelByTable = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of modelRelations) if (!m.has(r.table)) m.set(r.table, r.model);
    return m;
  }, [modelRelations]);

  // Combine the migration FKs and the Eloquent relations into one link set.
  // Model relations win for a given pair; FKs fill in DB-only connections.
  const links = useMemo<FlowLink[]>(() => {
    const tables = new Set(schema.tables.map((t) => t.name));
    const out: FlowLink[] = [];
    const pairs = new Set<string>();

    for (const r of modelRelations) {
      if (!r.relatedTable || !tables.has(r.table) || !tables.has(r.relatedTable)) continue;
      out.push({
        source: r.table,
        target: r.relatedTable,
        label: r.method,
        category: r.category,
      });
      pairs.add(`${r.table}->${r.relatedTable}`);
    }
    for (const t of schema.tables) {
      for (const fk of t.foreignKeys) {
        if (!tables.has(fk.refTable) || fk.refTable === t.name) continue;
        if (pairs.has(`${t.name}->${fk.refTable}`)) continue; // already a model relation
        out.push({
          source: t.name,
          target: fk.refTable,
          label: fk.columns.join(", "),
          category: "fk",
        });
      }
    }
    return out;
  }, [schema, modelRelations]);

  const positions = useMemo(
    () =>
      layoutGraph(
        schema.tables.map((t) => t.name),
        links,
      ),
    [schema, links],
  );

  // Neighbours of the selected node (either endpoint of a connected link).
  const neighbours = useMemo(() => {
    if (!selected) return new Set<string>();
    const s = new Set<string>();
    for (const l of links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    return s;
  }, [links, selected]);

  const relCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of links) {
      c.set(l.source, (c.get(l.source) ?? 0) + 1);
      c.set(l.target, (c.get(l.target) ?? 0) + 1);
    }
    return c;
  }, [links]);

  const nodes = useMemo<Node[]>(
    () =>
      schema.tables.map((t, i) => {
        const state: ModelNodeData["state"] = !selected
          ? "normal"
          : t.name === selected
            ? "selected"
            : neighbours.has(t.name)
              ? "neighbor"
              : "dim";
        return {
          id: t.name,
          type: "model",
          position: positions[t.name] ?? { x: 80 + i * 40, y: 80 + i * 30 },
          draggable: true,
          data: {
            label: modelByTable.get(t.name) ?? t.name,
            sub: t.name,
            count: relCount.get(t.name) ?? 0,
            state,
            accent: ACCENTS[i % ACCENTS.length] ?? "#ff3fa4",
          } satisfies ModelNodeData,
        };
      }),
    [schema, positions, selected, neighbours, relCount, modelByTable],
  );

  const edges = useMemo<Edge[]>(
    () =>
      links.map((l, i) => {
        const color = FLOW_COLOR[l.category];
        const connected = selected !== null && (l.source === selected || l.target === selected);
        const dim = selected !== null && !connected;
        const cls = connected ? "df-energy" : dim ? "df-dim" : "";
        return {
          id: `df-${String(i)}`,
          source: l.source,
          target: l.target,
          type: "smoothstep",
          animated: connected,
          className: cls,
          ...(connected || !selected ? { label: l.label } : {}),
          style: { stroke: color, color, strokeWidth: connected ? 3 : 1.5 },
          labelStyle: { fill: color, fontWeight: 600 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
        };
      }),
    [links, selected],
  );

  if (schema.tables.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-bg text-center">
        <div className="glass flex flex-col items-center gap-2 rounded-2xl border border-line/70 px-8 py-7">
          <div className="text-[14px] font-semibold">Nothing to flow yet</div>
          <div className="max-w-[280px] text-[12px] text-dim">
            Import a Laravel project (migrations + models) to see how its data connects.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        nodesConnectable={false}
        colorMode={theme === "light" ? "light" : "dark"}
        onNodeClick={(_, node) => {
          setSelected((cur) => (cur === node.id ? null : node.id));
        }}
        onPaneClick={() => {
          setSelected(null);
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-left">
          <div className="glass max-w-[260px] rounded-lg border border-line/70 px-3 py-2 text-[11.5px] shadow-lg">
            <div className="font-semibold">Dataflow</div>
            <div className="mt-0.5 text-dim">
              {selected ? (
                <>
                  Tracing{" "}
                  <span className="font-semibold text-ink">
                    {modelByTable.get(selected) ?? selected}
                  </span>{" "}
                  · click empty space to reset
                </>
              ) : (
                "Click a model to light up how its data flows to the rest of the app."
              )}
            </div>
          </div>
        </Panel>
        <Panel position="top-right">
          <button
            type="button"
            title="Export dataflow as PNG"
            onClick={() => {
              void exportDiagram({
                nodes,
                format: "png",
                background: theme === "light" ? "#f7f5fb" : "#0b0710",
                fileName: `${schema.name && schema.name.length > 0 ? schema.name : "schema"}-dataflow`,
              });
            }}
            className="glass inline-flex items-center gap-1.5 rounded-lg border border-line/70 px-3 py-1.5 text-[12px] text-ink shadow-lg hover:border-acc"
          >
            <ImageDown size={14} />
            PNG
          </button>
        </Panel>
        <Legend />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={theme === "light" ? "#d9d2ea" : "#2a2140"}
        />
        <MiniMap pannable maskColor="rgba(0,0,0,0.35)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selected && (
        <div className="glass absolute bottom-3 right-3 top-3 z-10 w-[340px] animate-slideright overflow-hidden rounded-xl border border-line/70 shadow-2xl">
          <ModelInsights
            tableName={selected}
            onClose={() => {
              setSelected(null);
            }}
            onNavigate={(t) => {
              setSelected(t);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Legend() {
  const cats: { key: FlowCategory; label: string }[] = [
    { key: "one", label: "has one / belongs to" },
    { key: "many", label: "has many" },
    { key: "manyToMany", label: "many-to-many" },
    { key: "polymorphic", label: "polymorphic" },
    { key: "fk", label: "DB foreign key only" },
  ];
  return (
    <Panel position="bottom-left">
      <div className="glass flex flex-col gap-1 rounded-lg border border-line/70 px-3 py-2 text-[11px] shadow-lg">
        {cats.map((c) => (
          <span key={c.key} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded-full"
              style={{ background: FLOW_COLOR[c.key] }}
            />
            {c.label}
          </span>
        ))}
      </div>
    </Panel>
  );
}
