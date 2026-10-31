import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist/packs-harness',emptyOutDir:true,lib:{entry:'e2e/packs-harness.ts',formats:['es'],fileName:()=> 'packs.js'}}});
