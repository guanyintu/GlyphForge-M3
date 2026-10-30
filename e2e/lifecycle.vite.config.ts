import { defineConfig } from "vite";
export default defineConfig({ build: { outDir: "dist/e2e-harness", emptyOutDir: true, lib: { entry: "e2e/lifecycle-harness.ts", formats: ["es"], fileName: () => "lifecycle.js" } } });
