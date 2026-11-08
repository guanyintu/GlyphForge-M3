import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import {test,expect} from '@playwright/test';
const estimate=(page:any)=>page.locator('.execution-estimate [role=status]');
async function start(page:any){await openEditor(page, '/');await expect(page.getByText(/生成完成/)).toBeVisible();await page.getByText('规模与执行风险（只读）',{exact:true}).click();await page.getByRole('button',{name:'估算当前工作流'}).click();await expect(estimate(page)).toContainText('144');}
async function nativeChange(editor:any,mode:string){return editor.evaluate(async(mode:string)=>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('glyphforge-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const tx=db.transaction(['resources','workflows'],'readwrite'),resources=tx.objectStore('resources');
 const w=await new Promise<any>(resolve=>{const r=tx.objectStore('workflows').getAll();r.onsuccess=()=>resolve(r.result.find((w:any)=>w.name==='宇宙浪漫命名器'));});
 const id=w.nodes.find((n:any)=>n.op==='resource').params.resourceId;
 const resource=await new Promise<any>(resolve=>{const r=resources.get(id);r.onsuccess=()=>resolve(r.result);});
 if(mode==='delete')resources.delete(id);else resources.put({...resource,count:20000,version:resource.version+1});
 await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();return resource;
 },mode);}
test('native cross-tab metadata commits invalidate an existing estimate without a Dexie message',async({page,context})=>{
 await start(page);const editor=await context.newPage();await openEditor(editor, '/');await expect(editor.getByText(/生成完成/)).toBeVisible();await nativeChange(editor,'update');
 await expect(estimate(page)).toContainText('240000',{timeout:4000});const original=await nativeChange(editor,'delete');await expect(page.locator('.execution-estimate')).toContainText('缺失',{timeout:4000});
 await editor.evaluate(async(resource:any)=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('glyphforge-v1');r.onsuccess=()=>resolve(r.result);});const tx=db.transaction('resources','readwrite');tx.objectStore('resources').put({...resource,count:3,version:resource.version+1});await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve();});db.close();},original);
 await expect(estimate(page)).toContainText('36',{timeout:4000});
});
test('visibility restoration revalidates metadata even when the notification was missed',async({page,context})=>{
 await start(page);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 const editor=await context.newPage();await openEditor(editor, '/');await expect(editor.getByText(/生成完成/)).toBeVisible();await nativeChange(editor,'update');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(estimate(page)).toContainText('240000',{timeout:4000});
});

test('a running metadata read cannot publish the version replaced by a queued writer',async({page,context})=>{
 await start(page);const editor=await context.newPage();await openEditor(editor, '/');await expect(editor.getByText(/生成完成/)).toBeVisible();
 await editor.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('glyphforge-v1');r.onsuccess=()=>resolve(r.result);});
  const tx=db.transaction('resources','readwrite'),store=tx.objectStore('resources');(window as any).releaseEstimateWriter=false;
  (window as any).writerDone=new Promise<void>(resolve=>{tx.oncomplete=()=>{db.close();resolve();};});
  await new Promise<void>(resolve=>{const r=store.get('nature');r.onsuccess=()=>{const row=r.result;resolve();const hold=()=>{const pending=store.get('nature');pending.onsuccess=()=>{if((window as any).releaseEstimateWriter)store.put({...row,count:20000,version:row.version+1});else hold();};};hold();};});
 });
 await page.getByRole('button',{name:'估算当前工作流'}).click();await expect(estimate(page)).toHaveCount(0);
 await editor.evaluate(async()=>{(window as any).releaseEstimateWriter=true;await (window as any).writerDone;});
 await expect(estimate(page)).toContainText('240000');
});
