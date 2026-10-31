import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'dist/lineage-harness',emptyOutDir:true,lib:{entry:'e2e/lineage-harness.ts',formats:['es'],fileName:()=> 'lineage.js'}}});
