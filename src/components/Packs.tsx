import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { installPacks, mergePacks, requiredPacks, packStatus, setPackEnabled } from '../storage/packs';
import { firstPartyPacks, packKey, parsePack, trustedPack, migrateExtension } from '../core/packs';
import type { ExtensionPack } from '../core/packs';
import type { RuleNode, Workflow } from '../core/model';
import { download } from '../core/sharing';
import '../p2d.css';

export function PacksPanel({workflow,onChange,notify}:{workflow:Workflow;onChange:(w:Workflow)=>void;notify:(s:string)=>void}) {
  const records=useLiveQuery(()=>db.extensionPacks.toArray(),[])??[];
  const [error,setError]=useState('');
  async function act(f:()=>Promise<unknown>){try{await f();setError('');}catch(e){setError(String(e));}}
  function add(p:ExtensionPack,operator:string){
    try {
      const extensions=mergePacks([workflow.extensions??[],requiredPacks({...workflow,nodes:[{id:"install",op:"extension",inputs:[],params:{pack:p.id,version:p.version}}],subgraphs:[],extensions:records.map(r=>r.manifest)})]);
      const id=`ext_${crypto.randomUUID().replaceAll('-','').slice(0,8)}`;
      const output=workflow.nodes.find(n=>n.op==='output');
      const input=output?.inputs[0]??workflow.nodes.find(n=>n.op!=='output')?.id??'';
      onChange({...workflow,extensions,nodes:[...workflow.nodes.filter(n=>n.id!==output?.id),{id,op:'extension',inputs:[input],params:{pack:p.id,version:p.version,operator,values:'{}',mappingId:''}},...(output?[{...output,inputs:[id]}]:[])],layout:{...workflow.layout,[id]:{x:550,y:350}}});
      notify(`已加入 ${packKey(p)}/${operator}`);
    }catch(e){setError(String(e));}
  }
  return <section className="packs-page"><div className="packs-intro"><span className="mono">GLYPHFORGE / EXTENSIONS</span><h1>让规则成为工具</h1><p>安装有界、可检查的声明式算子包。每个工作流固定版本，升级需要明确迁移。</p></div>
    <label className="button">导入声明式 JSON 包<input aria-label="导入扩展包" type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void act(async()=>{if(file.size>131072)throw new Error('扩展文件超过 128K；不支持压缩包');await installPacks([parsePack(await file.text())]);});e.target.value='';}}/></label>
    {error?<p role="alert">{error}</p>:null}
    <div className="packs-grid">{mergePacksForDisplay(records.map(r=>r.manifest)).map(p=>{const installed=records.find(r=>r.key===packKey(p));return <article className="pack-card" key={packKey(p)}><span className="pack-trust">{trustedPack(p)?'可信第一方（随代码发布）':'未验证发布者 · 声明式受限执行'}</span><h2>{p.id} <small>{p.version}</small></h2><p role="status">{packStatus(p,records)}</p><dl><dt>发布者 / 来源</dt><dd>{p.publisher} / {p.source}</dd><dt>兼容范围</dt><dd>IR 1 · 契约 1 · 无网络/文件权限</dd><dt>依赖</dt><dd>{p.dependencies.map(packKey).join('、')||'无'}</dd></dl><details><summary>协议与算子详情</summary><p>增量流式 · 固定种子/资源版本确定性 · 继承运行预算；program AST / 文字实验室不适用。</p><pre>{JSON.stringify(p,null,2)}</pre></details><div className="row">{installed?<><button className="button" onClick={()=>void act(()=>setPackEnabled(packKey(p),!installed.enabled))}>{installed.enabled?'禁用':'启用'} {p.version}</button><button className="text-button" onClick={()=>void act(()=>db.extensionPacks.delete(packKey(p)))}>卸载 {p.version}</button></>:<button className="primary-button" onClick={()=>void act(()=>installPacks([p]))}>安装 {p.version}</button>}<button className="text-button" onClick={()=>download(`${packKey(p)}.json`,JSON.stringify(p,null,2))}>导出声明</button></div><div className="pack-operators">{p.operators.map(o=><button className="button" key={o.id} disabled={!packStatus(p,records).includes('兼容')} onClick={()=>add(p,o.id)}>添加{o.name} {p.version}</button>)}</div></article>;})}</div>
  </section>;
}
function mergePacksForDisplay(installed:ExtensionPack[]) {const map=new Map(firstPartyPacks.map(p=>[packKey(p),p]));for(const p of installed)map.set(packKey(p),p);return [...map.values()];}
export function ExtensionInspector({node,workflow,onChange}:{node:RuleNode;workflow:Workflow;onChange:(w:Workflow)=>void}) {
  const records=useLiveQuery(()=>db.extensionPacks.toArray(),[])??[];
  const [error,setError]=useState('');
  const p=workflow.extensions?.find(p=>p.id===node.params.pack&&p.version===node.params.version),o=p?.operators.find(o=>o.id===node.params.operator);
  const update=(n:RuleNode)=>onChange({...workflow,nodes:workflow.nodes.map(x=>x.id===n.id?n:x)});
  let values:Record<string,string|number|boolean>={};try{values=JSON.parse(String(node.params.values));}catch{/* Invalid text stays editable below. */}
  return <div className="extension-inspector"><b>{String(node.params.pack)}@{String(node.params.version)}/{String(node.params.operator)}</b><p role="status">{p?packStatus(p,records):'缺失扩展声明；原节点保留'}</p>{Object.entries(o?.parameters??{}).filter(([k])=>k!=='mappingId').map(([k,d])=><label className="field-label" key={k}>{k}<input aria-label={`扩展参数 ${k}`} type={d.type==='number'?'number':'text'} value={String(values[k]??d.default)} onChange={e=>update({...node,params:{...node.params,values:JSON.stringify({...values,[k]:d.type==='number'?Number(e.target.value):d.type==='boolean'?e.target.value==='true':e.target.value})}})}/></label>)}{o?.parameters.mappingId?<label className="field-label">Mapping 资源 ID<input aria-label="扩展 Mapping ID" value={String(node.params.mappingId)} onChange={e=>update({...node,params:{...node.params,mappingId:e.target.value}})}/></label>:null}<p className="field-note">图式 NameScript 与序列函数支持。program AST / 文字实验室不适用。</p>{records.filter(r=>r.manifest.id===node.params.pack&&r.manifest.version!==node.params.version).map(r=><button className="button" key={r.key} onClick={()=>{try{const next=migrateExtension(node,r.manifest);onChange({...workflow,extensions:mergePacks([workflow.extensions??[],[r.manifest]]),nodes:workflow.nodes.map(n=>n.id===node.id?next:n)});setError('');}catch(e){setError(String(e));}}}>显式迁移至 {r.manifest.version}</button>)}{error?<p role="alert">{error}</p>:null}<button className="button" onClick={()=>onChange({...workflow,nodes:workflow.nodes.map(n=>n.op==='output'?{...n,inputs:[node.id]}:n)})}>连接到结果输出</button></div>;
}
