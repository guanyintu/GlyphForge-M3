import { defineConfig } from "vite";
export default defineConfig({ build: { outDir: "dist/subgraphs-harness", emptyOutDir: true, lib: { entry: "e2e/subgraphs-harness.ts", formats: ["es"], fileName: () => "subgraphs.js" } } });
