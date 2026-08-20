import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Adapted from geolibre-plugin-template's vite.geolibre.config.ts: a single
// self-contained ESM bundle, no external deps (uPlot bundles in).
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/geolibre.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "geolibre-plugin/dist",
    emptyOutDir: true,
    rollupOptions: {
      external: [],
      output: {
        // Keep the bundle a single file: the lazy uPlot import (see
        // src/panel/hydrograph.ts) is inlined but still executes on demand.
        inlineDynamicImports: true,
        assetFileNames: () => "style.css",
      },
    },
    cssCodeSplit: false,
    sourcemap: false,
    minify: true,
  },
});
