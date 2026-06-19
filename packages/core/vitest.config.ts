import { defineConfig } from "vitest/config";

// Self-contained config so the engine's tests never pick up the app's vite config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
