import { mergePacks, workflowPacks } from '../core/pack-dependencies';
export { mergePacks, requiredPacks, workflowPacks } from '../core/pack-dependencies';
import { db, type ForgeDatabase } from './db';
import { packKey, validatePack, validatePacks, trustedPack } from '../core/packs';
import type { ExtensionPack } from '../core/packs';
import type { Resource, Workflow } from '../core/model';
import { ContractError } from '../core/contracts';

export interface InstalledPack { key: string; manifest: ExtensionPack; enabled: boolean }
/** Called inside the asset import transaction too. Existing enablement is never changed by import. */
export async function installPacks(packs:ExtensionPack[],target:ForgeDatabase=db) {
  const validated=packs.map(validatePack);
  await target.transaction('rw',target.extensionPacks,async()=>{
    const current=await target.extensionPacks.toArray();
    if(current.length+validated.filter(p=>!current.some(c=>c.key===packKey(p))).length>32)throw new Error('本地最多安装 32 个包版本');
    const merged=mergePacks([current.map(c=>c.manifest),validated]);validatePacks(merged);
    for(const p of validated)if(!current.some(c=>c.key===packKey(p)))await target.extensionPacks.add({key:packKey(p),manifest:p,enabled:trustedPack(p)});
  });
}
export function packStatus(p:ExtensionPack,records:InstalledPack[]) {
  const record=records.find(r=>r.key===packKey(p));
  if(!record)return '缺失扩展：未安装';
  if(JSON.stringify(record.manifest)!==JSON.stringify(p))return '同 ID/版本内容冲突';
  if(!record.enabled)return '已安装 / 已禁用';
  const walk=(item:ExtensionPack,seen=new Set<string>()):string=>{if(seen.has(packKey(item)))return '';seen.add(packKey(item));for(const dep of item.dependencies){const d=records.find(r=>r.key===packKey(dep));if(!d?.enabled)return `依赖未启用或缺失 ${packKey(dep)}`;const issue=walk(d.manifest,seen);if(issue)return issue;}return '';};
  return walk(p)||'已安装 / 已启用 / 兼容';
}
export async function setPackEnabled(key:string,enabled:boolean,target=db) {
  await target.transaction('rw',target.extensionPacks,async()=>{const records=await target.extensionPacks.toArray(),r=records.find(r=>r.key===key);if(!r)throw new Error('扩展未安装');if(enabled){validatePacks(records.map(r=>r.manifest));const status=packStatus(r.manifest,records.map(p=>p.key===key?{...p,enabled:true}:p));if(!status.includes('兼容'))throw new Error(status);}await target.extensionPacks.update(key,{enabled});});
}
export async function assertWorkflowPacks(w:Workflow,resources:Resource[]=[],target:ForgeDatabase=db) {
  const packs=workflowPacks(w,resources);if(!packs.length)return;
  const records=await target.extensionPacks.toArray();
  for(const p of packs){const status=packStatus(p,records);if(!status.includes('兼容'))throw new ContractError({code:'TYPE',operator:packKey(p),message:`扩展 ${packKey(p)}：${status}；保留原节点，请安装或启用精确版本`});}
}
