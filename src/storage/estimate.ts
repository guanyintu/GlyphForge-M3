import type { Workflow } from '../core/model';
import { estimateGraph } from '../core/estimate';
import { db, type ForgeDatabase } from './db';
import { planResources, workflowResourceIds, resourceDependencies } from '../core/resource-catalog';
import type { Resource } from '../core/model';
import { assertWorkflowPacks } from './packs';

function cancelled(signal?:AbortSignal) {if(signal?.aborted)throw new Error('估算已取消');}
async function snapshot(w:Workflow,target:ForgeDatabase,signal?:AbortSignal) {
  cancelled(signal);
  // Metadata only; transaction makes resource/pack snapshot mutually consistent.
  return target.transaction('r',target.resources,target.extensionPacks,async()=>{
    const roots=workflowResourceIds(w),catalog:Resource[]=[],seen=new Set<string>();
    async function load(ids:string[],depth=0):Promise<void> {
      cancelled(signal);if(depth>12)throw new Error('资源依赖超过 12 层');
      const next=[...new Set(ids)].filter(id=>!seen.has(id));
      if(seen.size+next.length>100)throw new Error('资源依赖超过 100 项');next.forEach(id=>seen.add(id));
      const rows=await target.resources.bulkGet(next);cancelled(signal);
      const present=rows.filter((r):r is Resource=>!!r);catalog.push(...present);
      const deps=present.flatMap(resourceDependencies).filter(id=>!seen.has(id));if(deps.length)await load(deps,depth+1);
    }
    await load(roots);
    const plan=planResources(roots,catalog);cancelled(signal);
    await assertWorkflowPacks(w,plan.resources,target);
    const packs=await target.extensionPacks.toArray();cancelled(signal);
    return {plan,key:JSON.stringify([w,plan.key,plan.resources.map(r=>[r.id,r.count]),packs])};
  });
}
export async function estimateRevision(w:Workflow,target=db) {
  try{return (await snapshot(w,target)).key;}catch(e){return String(e);}
}
export async function estimateWorkflow(w:Workflow,signal?:AbortSignal,target=db) {
  // Detached request prevents edits while awaiting IDB from changing the estimate.
  const workflow=structuredClone(w),s=await snapshot(workflow,target,signal);
  const estimate=await estimateGraph(workflow,s.plan.resources,()=>cancelled(signal));
  const result={...estimate,key:s.key};
  if(!await estimateIsCurrent(workflow,result,signal,target))throw new Error('估算期间资源已更改，请重新估算');
  return result;
}
export async function estimateIsCurrent(w:Workflow,estimate:{key:string},signal?:AbortSignal,target=db) {
  return estimate.key===(await snapshot(structuredClone(w),target,signal)).key;
}
