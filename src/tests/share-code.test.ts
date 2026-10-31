import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { encodeShareCode, decodeShareCode, SHARE_LIMITS } from '../core/share-code';
import { previewShare } from '../core/share-preview';
import { exportPackage, importPackage } from '../core/sharing';
import { resourceWorkflow } from '../core/resource-package';
import { db, saveNewResource } from '../storage/db';
import { saveDefinedResource } from '../storage/resource-runtime';
import { firstPartyPacks } from '../core/packs';
import { installPacks, setPackEnabled } from '../storage/packs';
import type { Resource } from '../core/model';
import { captureShareResources } from '../storage/share-resources';
const meta = (id: string): Resource => ({id,name:id,kind:'word',version:3,count:0,color:'green',description:'',updatedAt:0});
async function fixture() { await saveNewResource(meta('source'), ['月','星']); return exportPackage(resourceWorkflow('source')); }
async function forged(text: string, length = new TextEncoder().encode(text).length) {
  const bytes = new TextEncoder().encode(text);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
  const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  let raw='';for(const b of packed)raw+=String.fromCharCode(b);
  return `GFS1.deflate.${length}.${digest}.${btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}`;
}
const counts = () => Promise.all(db.tables.map(t => t.count()));
afterEach(async () => { vi.restoreAllMocks(); for (const t of db.tables) await t.clear(); });

