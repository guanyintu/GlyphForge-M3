import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'dist/scale-harness',emptyOutDir:true,lib:{entry:'e2e/scale-harness.ts',formats:['es'],fileName:()=> 'scale.js'}}});
