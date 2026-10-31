import type { Candidate, RuleNode, Workflow } from './model';

/** References into immutable run workflow/resource snapshots, never an execution tree. */
export interface Lineage { version: 1; refs: string[]; incomplete: boolean }
export type Evidence = 'executed' | 'matched' | 'inferred' | 'unknown';
export interface EvidenceClaim { evidence: Evidence; summary: string }
export function reverseEvidence(r: import('./reverse-search').ReverseResult): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [{evidence:r.known?'executed':'unknown',summary:r.known?`存在真实运行 ${r.known.runId}；不证明外部输入采用此路径`:'未找到真实生成记录，无法判断执行来源'}];
  for (const m of r.matches.slice(0,32)) claims.push({evidence:m.type==='pinyin'||m.type==='normalized'?'inferred':'matched',summary:`${m.type} · ${m.resourceId} · ${m.text}`});
  r.patterns.slice(0,8).forEach(p=>claims.push({evidence:'matched',summary:`结构规则：${p}`}));
  r.paths.slice(0,10).forEach(p=>claims.push({evidence:'inferred',summary:`潜在组合：${p.matches.map(m=>m.text).join(' + ')}`}));
  r.possibleTemplates.slice(0,10).forEach(t=>claims.push({evidence:'inferred',summary:`潜在模板：${t.workflowId}/${t.nodeId}`}));
  return claims;
}
export const lineageLimits = Object.freeze({ refs: 32, refLength: 384, codeUnits: 4096 });
export function validLineage(value: unknown): value is Lineage {
  const l = value as Lineage | undefined;
  return !!l && Object.keys(l).every(k=>['version','refs','incomplete'].includes(k)) && l.version === 1 && typeof l.incomplete === 'boolean' && Array.isArray(l.refs) && l.refs.length <= lineageLimits.refs && l.refs.every(r => typeof r === 'string' && r.length <= lineageLimits.refLength) && l.refs.join('').length <= lineageLimits.codeUnits;
}
export function mergeLineage(items: Candidate[], ref?: string): Lineage | undefined {
  if (!ref && !items.some(c => c.lineage)) return undefined;
  const refs: string[] = []; let size = 0, incomplete = false;
  const add = (r: string) => {
    if (refs.includes(r)) return;
    if (refs.length >= lineageLimits.refs || r.length > lineageLimits.refLength || size + r.length > lineageLimits.codeUnits) { incomplete = true; return; }
    refs.push(r); size += r.length;
  };
  for (const c of items) if (c.lineage) {
    if (!validLineage(c.lineage)) { incomplete = true; continue; }
    incomplete ||= c.lineage.incomplete; c.lineage.refs.forEach(add);
  }
  if (ref) add(ref);
  return { version: 1, refs, incomplete };
}
export function traceCandidate(c: Candidate, scope: string, path: string): Candidate {
  return { ...c, lineage: mergeLineage([c], JSON.stringify([scope, path])) };
}
/** Only resolve recorded refs. Never infer execution by walking every upstream node. */
export function resolveLineageRef(ref: string, scopes: {id:string;workflow:Workflow}[]): { node: RuleNode; workflow: Workflow; path: string; summary: string } | undefined {
  try {
    const [id, path] = JSON.parse(ref);
    const w = scopes.find(s => s.id === id)?.workflow; if (!w || typeof path !== 'string') return;
    let nodes = w.nodes; const pieces = path.split('/'); let node: RuleNode | undefined;
    for (let i = 0; i < pieces.length; i++) {
      node = nodes.find(n => n.id === pieces[i]); if (!node) return;
      if (i < pieces.length - 1) {
        if (node.op === 'call') { const d = w.subgraphs?.find(d => d.id === node!.call?.definitionId && d.version === node!.call?.version); if (!d) return; nodes = d.nodes; }
        else if (node.op === 'extension') return {node,workflow:w,path,summary:`extension ${node.params.pack}@${node.params.version}/${node.params.operator} · 步骤 ${pieces[i+1]}`};
        else return;
      }
    }
    if (node) return {node,workflow:w,path,summary:`${node.op} v1${node.op==='call'?` · ${node.call?.definitionId}@${node.call?.version}`:''}`};
  } catch { /* Invalid/old references degrade to unresolved, never reconstructed facts. */ }
}
