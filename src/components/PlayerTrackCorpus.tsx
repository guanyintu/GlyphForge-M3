import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowUpFromLine, Check, Database, Play } from "lucide-react";
import { corpusModes, corpusStyles } from "../core/corpus";
import type { CorpusMaterial, CorpusRelation, CorpusStyle, Review } from "../core/corpus";
import type { Entry, Workflow } from "../core/model";
import { configureCorpus, corpusId, corpusWorkflow, exportCorpus, installBaseCorpus, installCorpus, loadBundled, reviewMaterials, updateCorpusRelation, updateMaterials } from "../storage/corpus";
import { db } from "../storage/db";
import { download } from "../core/sharing";
import report from "../../data/playertrack/report.json";
import "../corpus.css";

const PAGE = 50;
type Tab = "all" | "character" | "bigram" | "trigram" | "phrase" | "repeat" | "relation";
const tabs: [Tab,string][] = [["all","全部"],["character","单字"],["bigram","双字词"],["trigram","三字词"],["phrase","长短语"],["repeat","叠字"],["relation","组合关系"]];
const reviewLabels = {AUTO:"自动分类",PENDING:"待审核",APPROVED:"已批准",REJECTED:"已拒绝"};
const observedLengths=report.lengths.filter(r=>r.rawRecords>0).map(r=>r.length);
const sourceRange=`${Math.min(...observedLengths)}—${Math.max(...observedLengths)} 字`;

