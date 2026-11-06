import { defineConfig } from '@playwright/test';
export default defineConfig({testDir: '.', testMatch: 'm3-ui.check.ts',outputDir:'../test-results/m3-ui',workers: 1, timeout: 90000,
  use: {baseURL:'http://127.0.0.1:4176/GlyphForge/', serviceWorkers:'block', trace:'off'},
  reporter: [['list'], ['json',{outputFile:process.cwd()+'/test-results/m3-ui-results.json'}]],
  webServer: {cwd:process.cwd(),command:'pnpm exec vite --host 127.0.0.1 --port 4176 --strictPort',
    env:{GLYPHFORGE_BASE:'/GlyphForge/',VITE_SUPABASE_URL:'https://glyphforge-auth.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_only'},
    url:'http://127.0.0.1:4176/GlyphForge/',reuseExistingServer:false}});
