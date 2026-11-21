import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  resolve: {
    alias: {
      // See src/lib/shims/url.ts — silences fastboot's dead Node-only branch.
      url: fileURLToPath(new URL("./src/lib/shims/url.ts", import.meta.url)),
    },
  },
  build: { target: "es2022" },
});
