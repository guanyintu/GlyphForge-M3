import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Workflow } from '../core/model';
import type { RunStats } from '../core/engine';
import { estimateWorkflow, estimateRevision } from '../storage/estimate';

export function ExecutionEstimate({workflow,stats,dirty}:{workflow:Workflow;stats?:RunStats;dirty:boolean}) {
  const [request,setRequest]=useState(0);
  const revision=useLiveQuery(()=>request?estimateRevision(workflow):undefined,[workflow,request]);
  const [state,setState]=useState<{result?:Awaited<ReturnType<typeof estimateWorkflow>>;error?:string}>({});
  useEffect(()=>{
    const controller=new AbortController();setState({});
    if(request&&!dirty)void estimateWorkflow(workflow,controller.signal).then(result=>{if(!controller.signal.aborted)setState({result});}).catch(e=>{if(!controller.signal.aborted)setState({error:String(e)});});
    return ()=>controller.abort();
  },[workflow,revision,request,dirty]);
  const r=state.result;
  return <details className="execution-estimate"><summary>规模与执行风险（只读）</summary>
    <button className="button" disabled={dirty} onClick={()=>setRequest(n=>n+1)}>估算当前工作流</button>
    <p>{dirty?'请先应用代码到节点。':!r&&!state.error?'尚无有效估算；编辑工作流或资源后自动失效并重算。':state.error}</p>
    {r&&<div role="status"><p>风险：{r.risk==='high'?'高':r.risk==='unknown'?'未知':'有界'} · 去重前候选{r.candidates.exact?'数量':'上界'}：{r.candidates.upper??'未知'} · 最大局部直积{r.combinations.exact?'数量':'上界'}：{r.combinations.upper??'未知'} · 子图深度 {r.depth}</p><ul>{r.reasons.map(s=><li key={s}>{s}</li>)}</ul></div>}
    <p>适用于当前种子和资源/Mapping/扩展版本；不预测精确耗时，不预读词条，不改变执行。</p>
    {stats&&<p>最近完成运行：{stats.count} 项 · {stats.steps} 步 · {stats.duration.toFixed(1)} ms · {stats.truncated?'结果截断':'未因结果限额截断'} · 省略元数据构造 {stats.safePruned??0} 次。部分失败/取消结果不代表完整规模。</p>}
  </details>;
}
