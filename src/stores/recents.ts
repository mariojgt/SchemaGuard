import type { Schema } from "@schemaguard/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Positions } from "./schema";

export interface RecentProject {
  id: string; // keyed by project name
  name: string;
  savedAt: number;
  tableCount: number;
  schema: Schema;
  positions: Positions;
}

interface RecentsState {
  items: RecentProject[];
  remember: (name: string, schema: Schema, positions: Positions) => void;
  remove: (id: string) => void;
}

export const useRecents = create<RecentsState>()(
  persist(
    (set) => ({
      items: [],
      remember: (name, schema, positions) =>
        set((s) => {
          const id = name;
          const entry: RecentProject = {
            id,
            name,
            savedAt: Date.now(),
            tableCount: schema.tables.length,
            schema,
            positions,
          };
          const rest = s.items.filter((x) => x.id !== id);
          return { items: [entry, ...rest].slice(0, 10) };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
    }),
    { name: "schemaguard:recents" },
  ),
);
