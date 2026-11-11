import "fake-indexeddb/auto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:"custom"});
try {
  const {db,readResource}=await server.ssrLoadModule('/src/storage/db.ts');
  const {openCorpusPreset}=await server.ssrLoadModule('/src/storage/corpus.ts');
  const {corpusPresets}=await server.ssrLoadModule('/src/core/corpus-presets.ts');
  const {execute}=await server.ssrLoadModule('/src/core/engine.ts');
  const audit={seeds:16,perBatch:75,styles:{}};
  for(const preset of corpusPresets) {
    const workflow=await openCorpusPreset(preset.style),unique=new Set(),samples=[],rules=new Set();
    let generated=0;
    for(let seed=0;seed<16;seed++) {
      const values=[];await execute({...workflow,seed},readResource,b=>values.push(...b),undefined,{resourceMetadata:id=>db.resources.get(id)});
      if(values.length!==75||new Set(values.map(c=>c.text)).size!==75)throw new Error('Unexpected batch count '+preset.style);
      for(const c of values){generated++;if(!unique.has(c.text)&&samples.length<36)samples.push(c.text);unique.add(c.text);for(const note of c.notes||[])if(note.startsWith('配伍 v2：'))rules.add(note.slice(6));}
    }
    audit.styles[preset.style]={generated,unique:unique.size,recipes:[...rules],samples};
  }
  await mkdir('docs/quality',{recursive:true});await writeFile('docs/quality/sample-audit.json',JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify(audit));db.close();
}finally{await server.close();}
