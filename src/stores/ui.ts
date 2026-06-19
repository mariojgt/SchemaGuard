import { create } from "zustand";

/** The three top-level workspaces the app can show. */
export type AppMode = "designer" | "dataflow" | "database";

/** A SQL query the assistant has authored, surfaced live for the user. */
export interface LiveQuery {
  sql: string;
  /** A one-line plain-English note about what the query does. */
  note: string;
}

interface UiState {
  /** The active workspace. Lifted here so the assistant can switch views. */
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  /** The query the assistant most recently wrote, shown in the floating panel. */
  query: LiveQuery | null;
  setQuery: (query: LiveQuery | null) => void;

  /**
   * A query handed off to the Database workspace to prefill + run. The panel
   * consumes and clears it on arrival; separate from `query` so dismissing the
   * floating panel and running in the DB are independent actions.
   */
  pendingDbQuery: string | null;
  runInDatabase: (sql: string) => void;
  consumeDbQuery: () => void;
}

/**
 * Shared, non-persisted UI state the AI assistant can drive in real time:
 * which workspace is open, and any SQL query it has surfaced. The schema itself
 * lives in the schema store; this holds the view-level state around it.
 */
export const useUi = create<UiState>((set) => ({
  mode: "designer",
  setMode: (mode) => set({ mode }),

  query: null,
  setQuery: (query) => set({ query }),

  pendingDbQuery: null,
  runInDatabase: (sql) => set({ mode: "database", pendingDbQuery: sql }),
  consumeDbQuery: () => set({ pendingDbQuery: null }),
}));
