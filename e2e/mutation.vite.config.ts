import { defineConfig } from "vite";
export default defineConfig({ build: { outDir: "dist/mutation-harness", emptyOutDir: true, lib: { entry: "e2e/mutation-harness.ts", formats: ["es"], fileName: () => "mutation.js" } } });
