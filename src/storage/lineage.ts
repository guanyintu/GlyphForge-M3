import type { Candidate } from '../core/model';
import { resolveLineageRef, validLineage } from '../core/lineage';
import { db } from './db';

/** Reads just one selected run/result and its bounded resource vector. No history scan. */
export async function inspectLineage(candidate: Candidate, target = db) {
  const run = candidate.runId ? await target.runs.get(candidate.runId) : undefined;
  const saved = run ? await target.generated.get([run.id, candidate.text]) : undefined;
  const c = saved ?? candidate;
  const workflows = run ? [{id:run.workflow.id,workflow:run.workflow}, ...(run.resources ?? []).flatMap(r => r.definition?.type === 'dynamic' ? [{id:JSON.stringify(["resource",r.id,r.version]),workflow:r.definition.workflow}] : [])] : [];
  const refs = validLineage(c.lineage) ? c.lineage.refs : [];
  const operations = refs.map(ref => {
    const found = resolveLineageRef(ref, workflows);
    return found ? {ref, path: found.path, scope: found.workflow.name, summary: found.summary} : {ref, path: '', scope: '', summary: '引用失效：仅保留已记录的引用，无法展开操作'};
  });
  const ids = [...new Set([...Object.keys(run?.versions ?? {}), ...c.parts.slice(0,128).map(p => p.resourceId)])].slice(0,256);
  const current = await target.resources.bulkGet(ids);
  const resources = ids.map((id,i) => {
    const expected = run?.versions[id] ?? c.parts.find(p => p.resourceId === id)?.version;
    return {id, version: expected, currentVersion:current[i]?.version, state: !current[i] ? '资源缺失' : expected === undefined ? '旧来源版本未知' : current[i]!.version !== expected ? '资源已变更' : '当前版本一致'};
  });
  const extensionKeys = [...new Set(refs.flatMap(ref => {
    const found = resolveLineageRef(ref, workflows);
    return found?.node.op === 'extension' ? [`${found.node.params.pack}@${found.node.params.version}`] : [];
  }))];
  const installed = await target.extensionPacks.bulkGet(extensionKeys);
  const extensions = extensionKeys.map((key,i)=>({key,state:!installed[i]?'扩展缺失（运行快照仍保留声明）':installed[i]!.enabled?'已安装 / 已启用':'已安装 / 已禁用（运行快照仍保留声明）'}));
  const parentId = c.derivation?.parent.runId;
  const parent = parentId ? await target.runs.get(parentId) : undefined;
  return {
    version:1, evidence: run && saved ? 'executed' as const : 'unknown' as const,
    label: run && saved ? '已证实 · 已保存生成记录' : '不可判断 · 缺少运行或生成记录',
    run:run ? {id:run.id,workflowId:run.workflow.id,name:run.workflow.name,createdAt:run.createdAt,seed:run.workflow.seed,status:run.status} : undefined,
    operations, incomplete: !!c.lineage?.incomplete, resources, extensions,
    // Diagnostic copies omit unrelated relation notes/tags/publisher URLs.
    fragments:c.parts.slice(0,32).map(p=>({resourceId:p.resourceId,version:p.version,text:p.text})), omittedFragments:Math.max(0,c.parts.length-32),
    derivation:c.derivation ? {kind:c.derivation.kind,round:c.derivation.round,parent:c.derivation.parent,parentState:parent?'父运行快照存在':'父运行缺失；保留输入摘要，不能重建旧执行'} : undefined,
    result:c.text,
    limitations:[
      '保留运行快照与资源版本；没有静态历史资源全集，无法保证完整重放。',
      '操作按记录的依赖顺序展开；输入片段是素材快照，不是每一步的中间值。',
      ...(!refs.length ? ['旧记录或非图入口没有逐算子引用；不从工作流结构推造执行路径。'] : []),
      ...(c.lineage?.incomplete ? ['操作引用达到32项/4096代码单元上限，链条仅为有界摘要。'] : []),
    ],
  };
}
