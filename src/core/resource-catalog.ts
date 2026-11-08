import type { Resource, Workflow } from './model';
import { allNodes } from './subgraphs';
import { nodeResourceBindings, normalizeParams, ContractError, operatorContracts } from './contracts';
import { programResources, visitProgramExpressions } from './program';
import { validateGraph } from './script';
import { parseCharacterMap } from './chinese-definitions';

export type ResourceDefinition =
  | { format: 1; type: 'dynamic'; workflow: Workflow }
  | { format: 1; type: 'mapping'; rules: string };
export function workflowResourceIds(workflow: Workflow): string[] {
  return [...new Set(allNodes(workflow).flatMap(n => n.program ? programResources(n.program) : nodeResourceBindings(n.op, normalizeParams(n.op, n.params)).map(b => b.id)))];
}
export function resourceDependencies(r: Resource): string[] {
  return r.definition?.type === 'dynamic' ? workflowResourceIds(r.definition.workflow) : [];
}
export function validateResource(r: Resource) {
  if (!r || typeof r.id !== 'string' || !r.id || r.id.length > 256 || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 100 || !Number.isSafeInteger(r.version) || r.version < 1 || !['word','character','symbol','relation','mapping'].includes(r.kind)) throw new Error('资源元数据无效');
  const d = r.definition;
  if (!d) { if (r.kind === 'mapping') throw new Error('Mapping 缺少定义'); return; }
  if (d.format !== 1) throw new Error('资源定义版本不兼容');
  if (d.type === 'mapping') { if (r.kind !== 'mapping') throw new Error('Mapping 类型不匹配'); parseCharacterMap(d.rules); }
  else if (d.type === 'dynamic') {
    if (r.kind !== 'word') throw new Error('动态资源输出须为普通候选');
    validateGraph(d.workflow);
    if (JSON.stringify(d.workflow).length > 65536) throw new Error('动态定义超过 64K');
    // Parameterized resource IDs cannot be enumerated safely at planning time.
    for (const n of allNodes(d.workflow)) { if(n.program)visitProgramExpressions(n.program,e=>{if(e.kind==="call" && ["resource","pairs"].includes(e.name) && (e.args[0]?.kind!=="literal" || typeof e.args[0].value!=="string"))throw new Error("动态资源依赖必须使用固定 ID");}); if (n.parameterBindings && Object.keys(n.parameterBindings).some(k => /resourceId|mappingId|slots/.test(k))) throw new Error('动态资源依赖必须使用固定 ID'); }
  } else throw new Error('未知资源定义');
}
export interface ResourcePlan { resources: Resource[]; versions: Record<string, number>; key: string }
/** One metadata snapshot, topological order, unique diamond vertices, bounded DFS. */
export function planResources(roots: string[], catalog: Resource[]): ResourcePlan {
  const byId = new Map(catalog.map(r => [r.id, r]));
  const done = new Set<string>(), active = new Set<string>(), ordered: Resource[] = [];
  function visit(id: string, path: string[]) {
    if (active.has(id)) throw new ContractError({code:'RESOURCE',message:`资源循环：${[...path,id].join(' → ')}`});
    if (done.has(id)) return;
    if (path.length >= 12 || done.size + active.size >= 100) throw new ContractError({code:'BUDGET',message:'资源依赖最多 12 层 / 100 个资源'});
    const r = byId.get(id);
    if (!r) throw new ContractError({code:'RESOURCE',message:`缺失依赖 ${id}（${path.join(' → ')}）`});
    validateResource(r); active.add(id);
    for (const dep of resourceDependencies(r)) visit(dep,[...path,id]);
    active.delete(id); done.add(id); ordered.push(structuredClone(r));
  }
  roots.forEach(id => visit(id,[]));
  for(const r of ordered)if(r.definition?.type==="dynamic")for(const n of allNodes(r.definition.workflow))for(const b of nodeResourceBindings(n.op,normalizeParams(n.op,n.params))) {const target=byId.get(b.id)!;if(b.mapping ? target.kind!=="mapping" : target.kind==="mapping" || (target.kind==="relation")!==b.pair)throw new ContractError({code:"TYPE",message:`资源 ${r.id} 的依赖 ${b.id} 类型不匹配`});}
  const versions = Object.fromEntries(ordered.map(r => [r.id,r.version]));
  // Exact collision-free signature; includes definitions, algorithm contract and all source versions.
  const key = JSON.stringify(['glyphforge-resource',1,ordered.map(r => [r.id,r.kind,r.version,r.definition ?? null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
  return {resources:ordered,versions,key};
}
export function resourceDependents(id: string, catalog: Resource[]) {
  const found = new Set<string>();
  for (let changed=true; changed;) { changed=false; for (const r of catalog) if (r.id !== id && !found.has(r.id) && resourceDependencies(r).some(dep=>dep===id || found.has(dep))) {found.add(r.id);changed=true;} }
  return catalog.filter(r=>found.has(r.id));
}
export function rebindWorkflowResources(workflow: Workflow, mapping: Map<string,string>) {
  for (const node of allNodes(workflow)) {
    for (const key of ['resourceId','mappingId','reviewedResourceId']) if (node.params[key] && mapping.has(String(node.params[key]))) node.params[key]=mapping.get(String(node.params[key]))!;
    if (node.op === 'template') { const slots=JSON.parse(String(node.params.slots)); for(const s of slots) s.resourceId=mapping.get(s.resourceId) ?? s.resourceId; node.params.slots=JSON.stringify(slots); }
    if (node.program) {
      // Existing program resource references are literals; visit through its public traversal.
      rebindProgram(node.program,mapping);
    }
  }
}
function rebindProgram(program: import('./program').Program, mapping: Map<string,string>) {
  visitProgramExpressions(program,e=>{ if(e.kind==='call' && ['mapchars','hanconvert'].includes(e.name)){const i=operatorContracts[e.name as 'mapchars'|'hanconvert'].ast!.parameters!.indexOf('mappingId');const ref=e.args[i];if(ref?.kind==='literal'&&mapping.has(String(ref.value)))ref.value=mapping.get(String(ref.value))!;} if(e.kind==='resource' && mapping.has(e.id))e.id=mapping.get(e.id)!; if(e.kind==='call' && ['resource','pairs'].includes(e.name) && e.args[0]?.kind==='literal' && mapping.has(String(e.args[0].value))) e.args[0].value=mapping.get(String(e.args[0].value))!; });
}
