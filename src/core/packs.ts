import { ContractError, normalizeParams, operatorContracts } from './contracts';
import { operators } from './model';
import type { Params, RuleNode, Workflow } from './model';

export interface PackRef { id: string; version: string }
export interface PackParameter { type: 'string' | 'number' | 'boolean'; default: Params[string] }
export type SafeStep = { op: 'prefix' | 'reverse' | 'filter' | 'mapchars'; params: Params; bindings?: Record<string,string> };
export interface PackOperator {
  id: string; name: string; inputTypes: ['CandidateSequence']; outputType: 'CandidateSequence';
  parameters: Record<string,PackParameter>; steps: SafeStep[];
}
export interface ExtensionPack extends PackRef {
  format: 'glyphforge-operator-pack'; protocol: 1; publisher: string; source: string;
  compatibility: { ir: 1; contract: 1 }; permissions: []; mode: 'declarative-pipeline';
  deterministic: true; streaming: 'incremental'; dependencies: PackRef[];
  operators: PackOperator[];
  migrations: { from: string; operator: string; rename: Record<string,string> }[];
}
export const packKey = (p: PackRef) => `${p.id}@${p.version}`;
const safeName = (s: unknown): s is string => typeof s === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(s) && !['constructor','prototype'].includes(s);
const versionOK = (s: unknown): s is string => typeof s === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
function reject(message: string): never { throw new ContractError({code:'TYPE',message:`扩展包：${message}`}); }
/** Bound traversal before any clone/recursive interpretation; no compression or executable fields. */
export function guardJSON(value: unknown, maxBytes = 131072, maxNodes = 12000) {
  let size=0, count=0;
  const walk=(v:unknown,depth:number)=>{
    if(depth>20 || ++count>maxNodes)reject('JSON 深度/数量超过限制');
    if(typeof v==='string')size+=v.length*3;
    else if(typeof v==='number'){if(!Number.isFinite(v))reject('非有限数值');size+=16;}
    else if(v && typeof v==='object') {
      if(!Array.isArray(v) && ![Object.prototype,null].includes(Object.getPrototypeOf(v)))reject('仅接受 JSON 对象');
      for(const k of Object.keys(v)){if(['__proto__','prototype','constructor'].includes(k))reject('保留键');size+=k.length*3;walk((v as Record<string,unknown>)[k],depth+1);}
    } else if(v!==null && typeof v!=='boolean')reject('非 JSON 值');
    if(size>maxBytes)reject('JSON 大小超过限制');
  };walk(value,0);
}
function keys(v:object, allowed:string[]) { if(Object.keys(v).some(k=>!allowed.includes(k)))reject('未知字段或权限'); }
export function parsePack(text:string) { if(text.length>131072)reject('文件超过 128K；只接受未压缩 JSON');return validatePack(JSON.parse(text)); }
export function validatePack(value:unknown):ExtensionPack {
  guardJSON(value);
  const p=value as ExtensionPack;
  if(!p || p.format!=='glyphforge-operator-pack' || p.protocol!==1 || !safeName(p.id) || !versionOK(p.version))reject('格式/ID/版本不兼容');
  keys(p,['format','protocol','id','version','publisher','source','compatibility','permissions','mode','deterministic','streaming','dependencies','operators','migrations']);
  if(typeof p.publisher!=='string'||!p.publisher||p.publisher.length>100||typeof p.source!=='string'||!p.source||p.source.length>200)reject('发布者/来源无效');
  if(p.compatibility?.ir!==1||p.compatibility.contract!==1)reject('IR/契约范围不兼容');keys(p.compatibility,['ir','contract']);
  if(!Array.isArray(p.permissions)||p.permissions.length||p.mode!=='declarative-pipeline'||p.deterministic!==true||p.streaming!=='incremental')reject('执行模式/权限不受支持');
  if(!Array.isArray(p.dependencies)||p.dependencies.length>16)reject('依赖超过限制');
  const deps=new Set<string>();for(const d of p.dependencies){keys(d,['id','version']);if(!safeName(d.id)||!versionOK(d.version)||deps.has(packKey(d)))reject('依赖 ID/版本重复或无效');deps.add(packKey(d));}
  if(!Array.isArray(p.operators)||!p.operators.length||p.operators.length>16)reject('算子数为 1–16');
  const ids=new Set<string>();
  for(const o of p.operators){
    keys(o,['id','name','inputTypes','outputType','parameters','steps']);
    if(!safeName(o.id)||Object.hasOwn(operators,o.id)||ids.has(o.id)||typeof o.name!=='string'||!o.name||o.name.length>80)reject('算子 ID 重复、遮蔽内置或名称无效');ids.add(o.id);
    if(JSON.stringify(o.inputTypes)!=='["CandidateSequence"]'||o.outputType!=='CandidateSequence')reject('只支持单序列输入输出');
    if(!o.parameters||Array.isArray(o.parameters)||Object.keys(o.parameters).length>16)reject('参数无效');
    for(const [k,v] of Object.entries(o.parameters)){keys(v,['type','default']);if(!/^[a-z][a-zA-Z0-9]{0,31}$/.test(k)||!['string','number','boolean'].includes(v.type)||typeof v.default!==v.type||(typeof v.default==='string'&&v.default.length>256))reject('参数类型/默认值无效');}
    if(!Array.isArray(o.steps)||!o.steps.length||o.steps.length>16)reject('流水线为 1–16 步');
    for(const s of o.steps){
      keys(s,['op','params','bindings']);if(!['prefix','reverse','filter','mapchars'].includes(s.op)||!s.params||Array.isArray(s.params))reject('仅允许白名单流水线');
      const contract=operatorContracts[s.op];
      if(Object.keys(s.params).some(k=>!Object.hasOwn(contract.parameters,k)))reject('未知步骤参数');
      for(const [target,ref] of Object.entries(s.bindings??{}))if(!Object.hasOwn(contract.parameters,target)||!Object.hasOwn(o.parameters,ref)||contract.parameters[target].type!==o.parameters[ref].type)reject('参数绑定类型不匹配');
      // Resource IDs must enter through the explicit top-level mappingId port.
      if(s.op==='mapchars' && (s.params.mappingId || (s.bindings?.mappingId && s.bindings.mappingId!=='mappingId')))reject('资源引用必须显式绑定 mappingId');
      normalizeParams(s.op,{...s.params,...Object.fromEntries(Object.entries(s.bindings??{}).map(([k,ref])=>[k,o.parameters[ref].default]))});
    }
  }
  if(!Array.isArray(p.migrations)||p.migrations.length>16)reject('迁移数超过限制');
  for(const m of p.migrations){keys(m,['from','operator','rename']);if(!versionOK(m.from)||!ids.has(m.operator)||!m.rename||Object.entries(m.rename).some(([k,v])=>!safeName(k)||typeof v!=='string'||!Object.hasOwn(p.operators.find(o=>o.id===m.operator)!.parameters,v)))reject('迁移格式无效');}
  return structuredClone(p);
}
export function validatePacks(packs: ExtensionPack[] = []) {
  if(!Array.isArray(packs)||packs.length>32)reject('最多 32 个包版本');
  const byKey=new Map<string,ExtensionPack>();for(const raw of packs){const p=validatePack(raw),key=packKey(p);if(byKey.has(key))reject('包 ID/版本重复');byKey.set(key,p);}
  const active=new Set<string>(),done=new Set<string>();
  function visit(key:string,depth:number){if(active.has(key))reject(`循环依赖 ${key}`);if(done.has(key))return;if(depth>12)reject('依赖深度超过 12');const p=byKey.get(key);if(!p)reject(`缺失依赖或版本不匹配 ${key}`);active.add(key);for(const d of p.dependencies)visit(packKey(d),depth+1);active.delete(key);done.add(key);}
  for(const key of byKey.keys())visit(key,0);
}
export function resolveExtension(n:RuleNode,packs:ExtensionPack[]=[]) {
  const key=`${n.params.pack}@${n.params.version}`;
  const p=packs.find(p=>packKey(p)===key);if(!p)reject(`缺失扩展或版本不匹配 ${key}；原节点保留`);
  const o=p.operators.find(o=>o.id===n.params.operator);if(!o)reject(`未知全限定算子 ${key}/${n.params.operator}`);
  const values=JSON.parse(String(n.params.values));guardJSON(values,8192);
  if(!values||Array.isArray(values)||typeof values!=='object'||Object.keys(values).some(k=>!Object.hasOwn(o.parameters,k)))reject('未知调用参数');
  const params:Params={};for(const [k,d] of Object.entries(o.parameters)){const v=Object.hasOwn(values,k)?values[k]:d.default;if(typeof v!==d.type||(typeof v==='number'&&!Number.isFinite(v))||(typeof v==='string'&&v.length>256))reject(`参数 ${k} 类型/大小错误`);params[k]=v;}
  if(values.mappingId)reject('Mapping 引用必须使用显式 mappingId 端口');
  if(Object.hasOwn(o.parameters,'mappingId'))params.mappingId=String(n.params.mappingId||'');
  const steps=o.steps.map(s=>({...s,params:normalizeParams(s.op,{...s.params,...Object.fromEntries(Object.entries(s.bindings??{}).map(([k,ref])=>[k,params[ref]]))})}));
  return {pack:p,operator:o,steps};
}
export function validateWorkflowExtensions(w:Workflow) {
  validatePacks(w.extensions);
  for(const n of [...w.nodes,...(w.subgraphs??[]).flatMap(d=>d.nodes)])if(n.op==='extension')resolveExtension(n,w.extensions);
}
export function migrateExtension(n:RuleNode,target:ExtensionPack):RuleNode {
  if(n.params.pack!==target.id)reject('不能迁移到不同包');
  const m=target.migrations.find(m=>m.from===n.params.version&&m.operator===n.params.operator);if(!m)reject('没有显式迁移路径；禁止静默升级/降级');
  const old=JSON.parse(String(n.params.values));const next:Params={};for(const [k,v] of Object.entries(old))next[m.rename[k]??k]=v as Params[string];
  const result={...n,params:{...n.params,version:target.version,values:JSON.stringify(next)}};resolveExtension(result,[target]);return result;
}
const parameter=(type:PackParameter['type'],value:Params[string]):PackParameter=>({type,default:value});
export const firstPartyPacks:ExtensionPack[]=[{
  format:'glyphforge-operator-pack',protocol:1,id:'glyphforge-text',version:'1.0.0',publisher:'GlyphForge',source:'bundled:glyphforge-text',compatibility:{ir:1,contract:1},permissions:[],mode:'declarative-pipeline',deterministic:true,streaming:'incremental',dependencies:[],migrations:[],
  operators:[
    {id:'frame',name:'有界文字结构',inputTypes:['CandidateSequence'],outputType:'CandidateSequence',parameters:{prefix:parameter('string','「'),suffix:parameter('string','」'),mappingId:parameter('string','')},steps:[{op:'mapchars',params:{mapping:'{}'},bindings:{mappingId:'mappingId'}},{op:'prefix',params:{},bindings:{text:'prefix'}},{op:'reverse',params:{}},{op:'prefix',params:{},bindings:{text:'suffix'}},{op:'reverse',params:{}}]},
    {id:'select',name:'组合条件筛选',inputTypes:['CandidateSequence'],outputType:'CandidateSequence',parameters:{contains:parameter('string',''),excludes:parameter('string',''),maxLength:parameter('number',12)},steps:[{op:'filter',params:{},bindings:{includes:'contains',maxLength:'maxLength'}},{op:'filter',params:{},bindings:{excludes:'excludes',maxLength:'maxLength'}}]},
  ],
}];
firstPartyPacks.push({...structuredClone(firstPartyPacks[0]),version:'2.0.0',operators:firstPartyPacks[0].operators.map(o=>o.id==='frame'?{...o,parameters:{...o.parameters,opening:o.parameters.prefix},steps:o.steps.map(s=>({...s,...(s.bindings?{bindings:Object.fromEntries(Object.entries(s.bindings).map(([k,v])=>[k,v==='prefix'?'opening':v]))}:{})}))}:o),migrations:[{from:'1.0.0',operator:'frame',rename:{prefix:'opening'}},{from:'1.0.0',operator:'select',rename:{}}]});
delete firstPartyPacks[1].operators[0].parameters.prefix;
export function trustedPack(p:ExtensionPack) {return firstPartyPacks.some(b=>JSON.stringify(b)===JSON.stringify(p));}
