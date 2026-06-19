import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DbDialect } from "../lib/db";

export interface SavedConnection {
  id: string; // keyed by name
  name: string;
  dialect: DbDialect;
  host: string;
  port: number;
  user: string;
  database: string;
  // Stored only when the user opts into "Remember password" — in plain text in
  // local storage. Omitted otherwise, so coordinates alone are remembered.
  password?: string;
}

interface ConnectionsState {
  saved: SavedConnection[];
  save: (conn: Omit<SavedConnection, "id">) => void;
  remove: (id: string) => void;
}

export const useConnections = create<ConnectionsState>()(
  persist(
    (set) => ({
      saved: [],
      save: (conn) =>
        set((s) => {
          const entry: SavedConnection = { ...conn, id: conn.name };
          const rest = s.saved.filter((c) => c.id !== entry.id);
          return { saved: [entry, ...rest].slice(0, 12) };
        }),
      remove: (id) => set((s) => ({ saved: s.saved.filter((c) => c.id !== id) })),
    }),
    { name: "schemaguard:connections" },
  ),
);
