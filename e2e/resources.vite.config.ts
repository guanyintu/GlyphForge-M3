import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist/resources-harness',emptyOutDir:true,lib:{entry:'e2e/resources-harness.ts',formats:['es'],fileName:()=> 'resources.js'}}});
