import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-flow": ["@xyflow/react"],
          storage: ["dexie", "dexie-react-hooks"],
        },
      },
    },
  },
});
