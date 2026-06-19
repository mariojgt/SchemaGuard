import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component/unit tests for the app (the engine has its own tests in packages/core).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
