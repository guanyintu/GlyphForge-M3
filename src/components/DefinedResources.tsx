import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Resource, Workflow } from '../core/model';
import { db, deleteResource } from '../storage/db';
import { planResources, resourceDependencies } from '../core/resource-catalog';
import { resourceWarnings, saveDefinedResource } from '../storage/resource-runtime';
import { resourceWorkflow } from '../core/resource-package';
import { exportPackage, importPackage, download } from '../core/sharing';
import { toScript, parseScript } from '../core/script';

export function newDefinedResource(type:'dynamic'|'mapping',workflow?:Workflow):Resource & {draft:true} {
  return {draft:true,id:crypto.randomUUID(),name:type==='mapping'?'我的 Mapping':'我的动态词库',description:type==='mapping'?'独立、可复用的字符候选规则':'按需派生，源变化后重算',kind:type==='mapping'?'mapping':'word',color:'purple',count:0,version:1,updatedAt:Date.now(),definition:type==='mapping'?{format:1,type,rules:'{"月":["玥"],"星":["☆"]}'}:{format:1,type,workflow:structuredClone(workflow??resourceWorkflow('nature'))}};
}
export function ImportDefinedResource({onOpen,notify}:{onOpen:(r:Resource)=>void;notify:(s:string)=>void}) {
  return <label className="button file-button">导入资源包<input type="file" accept=".json" aria-label="导入资源包" onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try {if(file.size>16*1024*1024)throw new Error('资源包最多16MiB');const p=JSON.parse(await file.text());
      if(p.format==='glyphforge-mapping' && p.version===1) {const r={...p.resource,id:crypto.randomUUID()};if(r.definition?.type!=='mapping')throw new Error('Mapping 格式无效');await saveDefinedResource(r);onOpen((await db.resources.get(r.id))!);}
      else {const w=await importPackage(p);const id=String(w.nodes.find(n=>n.op==='resource')?.params.resourceId??'');const r=await db.resources.get(id);if(r)onOpen(r);}
      notify('资源已导入，冲突 ID 已重分配');
    } catch(err){notify(String(err));}
  }}/></label>;
}
export function ResourceDependencyNotice({id}:{id:string}) {
  const warnings=useLiveQuery(()=>resourceWarnings(id),[id])??[];
  return <p className="field-note" role="note">{warnings.length?`编辑或删除会使以下依赖重算/缺失：${warnings.join('、')}`:'当前没有已保存的下游依赖。'}</p>;
}
export function DefinedResourceEditor({resource,onClose,notify,onUse,currentWorkflow}:{resource:Resource;onClose:()=>void;notify:(s:string)=>void;onUse:(w:Workflow)=>void;currentWorkflow:Workflow}) {
  const catalog=useLiveQuery(()=>db.resources.toArray(),[])??[];
  const current=catalog.find(r=>r.id===resource.id);
  const [name,setName]=useState(resource.name),[rules,setRules]=useState(resource.definition?.type==='mapping'?resource.definition.rules:'{}');
  const [definition,setDefinition]=useState<Workflow>(resource.definition?.type==='dynamic'?resource.definition.workflow:resourceWorkflow('nature'));
  const [code,setCode]=useState(()=>toScript(definition));
  const [source,setSource]=useState(String(definition.nodes.find(n=>n.op==='resource')?.params.resourceId??'nature'));
  const [mapping,setMapping]=useState(String(definition.nodes.find(n=>n.op==='mapchars')?.params.mappingId??''));
  const [prefix,setPrefix]=useState('');
  const [error,setError]=useState(''),[status,setStatus]=useState('尚未计算'),[rows,setRows]=useState<string[]>([]),[page,setPage]=useState(0),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const worker=useRef<Worker|null>(null),[expected,setExpected]=useState<number|undefined>("draft" in resource?undefined:resource.version);
  const isMap=resource.definition?.type==='mapping';
  let signature='',dependencyError='';let dependencies:Resource[]=[];
  try {if(current){const p=planResources([resource.id],catalog);signature=p.key;dependencies=p.resources;}}catch(e){dependencyError=String(e);}
  useEffect(()=>{worker.current?.terminate();worker.current=null;setBusy(false);setRows([]);setPage(0);setStatus('源或定义已变化，等待重算');return()=>{worker.current?.terminate();worker.current=null;};},[signature,dependencyError]);
  function setWorkflow(w:Workflow){setDefinition(w);setCode(toScript(w));}
  function assemble(){const w=resourceWorkflow(source);if(catalog.find(r=>r.id===source)?.kind==='relation')w.nodes[0]={id:'source',op:'template',inputs:[],params:{slots:JSON.stringify([{name:'pair',resourceId:source,kind:'pair',relation:''}]),templates:'["{pair.left}","{pair.right}"]',separator:' / ',maxLength:100,equalLength:false}};
    let input='source';if(mapping){w.nodes.splice(-1,0,{id:'map',op:'mapchars',inputs:[input],params:{mappingId:mapping}});input='map';}if(prefix){w.nodes.splice(-1,0,{id:'prefix',op:'prefix',inputs:[input],params:{text:prefix}});input='prefix';}w.nodes.at(-1)!.inputs=[input];setWorkflow(w);
  }
  async function save(){try{const next={...resource,name,definition:isMap?{format:1 as const,type:'mapping' as const,rules}:{format:1 as const,type:'dynamic' as const,workflow:parseScript(code,definition)}};if("draft" in next)delete next.draft;await saveDefinedResource(next,expected);setExpected((await db.resources.get(resource.id))!.version);setError('');notify('资源定义已保存；下游将在下次读取时重算');}catch(e){setError(String(e));}}
  function preview(nextPage:number){worker.current?.terminate();const w=new Worker(new URL('../workers/resource-preview.worker.ts',import.meta.url),{type:'module'});worker.current=w;setRows([]);setBusy(true);setStatus('正在按源版本重算…');setError('');
    w.onmessage=({data})=>{if(worker.current!==w)return;setBusy(false);if(data.type==='done'){setRows(data.rows);setPage(nextPage);setMore(data.more);setStatus(`重算完成 · 第 ${nextPage+1} 页 · 本页 ${data.rows.length} 条`);}else{setError(data.message);setStatus('重算失败');}w.terminate();worker.current=null;};w.onerror=()=>{if(worker.current!==w)return;setBusy(false);setError('后台重算失败');w.terminate();worker.current=null;};w.postMessage({id:resource.id,page:nextPage});
  }
  const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.focus();return()=>previous?.focus();},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section tabIndex={-1} ref={dialog} className="modal defined-resource" role="dialog" aria-modal="true" aria-label={isMap?'编辑 Mapping':'编辑动态词库'} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select')??[])];if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}}}>
    <div className="modal-heading"><h2>{isMap?'独立 Mapping':'动态词库'}</h2><button className="button" onClick={onClose} aria-label="关闭资源编辑器">关闭</button></div>
    <div className="modal-body defined-grid"><div>
      <label className="field-label">资源名称<input value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label>
      <p className="field-note">稳定 ID：{resource.id} · v{current?.version??1} · 定义格式 v1</p>
      {isMap?<><label className="field-label">映射规则 JSON<textarea rows={9} maxLength={16384} value={rules} onChange={e=>setRules(e.target.value)} spellCheck={false}/></label><p className="field-note">单码点 → 1–32 个候选；最多256键，空对象表示保留原文。概率和候选上限由使用它的算子控制。</p></>:<>
        <label className="field-label">派生源<select value={source} onChange={e=>setSource(e.target.value)}>{!catalog.some(r=>r.id===source)?<option value={source}>缺失 {source}</option>:null}{catalog.filter(r=>r.id!==resource.id&&r.kind!=='mapping').map(r=><option value={r.id} key={r.id}>{r.name} · v{r.version}</option>)}</select></label>
        <label className="field-label">应用 Mapping<select value={mapping} onChange={e=>setMapping(e.target.value)}><option value="">保留原文</option>{mapping&&!catalog.some(r=>r.id===mapping)?<option value={mapping}>缺失 {mapping}</option>:null}{catalog.filter(r=>r.kind==='mapping').map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
        <label className="field-label">派生前缀<input value={prefix} maxLength={256} onChange={e=>setPrefix(e.target.value)}/></label>
        <div className="row"><button className="button" onClick={assemble}>生成派生定义</button><button className="button" onClick={()=>setWorkflow(structuredClone(currentWorkflow))}>使用当前工作流定义</button></div>
        <label className="field-label">动态定义 NameScript<textarea rows={9} value={code} maxLength={65536} onChange={e=>setCode(e.target.value)} spellCheck={false}/></label>
      </>}
      <ResourceDependencyNotice id={resource.id}/>
      <button className="primary-button" disabled={busy} onClick={save}>保存资源定义</button>
    </div><div>
      <h3>依赖与源版本</h3>{dependencyError?<p role="alert">{dependencyError}</p>:<ul className="dependency-list">{dependencies.map(r=><li key={r.id}><b>{r.name}</b> · {r.definition?.type??'static'} · v{r.version}<small>{resourceDependencies(r).map(id=>catalog.find(x=>x.id===id)?.name??`缺失 ${id}`).join('、')||'无上游'}</small></li>)}</ul>}
      {!isMap?<><p className="field-note">读取已保存定义。固定种子42；每页60条，最多10,000候选；深页按需重放，共享300,000步/10秒。源变化清空预览；不保存候选缓存。</p>
        <div className="row"><button className="button" disabled={busy||!current||!!dependencyError} onClick={()=>preview(0)}>重算预览</button><button className="button" disabled={!busy} onClick={()=>{worker.current?.terminate();worker.current=null;setBusy(false);setStatus('重算已取消');}}>取消重算</button></div>
        <p role="status">{status}</p><div className="resource-words preview-words">{rows.map((text,i)=><span key={i}>{text}</span>)}</div>
        <div className="row"><button className="button" disabled={busy||page===0} onClick={()=>preview(page-1)}>上一页</button><button className="button" disabled={busy||!more} onClick={()=>preview(page+1)}>下一页</button><button className="button" disabled={!current||!!dependencyError} onClick={()=>{onUse(resourceWorkflow(resource.id));onClose();}}>在工作流中使用</button></div>
      </>:null}
      {error?<p role="alert">{error}</p>:null}
    </div></div>
    <div className="modal-footer"><button className="danger-button" disabled={!current||busy} onClick={async()=>{if(!confirm){setConfirm(true);return;}try{await deleteResource(resource.id);onClose();notify('资源已删除；下游依赖将显示缺失');}catch(e){setError(String(e));}}}>{confirm?'确认删除资源':'删除资源'}</button><button className="button" disabled={!current||busy} onClick={async()=>{try{const data=isMap?{format:'glyphforge-mapping',version:1,resource:current}:await exportPackage(resourceWorkflow(resource.id));download(`${name}.json`,JSON.stringify(data,null,2));}catch(e){setError(String(e));}}}>导出资源与依赖</button></div>
  </section></div>;
}
