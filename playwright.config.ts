import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:4175", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  reporter: [["list"], ["json", { outputFile: "test-results/browser-results.json" }]],
  webServer: {
    command: "pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
  },
});
