import type { Schema } from "@schemaguard/core";

import type { Positions } from "../stores/schema";

/** Simple grid layout for freshly-imported / sample schemas. */
export function gridLayout(schema: Schema, cols = 3): Positions {
  const positions: Positions = {};
  schema.tables.forEach((t, i) => {
    positions[t.name] = { x: 80 + (i % cols) * 320, y: 80 + Math.floor(i / cols) * 300 };
  });
  return positions;
}
