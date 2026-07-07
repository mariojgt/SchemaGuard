import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and leaves the console clear for its own output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1425,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
