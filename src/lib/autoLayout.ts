import dagre from "@dagrejs/dagre";
import type { Schema } from "@schemaguard/core";

import type { Positions } from "../stores/schema";

const NODE_WIDTH = 220;

function nodeHeight(columnCount: number): number {
  return 64 + columnCount * 26; // header + ~26px per column row
}

/** Tidy the schema into a left-to-right layered layout using dagre. */
export function autoLayout(schema: Schema): Positions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 48, marginy: 48 });
  g.setDefaultEdgeLabel(() => ({}));

  const names = new Set(schema.tables.map((t) => t.name));
  for (const t of schema.tables) {
    g.setNode(t.name, { width: NODE_WIDTH, height: nodeHeight(t.columns.length) });
  }
  for (const t of schema.tables) {
    for (const fk of t.foreignKeys) {
      if (names.has(fk.refTable) && fk.refTable !== t.name) {
        g.setEdge(t.name, fk.refTable);
      }
    }
  }

  // dagre's Graph generic types are loose; the call is correct.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  dagre.layout(g);

  const positions: Positions = {};
  for (const t of schema.tables) {
    const n = g.node(t.name) as { x: number; y: number; width: number; height: number } | undefined;
    if (n) {
      positions[t.name] = {
        x: Math.round(n.x - n.width / 2),
        y: Math.round(n.y - n.height / 2),
      };
    }
  }
  return positions;
}
