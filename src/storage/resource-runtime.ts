import { assertWorkflowPacks } from "./packs";
import { db, readStaticResource, type ForgeDatabase } from './db';
import type { Candidate, Resource } from '../core/model';
import { planResources, resourceDependents, validateResource, type ResourcePlan } from '../core/resource-catalog';
import { evaluateWorkflow } from '../core/engine';
import { ContractError, executionBudget } from '../core/contracts';

export async function captureResources(ids: string[], target = db) {
  return target.transaction('r',target.resources,async()=>planResources(ids,await target.resources.toArray()));
}
export async function assertResourcePlan(plan: ResourcePlan, target = db) {
  for(const r of plan.resources)if(r.definition?.type==="dynamic")await assertWorkflowPacks(r.definition.workflow,[],target);
  const current = await target.resources.bulkGet(plan.resources.map(r=>r.id));
  if(current.some((r,i)=>!r || r.version!==plan.resources[i].version || r.kind!==plan.resources[i].kind || JSON.stringify(r.definition)!==JSON.stringify(plan.resources[i].definition))) throw new ContractError({code:'RESOURCE',message:'源资源在运行期间发生更改或删除，请重新计算'});
}
export function resourceSession(plan: ResourcePlan, target: ForgeDatabase = db, signal?: AbortSignal) {
  const byId=new Map(plan.resources.map(r=>[r.id,r]));
  const started=performance.now(); let steps=0;
  const ownTick=()=>{if(signal?.aborted)throw new ContractError({code:'CANCELLED',message:'重算已取消'});if(++steps>executionBudget.steps || performance.now()-started>executionBudget.milliseconds)throw new ContractError({code:'BUDGET',message:'动态资源达到 300000 步 / 10 秒预算'});};
  async function* read(id:string,seed:number,tick:()=>void=ownTick):AsyncGenerator<Candidate> {
    tick(); if(signal?.aborted) ownTick();
    const r=byId.get(id);if(!r)throw new ContractError({code:'RESOURCE',message:`未声明依赖 ${id}`});
    if(r.kind==='mapping')throw new ContractError({code:'TYPE',message:'Mapping 不能作为词库读取'});
    await assertResourcePlan(plan,target);
    let count=0;
    const sequence=r.definition?.type==='dynamic'
      ? evaluateWorkflow({...r.definition.workflow,seed},read,tick,{resourceMetadata:async dep=>byId.get(dep)})
      : readStaticResource(id,seed,target);
    for await(const c of sequence) {
      tick(); if(signal?.aborted)ownTick();
      if(count%64===0)await assertResourcePlan(plan,target);
      if(r.definition?.type==='dynamic') {
        if(c.pair) throw new ContractError({code:'TYPE',message:'动态词库需投影为文本候选'});
        if(count>=r.definition.workflow.limit)break;
        yield {...c,parts:[...c.parts,{resourceId:id,version:r.version,text:c.text}]};
      } else yield c;
      count++;
    }
    await assertResourcePlan(plan,target);
  }
  return {read,check:()=>assertResourcePlan(plan,target),key:(seed:number)=>JSON.stringify([plan.key,seed]),metadata:async(id:string)=>byId.get(id)};
}
export async function saveDefinedResource(resource:Resource,expectedVersion?:number,target=db) {
  validateResource(resource);
  await target.transaction('rw',target.resources,async()=>{
    const previous=await target.resources.get(resource.id);
    if(!previous && expectedVersion!==undefined)throw new Error('资源已被删除，未恢复或覆盖任何资产');
    if(previous && previous.version!==expectedVersion)throw new Error('资源已被其他编辑器更改，请重新打开');
    if(previous && !previous.definition)throw new Error('不能覆盖静态用户资产');
    const next={...resource,version:previous?(previous.kind===resource.kind && JSON.stringify(previous.definition)===JSON.stringify(resource.definition)?previous.version:previous.version+1):1,count:resource.kind==='mapping'?Object.keys(JSON.parse(resource.definition?.type==='mapping'?resource.definition.rules:'{}')).length:0,updatedAt:Date.now()};
    planResources([next.id],[...(await target.resources.toArray()).filter(r=>r.id!==next.id),next]);
    await target.resources.put(next);
  });
}
export async function resourceWarnings(id:string,target=db) {
  const catalog=await target.resources.toArray();
  const dependents=resourceDependents(id,catalog);
  const {workflowResourceIds}=await import('../core/resource-catalog');
  const workflows=(await target.workflows.toArray()).filter(w=>workflowResourceIds(w).some(dep=>dep===id || dependents.some(r=>r.id===dep)));
  return [...dependents.map(r=>`资源「${r.name}」`),...workflows.map(w=>`工作流「${w.name}」`)];
}
