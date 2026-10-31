import type { Workflow, Resource, RuleNode, Params } from './model';
import { validateGraph } from './script';
import { callBindings, definitionFor } from './subgraphs';
import { normalizeParams, nodeResourceBindings, requireResourceKind, executionBudget } from './contracts';

/** Decimal strings avoid Number overflow and are safe to persist/postMessage. */
export interface Scale { upper?: string; exact: boolean }
export interface Estimate {
  candidates: Scale; combinations: Scale; limit: number; depth: number;
  risk: 'high' | 'bounded' | 'unknown'; reasons: string[];
}
type Bound = { upper?: bigint; exact: boolean };
const unknown = (): Bound => ({exact:false});
const scale = (b: Bound): Scale => ({upper:b.upper?.toString(),exact:b.exact});
/** No candidates, resource rows, RNG or executor are consumed. Counts describe
 * pre-dedup sequence cardinality, never final unique results or elapsed time. */
export async function estimateGraph(w: Workflow, resources: Resource[], check: () => void = () => {}): Promise<Estimate> {
  check(); validateGraph(w);
  const byId=new Map(resources.map(r=>[r.id,r])), reasons=new Set<string>();
  let maxDepth=0, largest:Bound={upper:0n,exact:true}, visits=0;
  const meta=async(id:string)=>byId.get(id);
  // Bindings/kinds are checked even for unsupported cardinality operators.
  for(const n of [...w.nodes,...(w.subgraphs??[]).flatMap(d=>d.nodes)]) {
    check();
    for(const b of nodeResourceBindings(n.op,normalizeParams(n.op,n.params)))await requireResourceKind(meta,b.id,b.pair,b.mapping);
  }
  function visit(n:RuleNode, nodes:Map<string,RuleNode>, bindings:Params={}, args:Record<string,()=>Bound>={}, depth=0):Bound {
    check();if(++visits>10000) {reasons.add('估算展开超过 10000 节点，保守返回未知');return unknown();}
    maxDepth=Math.max(maxDepth,depth);
    const p={...n.params};for(const [k,v] of Object.entries(n.parameterBindings??{}))p[k]=bindings[v];
    const input=(i:number)=>visit(nodes.get(n.inputs[i])!,nodes,bindings,args,depth);
    if(n.op==='argument')return args[String(p.name)]();
    if(n.op==='call') {
      const d=definitionFor(n,w.subgraphs),local=callBindings(n,d,bindings),inner=new Map(d.nodes.map(n=>[n.id,n]));
      const a=Object.fromEntries(d.parameters.filter(p=>p.type==='CandidateSequence').map((p,i)=>[p.name,()=>input(i)]));
      return visit(inner.get(d.output)!,inner,local,a,depth+1);
    }
    if(n.op==='resource'||n.op==='pairs') {
      const r=byId.get(String(p.resourceId))!;
      if(r.definition?.type==='dynamic') { largest=unknown();reasons.add(`动态源 ${r.name} 的 count 不是实体数量；范围 0–${r.definition.workflow.limit}，内部枚举未知`);return {upper:BigInt(r.definition.workflow.limit),exact:false}; }
      if(!Number.isSafeInteger(r.count)||r.count<0){reasons.add(`资源 ${r.name} 数量不可用`);return unknown();}
      return {upper:BigInt(r.count),exact:n.op==='resource'};
    }
    if(n.op==='concat'||n.op==='pattern') {
      const a=input(0),b=input(1),result={upper:a.upper===undefined||b.upper===undefined?undefined:a.upper*b.upper,exact:a.exact&&b.exact};
      if(result.upper===undefined)largest=unknown();else if(largest.upper!==undefined&&result.upper>largest.upper)largest=result;
      return result;
    }
    if(['prefix','reverse','output'].includes(n.op))return input(0);
    if(n.op==='filter'||n.op==='gamecheck')return {...input(0),exact:false};
    largest=unknown();reasons.add(`${n.op} 的输出/内部枚举规模未知`);return unknown();
  }
  const output=visit(w.nodes.find(n=>n.op==='output')!,new Map(w.nodes.map(n=>[n.id,n])));
  const high=(largest.upper??0n)>BigInt(executionBudget.steps/3)||(output.upper??0n)>BigInt(w.limit);
  reasons.add('静态数量来自版本化元数据；字符串超限、去重和过滤可能降低输出，内部重复读取不等于候选数');
  reasons.add(`输出至多 ${w.limit}；为确认截断可能读取下一项，拒绝项仍消耗步骤；共享 300000 步 / 10 秒`);
  return {candidates:scale(output),combinations:scale(largest),limit:w.limit,depth:maxDepth,risk:high?'high':!output.exact||largest.upper===undefined?'unknown':'bounded',reasons:[...reasons]};
}
