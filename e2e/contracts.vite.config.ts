import { defineConfig } from "vite";
export default defineConfig({ build: { outDir: "dist/contracts-harness", emptyOutDir: true, lib: { entry: "e2e/contracts-harness.ts", formats: ["es"], fileName: () => "contracts.js" } } });