it('roundtrips exact existing JSON, order, versions; repeat compression is deterministic in this runtime', async () => {
  const p = await fixture(), a = await encodeShareCode(p), b = await encodeShareCode(p);
  expect(a).toEqual(b); expect(await decodeShareCode(a.code)).toEqual(p); expect(a.compressedBytes).toBeLessThan(a.jsonBytes);
});
it('optional undefined fields use the original JSON omission semantics',async()=>{
  const p=await fixture();const data={...p,workflow:{...p.workflow,subgraphs:undefined}};
  expect(await decodeShareCode((await encodeShareCode(data)).code)).toEqual(JSON.parse(JSON.stringify(data)));
});
it('code export reads only bounded metadata closure and stops snapshots before 1MiB',async()=>{
  await fixture();const scan=vi.spyOn(db.resources,'toArray').mockRejectedValue(new Error('unbounded catalog scan'));
  const plan=await captureShareResources(resourceWorkflow('source'));expect(plan.resources.map(r=>r.id)).toEqual(['source']);expect(scan).not.toHaveBeenCalled();
  await saveNewResource(meta('large'),Array.from({length:6000},(_,i)=>`${i}-${'月'.repeat(80)}`));const large=resourceWorkflow('large');
  await expect(exportPackage(large,true,undefined,{plan:await captureShareResources(large),maxBytes:SHARE_LIMITS.json})).rejects.toThrow('1 MiB');
});
it.each([1,2,3,4,5,6,7])('preserves old envelope payload version %i and preview remains read-only', async version => {
  const p: any = await fixture(); p.version = version;
  if (version >= 6) { p.resourceDefinitionVersion = 1; p.packManifest = []; }
  const decoded = await decodeShareCode((await encodeShareCode(p)).code);
  expect(decoded).toEqual(p); const before = await counts(); await previewShare(decoded); expect(await counts()).toEqual(before);
  await importPackage(decoded); expect(await db.workflows.count()).toBe(1);
});
it('light preview reports missing dependencies without installing resources or workflows', async () => {
  await fixture(); const p = await exportPackage(resourceWorkflow('source'), false); await db.resources.clear();
  const before = await counts(), preview = await previewShare(await decodeShareCode((await encodeShareCode(p)).code));
  expect(preview.missing.map(d => d.id)).toEqual(['source']); expect(await counts()).toEqual(before);
});
it('only selected snapshots; repeated imports remap IDs and leave original resource versions intact', async () => {
  await fixture(); await saveNewResource(meta('second'), ['风']);
  const w = resourceWorkflow('source'); w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'second'}});w.nodes.at(-1)!.inputs=['b'];
  const originalVersion=(await db.resources.get('source'))!.version;
  const p = await exportPackage(w,['source']); const decoded: any = await decodeShareCode((await encodeShareCode(p)).code);
  expect(decoded.resources.map((r:any)=>r.meta.id)).toEqual(['source']);
  const a = await importPackage(decoded), b = await importPackage(decoded);expect(a.id).not.toBe(b.id);expect(a.nodes[0].params.resourceId).not.toBe(b.nodes[0].params.resourceId);
  expect((await db.resources.get('source'))?.version).toBe(originalVersion);
});
it('v7 disabled/unknown publishers and Mapping/DAG previews never change installation state', async () => {
  await fixture();const pack={...structuredClone(firstPartyPacks[0]),id:'user-text'};await installPacks([pack]);
  const w=resourceWorkflow('source');w.extensions=[pack];w.nodes.splice(1,0,{id:'e',op:'extension',inputs:['source'],params:{pack:pack.id,version:pack.version,operator:'frame',values:'{}'}});w.nodes.at(-1)!.inputs=['e'];
  await setPackEnabled('user-text@1.0.0',true);
  await saveDefinedResource({...meta('dag'),definition:{format:1,type:'dynamic',workflow:w}});
  const p=await exportPackage(resourceWorkflow('dag'));await setPackEnabled('user-text@1.0.0',false);const before=await counts();const preview=await previewShare(p);expect(await counts()).toEqual(before);expect(preview.extensions[0].status).toContain('禁用');
  const decoded=await decodeShareCode((await encodeShareCode(p)).code);await importPackage(decoded);expect((await db.extensionPacks.toArray())[0].enabled).toBe(false);
  await setPackEnabled('user-text@1.0.0',true);await setPackEnabled('user-text@1.0.0',false);await importPackage(p);expect((await db.extensionPacks.toArray())[0].enabled).toBe(false);
});
it.each(['GFS2.deflate.1.x.a','GFS1.gzip.1.x.a','GFS1.deflate.1.x.+','X',' '.repeat(87501)])('rejects malformed/version/alphabet/length before native decompression',async code => {
  const spy=vi.spyOn(globalThis,'DecompressionStream');await expect(decodeShareCode(code)).rejects.toThrow();expect(spy).not.toHaveBeenCalled();
});
it('rejects bombs during streaming before JSON.parse even with a false small declaration', async () => {
  const code=await forged('x'.repeat(8*1024*1024), SHARE_LIMITS.json);const parse=vi.spyOn(JSON,'parse');
  await expect(decodeShareCode(code)).rejects.toThrow('流式解压');expect(parse.mock.calls.some(([text])=>text.length>100000)).toBe(false);
  await expect(decodeShareCode(await forged('x',SHARE_LIMITS.json+1))).rejects.toThrow('声明');
});
it('rejects truncated/corrupt streams, tamper, noncanonical bits and mismatched lengths',async()=>{
  const {code}=await encodeShareCode(await fixture());
  for(const broken of [code.slice(0,-4),code.replace(/\.[a-f0-9]{64}\./,'.'+'0'.repeat(64)+'.'),code.replace(/deflate\.\d+/, 'deflate.1'),code+'A'])await expect(decodeShareCode(broken)).rejects.toThrow();
  const raw=await forged('{}');await expect(decodeShareCode(raw.slice(0,-1)+'_')).rejects.toThrow();
});
it('rejects prototype keys, nested envelopes, history fields and excessive JSON depth',async()=>{
  const p=await fixture();const text=JSON.stringify(p);
  for(const raw of [text.replace('"workflow":','"__proto__":{},"workflow":'),JSON.stringify({format:'GFS1',data:p}),JSON.stringify({...p,favorites:[]}),'{"a":'.repeat(25)+'0'+'}'.repeat(25)])await expect(decodeShareCode(await forged(raw))).rejects.toThrow();
  expect(({} as any).polluted).toBeUndefined();
});
it('bounds compression input and output separately, even for very compressible input',async()=>{
  const p=await fixture();await expect(encodeShareCode({...p,workflow:{...p.workflow,comments:['x'.repeat(SHARE_LIMITS.json)]}})).rejects.toThrow();
  let seed=17;const s=Array.from({length:180000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return String.fromCharCode(33+seed%90);}).join('');
  await expect(encodeShareCode({...p,workflow:{...p.workflow,comments:[s]}})).rejects.toThrow('64 KiB');
});
it('pre-abort and mid-stream abort do not parse or publish results; independent concurrent tasks still finish',async()=>{
  const p=await fixture();const code=(await encodeShareCode(p)).code;const c=new AbortController();c.abort();
  await expect(decodeShareCode(code,c.signal)).rejects.toThrow('取消');
  const a=new AbortController();const bomb=await forged('x'.repeat(1024*1024));const decoding=decodeShareCode(bomb,a.signal);a.abort();
  await expect(decoding).rejects.toThrow('取消');const result=await Promise.all([decodeShareCode(code),decodeShareCode(code)]);expect(result).toEqual([p,p]);
});
it('missing native APIs explain JSON fallback',async()=>{
  vi.stubGlobal('CompressionStream',undefined);try{await expect(encodeShareCode(await fixture())).rejects.toThrow('JSON');}finally{vi.unstubAllGlobals();}
});
it('atomic import rolls back every inserted asset on injected workflow failure',async()=>{
  const p=await fixture();const before=await counts();vi.spyOn(db.workflows,'add').mockRejectedValueOnce(new Error('injected final write failure'));
  await expect(importPackage(await decodeShareCode((await encodeShareCode(p)).code))).rejects.toThrow('injected');expect(await counts()).toEqual(before);
});
it('seeded security fuzz rejects 240 envelope mutations without database writes',async()=>{
  const code=(await encodeShareCode(await fixture())).code;const before=await counts();let seed=37;
  for(let i=0;i<240;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const at=seed%code.length;const corrupt=code.slice(0,at)+'!'+code.slice(at+1);await expect(decodeShareCode(corrupt)).rejects.toThrow();}
  expect(await counts()).toEqual(before);
});
it('seeded base64url/stream fuzz rejects corruption or returns the identical checksum-verified payload',async()=>{
  const p=await fixture(),code=(await encodeShareCode(p)).code,at=code.lastIndexOf('.')+1,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let seed=91,rejected=0,identical=0;
  for(let i=0;i<120;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const pos=at+seed%(code.length-at);const ch=alphabet[(alphabet.indexOf(code[pos])+1+seed%63)%64];const bad=code.slice(0,pos)+ch+code.slice(pos+1);let decoded:unknown;try{decoded=await decodeShareCode(bad);}catch{rejected++;continue;}expect(decoded).toEqual(p);identical++;}
  expect(rejected).toBeGreaterThan(100);expect(rejected+identical).toBe(120);console.log('GFS1 base64 stream fuzz',JSON.stringify({rejected,identical}));
});
it('readonly preview rejects unknown operators, oversized snapshots and versions without writes',async()=>{
  const p:any=await fixture(), before=await counts();
  for(const mutate of [(p:any)=>p.operatorVersions.resource=999,(p:any)=>p.workflow.nodes[0].op='eval',(p:any)=>p.workflow.nodes=[p.workflow.nodes[0]],(p:any)=>p.resources[0].entries=Array(100001).fill('x'),(p:any)=>p.resources[0].meta.version=999,(p:any)=>p.dependencies=Array(101).fill(p.dependencies[0])]) {
    const bad=structuredClone(p);mutate(bad);await expect(previewShare(bad)).rejects.toThrow();expect(await counts()).toEqual(before);
  }
});
it('v7 unknown manifest closure/version and executable declarations are rejected before confirmation',async()=>{
  const p:any=await fixture();p.version=7;p.resourceDefinitionVersion=1;
  const original=structuredClone(firstPartyPacks[0]);
  for(const pack of [{...original,protocol:99},{...original,code:'fetch("https://evil")'},{...original,dependencies:[{id:'missing',version:'1.0.0'}]}]) {
    await expect(previewShare({...p,packManifest:[pack]})).rejects.toThrow();expect(await db.extensionPacks.count()).toBe(0);
  }
});
it('v7 transaction rolls back newly installed packs together with snapshots',async()=>{
  const p:any=await fixture();p.version=7;p.resourceDefinitionVersion=1;p.packManifest=[];
  const w=p.workflow;w.extensions=[structuredClone(firstPartyPacks[0])];p.packManifest=w.extensions;p.operatorVersions.extension=1;
  w.nodes.splice(1,0,{id:'ext',op:'extension',inputs:['source'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}'}});w.nodes.at(-1).inputs=['ext'];
  const before=await counts();vi.spyOn(db.workflows,'add').mockRejectedValueOnce(new Error('v7 final failure'));
  await expect(importPackage(await decodeShareCode((await encodeShareCode(p)).code))).rejects.toThrow('v7 final failure');expect(await counts()).toEqual(before);
});
