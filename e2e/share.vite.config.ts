import { defineConfig } from 'vite';
export default defineConfig({base:'/share-harness/',worker:{format:'es'},build:{outDir:'dist/share-harness',emptyOutDir:true,lib:{entry:'e2e/share-harness.ts',formats:['es'],fileName:()=> 'share.js'}}});
