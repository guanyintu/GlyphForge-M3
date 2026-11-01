import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: 'test-results-subpath',
  testDir: "./e2e",
  testMatch: "community-subpath.check.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4177/GlyphForge/",
    viewport: { width: 1280, height: 900 },
  },
  reporter: "list",
  webServer: {
    command:
      "pnpm exec vite preview --host 127.0.0.1 --port 4177 --strictPort --outDir dist-subpath --base /GlyphForge/",
    url: "http://127.0.0.1:4177/GlyphForge/",
    reuseExistingServer: false,
  },
});
