import { build } from "vite";
await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: "supabase/functions/community",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/community/protocol.ts",
      formats: ["es"],
      fileName: () => "validator.js",
    },
  },
});
