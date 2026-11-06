import { defineConfig } from '@playwright/test';
const base = process.env.GLYPHFORGE_BASE ?? '/GlyphForge/';
export default defineConfig({testDir: '.', testMatch: 'm3-ui.check.ts',outputDir:'../test-results/m3-ui',workers: 1, timeout: 90000,
  use: {baseURL:'http://127.0.0.1:4176' + base, serviceWorkers:'block', trace:'off'},
  reporter: [['list'], ['json',{outputFile:process.cwd()+'/test-results/m3-ui-results.json'}]],
  webServer: {cwd:process.cwd(),command:'pnpm exec vite --host 127.0.0.1 --port 4176 --strictPort',
    env:{GLYPHFORGE_BASE:base,VITE_SUPABASE_URL:'https://glyphforge-auth.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_only'},
    url:'http://127.0.0.1:4176' + base,reuseExistingServer:false}});
