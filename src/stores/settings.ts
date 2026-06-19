import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Provider } from "../lib/ai";

export type Theme = "dark" | "light";

interface SettingsState {
  // Per-provider API keys, stored locally and never written to project files.
  keys: Record<Provider, string>;
  modelId: string;
  theme: Theme;
  setKey: (provider: Provider, key: string) => void;
  setModelId: (id: string) => void;
  setTheme: (theme: Theme) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      keys: { anthropic: "", openai: "", google: "" },
      modelId: "claude-opus-4-8",
      theme: "dark",
      setKey: (provider, key) => set((s) => ({ keys: { ...s.keys, [provider]: key } })),
      setModelId: (modelId) => set({ modelId }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "schemaguard:settings" },
  ),
);