export default function PlayerTrackCorpus({ onUse, notify }: { onUse: (workflow: Workflow) => void; notify: (message: string) => void }) {
  const [style, setStyle] = useState<CorpusStyle | "all">("haidu");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState(""); const deferredSearch = useDeferredValue(search);
  const [position, setPosition] = useState(""); const [review, setReview] = useState(""); const [semantic, setSemantic] = useState("");
  const [length, setLength] = useState(""); const [frequency, setFrequency] = useState(0); const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]); const [editing, setEditing] = useState<CorpusMaterial>();
  const [editingRelation,setEditingRelation]=useState<CorpusRelation>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [mode, setMode] = useState("style"); const [minimum, setMinimum] = useState(2); const [maximum, setMaximum] = useState(3);
  const input = useRef<HTMLInputElement>(null), id = corpusId(style);
  const resources = useLiveQuery(() => db.resources.toArray(), []) || [];
  const resource = resources.find(r => r.id === id), version = resource?.version;
  const relationVersion = resources.find(r => r.id === `${id}-relations`)?.version;
  function reset() { setPage(0); setSelected([]); setEditing(undefined);setEditingRelation(undefined); }
  function choose(next: CorpusStyle | "all") {const config=resources.find(r=>r.id===corpusId(next))?.corpus;setStyle(next); setMinimum(config?.minLength??2); setMaximum(config?.maxLength??(next === "haidu" ? 3 : 6)); reset();}
  async function action(task: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); notify(message); } catch (e) {setError(e instanceof Error ? e.message : "操作失败");}
    finally {setBusy(false);}
  }
  const match = useMemo(() => (e: Entry) => {
    const m = e.corpus; if (!m) return false;
    const n = m.length;
    return (!deferredSearch || e.text.includes(deferredSearch)) && (!position || m.positionTags.includes(position)) && (!review || m.review === review) &&
      (!semantic || m.semanticTags.some(t => t.includes(semantic))) && (!length || n === Number(length)) && m.frequency >= frequency &&
      (tab === "all" || tab === "relation" || tab === "character" && n === 1 || tab === "bigram" && n === 2 || tab === "trigram" && n === 3 || tab === "phrase" && n >= 4 || tab === "repeat" && m.kinds.includes("reduplication"));
  }, [deferredSearch,position,review,semantic,length,frequency,tab]);
  const entries = useLiveQuery(async () => {
    if (tab === "relation") return { rows: [], count:0 };
    const query = db.entries.where({ resourceId: id }).filter(match);
    const [count, rows] = await Promise.all([query.clone().count(), query.clone().offset(page*PAGE).limit(PAGE).toArray()]);
    return { rows, count };
  }, [id,version,match,page,tab]) || {rows:[],count:0};
  const relations = useLiveQuery(async () => {
    if(tab !== "relation")return {rows:[],count:0};
    const query = db.relations.where({resourceId:`${id}-relations`}).filter(r => {
      const m = JSON.parse(r.note || "{}") as CorpusRelation;
      return (!deferredSearch || (r.left+r.right).includes(deferredSearch)) && (!review || m.review === review) && m.frequency >= frequency &&
        (!length || [...(r.left+r.right)].length === Number(length)) && (!semantic || m.type.includes(semantic)) && !position;
    });
    const [count,rows]=await Promise.all([query.clone().count(),query.clone().offset(page*PAGE).limit(PAGE).toArray()]);
    return {rows,count};
  }, [id,relationVersion,tab,deferredSearch,review,frequency,length,semantic,position,page]) || {rows:[],count:0};
  const summary = useLiveQuery(async () => {
    const counts: Record<string,number> = {}, positions: Record<string,number> = {};
    await db.entries.where({resourceId:id}).each(e => { if(e.corpus){ const m=e.corpus;counts[m.review]=(counts[m.review]||0)+1;const k=m.length===1?"单字":m.length===2?"双字":m.length===3?"三字":"长短语";counts[k]=(counts[k]||0)+1;for(const tag of m.positionTags)positions[tag]=(positions[tag]||0)+1; } });
    return {counts,positions};
  }, [id,version]);
  async function batch(status: Review) {
    await action(async () => {
      if (tab !== "relation") await reviewMaterials(id, selected, status);
      else await db.transaction("rw",db.relations,db.resources,async()=>{
        for(const row of relations.rows.filter(r=>selected.includes(String(r.id)))) {
          const m=JSON.parse(row.note!) as CorpusRelation;
          await db.relations.update(row.id!,{note:JSON.stringify({...m,review:status,enabled:status==="APPROVED"}),tags:[m.type,`审核:${status}`]});
        }
        const r=await db.resources.get(`${id}-relations`);if(r)await db.resources.update(r.id,{version:r.version+1,updatedAt:Date.now()});
      });
      setSelected([]);
    },"审核已保存");
  }
  const count = tab === "relation" ? relations.count : entries.count;
  const keys = tab === "relation" ? relations.rows.map(r=>String(r.id)) : entries.rows.map(e=>e.text);
  const toggle = (key:string) => setSelected(s=>s.includes(key)?s.filter(t=>t!==key):[...s,key]);
  return <section className="corpus-page" aria-label="FF14 玩家语料词库">
    <div className="corpus-heading"><div><span className="eyebrow">PLAYERTRACK / LOCAL CORPUS</span><h1>FF14 玩家语料词库</h1><p>从玩家的用字习惯里，寻找下一次命名的灵感。</p></div><span className="corpus-local"><Database size={15}/>本地聚合 · 原库只读</span></div>
    <div className="corpus-overview"><div><strong>{report.deduplicatedPlayerNames.toLocaleString()}</strong><span>去重玩家与名称</span></div><div><strong>{report.pureHanPlayerNames.toLocaleString()}</strong><span>纯汉字记录</span></div><div><strong>{sourceRange}</strong><span>本机实际长度范围</span></div><div><strong>{Object.values(report.materials).reduce((a,b)=>a+b,0).toLocaleString()}</strong><span>素材 · 含待审核</span></div></div>
    <div className="corpus-style-grid">{Object.entries(corpusStyles).map(([key,title]) => {const installed=resources.find(r=>r.id===corpusId(key));return <button key={key} className={`corpus-style ${style===key?"active":""}`} aria-pressed={style===key} onClick={()=>choose(key as CorpusStyle)}><span>{key.toUpperCase()}</span><b>{title}</b><small>{installed ? `${installed.count} 项 · ${installed.corpus?.enabled?"已启用":"已停用"}` : `${report.styles[key as CorpusStyle]} 项 · 未安装`}</small></button>;})}</div>
    <div className="corpus-toolbar"><button className="text-button" aria-pressed={style==="all"} onClick={()=>choose("all")}>基础素材与全量审核</button><button className="button" disabled={busy} onClick={()=>void action(async()=>{ for(const key of Object.keys(corpusStyles))await installCorpus(await loadBundled(key as CorpusStyle)); },"六套风格词库已安装，原有修改保留")}>安装六套词库</button><button className="button" disabled={busy} onClick={()=>input.current?.click()}><ArrowUpFromLine size={14}/>导入 JSON</button><input ref={input} type="file" accept="application/json,.json" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void action(async()=>{if(file.size>20*1024*1024)throw new Error("文件超过 20 MiB");const value=JSON.parse(await file.text());await installCorpus(value);choose(value.style);},"导入完成；同词素材保留本地编辑");}}/></div>
    <section className="corpus-detail"><div className="corpus-detail-heading"><div><h2>{style === "all" ? "基础素材" : corpusStyles[style]}</h2><p>统计权重与人工权重分别保存。自动分类不代表人工审读通过。</p></div>{resource ? <div className="corpus-toolbar"><button className="button" disabled={busy} onClick={()=>void action(()=>configureCorpus(id,{enabled:!resource.corpus!.enabled}),"词库状态已更新")}>{resource.corpus!.enabled?"停用词库":"启用词库"}</button><button className="button" disabled={busy} onClick={()=>void action(async()=>download(`playertrack-${style}.json`,JSON.stringify(await exportCorpus(id))),"词库已导出")}><ArrowDownToLine size={14}/>导出词库</button></div> : <button className="primary-button" disabled={busy} onClick={()=>void action(()=>style==="all"?installBaseCorpus():loadBundled(style).then(installCorpus),"词库已安装")}>{busy?"正在处理…":"安装此词库"}</button>}</div>
      {resource ? <>
        <div className="corpus-summary">{Object.entries(summary?.counts||{}).map(([k,v])=><span key={k}>{reviewLabels[k as Review] || k}<b>{v}</b></span>)}</div>
        <div className="corpus-summary">{Object.entries(summary?.positions||{}).map(([k,v])=><span key={k}>{k}<b>{v}</b></span>)}</div>
        <div className="corpus-generate"><label>抽样模式<select aria-label="语料抽样模式" value={mode} onChange={e=>setMode(e.target.value)}>{Object.entries(corpusModes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>最短<input aria-label="语料最短长度" type="number" min={1} max={32} value={minimum} onChange={e=>setMinimum(Number(e.target.value))}/></label><label>最长<input aria-label="语料最长长度" type="number" min={1} max={32} value={maximum} onChange={e=>setMaximum(Number(e.target.value))}/></label><button className="primary-button" disabled={busy||!resource.corpus?.enabled} onClick={()=>void action(async()=>{await configureCorpus(id,{minLength:minimum,maxLength:maximum});const w=await corpusWorkflow(id,mode,minimum,maximum);await db.workflows.add(w);onUse(w);},"已打开语料工作流")}><Play size={14}/>使用此词库生成</button></div>
        <div className="corpus-tabs" role="tablist" aria-label="素材类别">{tabs.map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>{setTab(key);reset();}}>{label}</button>)}</div>
        <div className="corpus-filters"><label>搜索<input aria-label="搜索语料" value={search} onChange={e=>{setSearch(e.target.value);reset();}} placeholder="字词或短语"/></label><label>长度<input aria-label="素材长度" type="number" min={1} max={32} value={length} onChange={e=>{setLength(e.target.value);reset();}}/></label><label>位置<select aria-label="位置筛选" value={position} disabled={tab==="relation"} onChange={e=>{setPosition(e.target.value);reset();}}><option value="">全部</option>{["FIRST","MIDDLE","LAST","FREE"].map(t=><option key={t}>{t}</option>)}</select></label><label>最低词频<input aria-label="最低词频" type="number" min={0} value={frequency} onChange={e=>{setFrequency(Math.max(0,Number(e.target.value)));reset();}}/></label><label>语义<input aria-label="语义筛选" value={semantic} onChange={e=>{setSemantic(e.target.value);reset();}} placeholder={tab==="relation"?"关系类型":"如 nature"}/></label><label>审核<select aria-label="审核状态筛选" value={review} onChange={e=>{setReview(e.target.value);reset();}}><option value="">全部</option>{Object.entries(reviewLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
        <div className="corpus-batch"><label><input type="checkbox" aria-label="选择当前页" checked={keys.length>0&&keys.every(k=>selected.includes(k))} onChange={e=>setSelected(e.target.checked?keys:[])}/>当前页</label><span>已选 {selected.length} 项 / 匹配 {count} 项</span><button className="text-button" disabled={!selected.length||busy} onClick={()=>void batch("APPROVED")}><Check size={14}/>批量批准</button><button className="text-button" disabled={!selected.length||busy} onClick={()=>void batch("REJECTED")}>批量拒绝</button><button className="text-button" disabled={!selected.length||busy} onClick={()=>void batch("PENDING")}>转待审核</button></div>
        <div className="corpus-table-wrap"><table className="corpus-table"><thead><tr><th>选择</th><th>{tab==="relation"?"词语关系":"素材"}</th><th>词频 / 玩家覆盖</th><th>{tab==="relation"?"类型":"位置 / 语义"}</th><th>审核</th><th>{tab==="relation"?"置信度":"权重 / 来源"}</th></tr></thead><tbody>{tab==="relation"?relations.rows.map(r=>{const m=JSON.parse(r.note!) as CorpusRelation;return <tr key={r.id}><td><input type="checkbox" aria-label={`选择关系 ${r.left} ${r.right}`} checked={selected.includes(String(r.id))} onChange={()=>toggle(String(r.id))}/></td><td><button className="text-button" onClick={()=>setEditingRelation(m)}>{r.left} → {r.right}</button></td><td>{m.frequency} / {m.playerCoverage}</td><td>{m.type}</td><td>{reviewLabels[m.review]}</td><td>{m.confidence} · 相邻边界候选</td></tr>;}):entries.rows.map(e=>{const m=e.corpus!;return <tr key={e.text}><td><input type="checkbox" aria-label={`选择 ${e.text}`} checked={selected.includes(e.text)} onChange={()=>toggle(e.text)}/></td><td><button className="text-button corpus-word" onClick={()=>setEditing(m)}>{e.text}</button><small>{m.length} 字 · {m.level}</small></td><td>{m.frequency} / {m.playerCoverage}<small>{m.uniqueNameCount} 个不同名称</small></td><td>{m.positionTags.join(" · ")}<small>{m.semanticTags.join(" / ")||"未分类"}</small></td><td><span className={`corpus-review ${m.review.toLowerCase()}`}>{reviewLabels[m.review]}</span><small>{m.enabled?"启用":"停用"}</small></td><td>{m.statisticalWeight.toFixed(2)} × {m.manualWeight}<small>{Object.keys(m.sourceLengths).join(" / ")} 字来源</small></td></tr>;})}</tbody></table></div>
        {!count?<p className="field-note">没有匹配素材；可以调整筛选条件。</p>:null}
        <div className="corpus-pagination"><button className="button" disabled={page===0} onClick={()=>{setPage(page-1);setSelected([]);}}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(count/PAGE))}</span><button className="button" disabled={(page+1)*PAGE>=count} onClick={()=>{setPage(page+1);setSelected([]);}}>下一页</button></div>
      </> : <p className="field-note">素材随安装保存在当前浏览器，可独立审核、编辑、停用与导出。基础素材包含全部待审核单字与片段，按需安装。</p>}
    </section>
    {editing?<section className="corpus-edit" aria-label="编辑语料素材"><div className="corpus-detail-heading"><h2>编辑「{editing.text}」</h2><button className="text-button" onClick={()=>setEditing(undefined)}>关闭编辑</button></div><div className="corpus-filters"><label>语义标签<input aria-label="编辑语义标签" value={editing.semanticTags.join(",")} onChange={e=>setEditing({...editing,semanticTags:e.target.value.split(",").filter(Boolean)})}/></label><label>位置标签<input aria-label="编辑位置标签" value={editing.positionTags.join(",")} onChange={e=>setEditing({...editing,positionTags:e.target.value.split(",").filter(Boolean)})}/></label><label>风格标签<input aria-label="编辑风格标签" value={editing.styleTags.join(",")} onChange={e=>setEditing({...editing,styleTags:e.target.value.split(",").filter(Boolean)})}/></label><label>人工权重<input aria-label="人工权重" type="number" min={0} max={100} step={0.1} value={editing.manualWeight} onChange={e=>setEditing({...editing,manualWeight:Number(e.target.value)})}/></label><label>风格权重<input aria-label="风格权重" type="number" min={0} max={100} step={0.1} value={editing.styleWeight} onChange={e=>setEditing({...editing,styleWeight:Number(e.target.value)})}/></label><label>审核<select aria-label="编辑审核状态" value={editing.review} onChange={e=>setEditing({...editing,review:e.target.value as Review,enabled:["APPROVED","AUTO"].includes(e.target.value)})}>{Object.entries(reviewLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label><input type="checkbox" aria-label="素材启用" checked={editing.enabled} onChange={e=>setEditing({...editing,enabled:e.target.checked})}/>启用</label></div><p className="field-note">{editing.provenance} · 当前 {editing.currentCount} / 历史 {editing.historyCount}（两者可重叠）· 完整名称命中 {editing.sources.whole||0} / 片段命中 {editing.sources.fragment||0}</p><details><summary>按来源长度查看绝对与相对位置统计</summary><pre>{JSON.stringify(editing.positionsByLength,null,2)}</pre></details><button className="primary-button" disabled={busy} onClick={()=>void action(async()=>{await updateMaterials(id,[{text:editing.text,patch:editing}]);setEditing(undefined);},"标签与权重已保存")}>保存素材</button></section>:null}
    {editingRelation?<section className="corpus-edit" aria-label="编辑语料关系"><div className="corpus-detail-heading"><h2>{editingRelation.left} → {editingRelation.right}</h2><button className="text-button" onClick={()=>setEditingRelation(undefined)}>关闭关系编辑</button></div><div className="corpus-filters"><label>关系类型<select aria-label="编辑关系类型" value={editingRelation.type} onChange={e=>setEditingRelation({...editingRelation,type:e.target.value})}>{["pending","prefix","suffix","modifier","subject-verb","verb-object","parallel","reduplication","imagery"].map(t=><option key={t}>{t}</option>)}</select></label><label>审核状态<select aria-label="编辑关系审核" value={editingRelation.review} onChange={e=>setEditingRelation({...editingRelation,review:e.target.value as Review,enabled:e.target.value==="APPROVED"})}>{Object.entries(reviewLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>置信度<input aria-label="关系置信度" type="number" min={0} max={1} step={0.05} value={editingRelation.confidence} onChange={e=>setEditingRelation({...editingRelation,confidence:Number(e.target.value)})}/></label></div><p className="field-note">{editingRelation.evidence} · 只有批准并启用、且两端素材可用的关系参与生成。</p><button className="primary-button" disabled={busy} onClick={()=>void action(async()=>{await updateCorpusRelation(id,editingRelation.left,editingRelation.right,editingRelation);setEditingRelation(undefined);},"关系已保存")}>保存关系</button></section>:null}
    <details className="corpus-report"><summary>全长度分布与统计口径</summary><p>当前 {report.raw.current.toLocaleString()} / 历史 {report.raw.history.toLocaleString()}；同一玩家同名只计一次。混合名称独立统计，不混入纯汉字词频。7–8 字 {report.lengths.filter(r=>r.length===7||r.length===8).reduce((n,r)=>n+r.rawRecords,0)} 条，9 字以上 {report.lengths.filter(r=>r.length>=9).reduce((n,r)=>n+r.rawRecords,0)} 条。</p><div className="corpus-table-wrap"><table className="corpus-table"><thead><tr><th>长度</th><th>原记录</th><th>当前 / 历史</th><th>去重记录</th><th>不同名称</th><th>纯汉字 / 混合</th><th>记录重复率</th></tr></thead><tbody>{report.lengths.map(r=><tr key={r.length}><td>{r.length} 字</td><td>{r.rawRecords}</td><td>{r.current} / {r.history}</td><td>{r.deduplicatedPlayerNames}</td><td>{r.uniqueNames}</td><td>{r.pureHan} / {r.mixed}</td><td>{(r.duplicateRecordRate*100).toFixed(2)}%</td></tr>)}</tbody></table></div><p className="field-note">词语边界来自本地受控词典。长短语候选与关系仍需审读；未命中的连续片段不会自动进入生成。来源 SHA-256：{report.databaseSHA256}</p></details>
    {error?<p role="alert" className="corpus-error">{error}</p>:null}
    <p className="field-note" role="status">{busy?"正在本地处理，请稍候…":"每页 50 项；只有打开该入口才加载语料。原数据库与完整玩家记录不会发送到网络。"}</p>
  </section>;
}
