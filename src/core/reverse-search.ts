import { glyphs } from "./model";
import type { Candidate, Entry, RelationRow, Workflow } from "./model";
import { canReverse } from "./relations";
import { db, ForgeDatabase } from "../storage/db";
import { execute } from "./engine";
import { templateConfig } from "./relations";

export interface ReverseMatch {
  text: string; resourceId: string; entryId: number;
  start: number; end: number; utf16Start: number; utf16End: number;
  type: "exact" | "fragment" | "normalized" | "pinyin";
}
export interface SplitPath { matches: ReverseMatch[]; coverage: number; complete: boolean }
export interface RelationMatch { row: RelationRow; traversal: "forward" | "reverse"; neighbor: string; paired: boolean }
export interface ReverseOptions { resourceIds?: string[]; normalize?: boolean; pinyin?: boolean; topK?: number }
export interface ReverseResult {
  input: string; matches: ReverseMatch[]; paths: SplitPath[]; patterns: string[];
  relations: RelationMatch[]; possibleTemplates: { workflowId: string; name: string; nodeId: string }[];
  known?: Candidate; warnings: string[]; cacheHit: boolean;
}
export function detectPatterns(text: string) {
  const chars = glyphs(text), result: string[] = [];
  for (const p of ["AAB", "ABB", "AABB", "ABBA", "ABAB"]) {
    if (p.length !== chars.length) continue;
    const vars = new Map<string, string>();
    if ([...p].every((key, i) => { if (!vars.has(key)) vars.set(key, chars[i]); return vars.get(key) === chars[i]; }) && vars.get("A") !== vars.get("B")) result.push(p);
  }
  if (chars.length > 1 && chars.join("") === [...chars].reverse().join("")) result.push("回文 / 字符镜像");
  if (new Set(chars).size < chars.length) result.push("重复字符");
  if (chars.length > 1 && chars.length % 2 === 0 && chars.slice(0, chars.length / 2).join("") === chars.slice(chars.length / 2).join("")) result.push("重复半段");
  return result;
}
/** Beam DP: at each position keep only K paths, including a one-grapheme gap edge. */
export function rankSplits(length: number, matches: ReverseMatch[], topK = 10): SplitPath[] {
  const k = Math.max(1, Math.min(20, Math.trunc(topK) || 10));
  type Path = { matches: ReverseMatch[]; covered: number; exact: number };
  const compare = (a: Path, b: Path) => b.covered - a.covered || b.exact - a.exact || a.matches.length - b.matches.length || JSON.stringify(a.matches).localeCompare(JSON.stringify(b.matches));
  const states: Path[][] = Array.from({ length: length + 1 }, () => []); states[0] = [{ matches: [], covered: 0, exact: 0 }];
  const byStart = new Map<number, ReverseMatch[]>();
  for (const m of matches) byStart.set(m.start, [...(byStart.get(m.start) || []), m]);
  const push = (pos: number, p: Path) => {
    const list = states[pos]; list.push(p); list.sort(compare);
    const seen = new Set<string>(); states[pos] = list.filter(p => { const key = p.matches.map(m => `${m.resourceId}:${m.entryId}:${m.start}:${m.end}`).join("|"); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, k);
  };
  for (let pos = 0; pos < length; pos++) for (const path of states[pos]) {
    push(pos + 1, path);
    for (const m of byStart.get(pos) || []) push(m.end, { matches: [...path.matches, m], covered: path.covered + m.end - m.start, exact: path.exact + (["exact", "fragment"].includes(m.type) ? m.end - m.start : 0) });
  }
  return states[length].filter(p => p.matches.length).sort(compare).slice(0, k).map(p => ({ matches: p.matches, coverage: p.covered / length, complete: p.covered === length }));
}
export class ReverseSearcher {
  private cache = new Map<string, Omit<ReverseResult, "known" | "possibleTemplates">>();
  constructor(private target: ForgeDatabase = db) {}
  async search(input: string, options: ReverseOptions = {}, signal?: AbortSignal, batch?: (matches: ReverseMatch[]) => void, progress?: (phase: string, processed: number) => void): Promise<ReverseResult> {
    const began = performance.now();
    const check = () => { if (signal?.aborted) throw new Error("检索已取消"); if (performance.now() - began > 10000) throw new Error("检索超过 10 秒，请缩小资源范围或关闭可选匹配"); };
    check();
    const chars = glyphs(input);
    if (!chars.length || chars.length > 64 || input.length > 512) throw new Error("请输入 1–64 个字符簇（最多 512 个 UTF-16 单元）");
    const all = await this.target.resources.toArray();
    const selected = options.resourceIds ? all.filter(r => options.resourceIds!.includes(r.id)) : all;
    if (options.resourceIds?.some(id => !all.some(r => r.id === id))) throw new Error("选择的资源已删除，请重新选择");
    const ids = new Set(selected.map(r => r.id));
    const signature = JSON.stringify(selected.map(r => [r.id, r.version]).sort());
    const key = JSON.stringify([input, options, signature]);
    const cached = this.cache.get(key);
    let result: ReverseResult;
    if (cached) { result = { ...structuredClone(cached), possibleTemplates: [], cacheHit: true }; for (let i = 0; i < result.matches.length; i += 50) { check(); batch?.(result.matches.slice(i, i + 50)); } }
    else {
      const offsets = [0]; for (const ch of chars) offsets.push(offsets.at(-1)! + ch.length);
      const positions = new Map<string, { start: number; end: number; normalized: boolean }[]>();
      let convert: ((s: string) => string)[] = [];
      if (options.normalize) {
        const OpenCC = await import("opencc-js");
        convert = [OpenCC.Converter({ from: "cn", to: "tw" }), OpenCC.Converter({ from: "tw", to: "cn" })];
      }
      for (let start = 0; start < chars.length; start++) for (let end = start + 1; end <= chars.length; end++) {
        check(); const text = chars.slice(start, end).join("");
        for (const variant of new Set([text, ...convert.map(c => c(text))])) positions.set(variant, [...(positions.get(variant) || []), { start, end, normalized: variant !== text }]);
      }
      const matches: ReverseMatch[] = [], warnings: string[] = [];
      const add = (e: Entry, start: number, end: number, type: ReverseMatch["type"]) => {
        if (matches.length >= 500) return;
        if (!matches.some(m => m.entryId === e.id && m.start === start && m.end === end)) matches.push({ text: e.text, resourceId: e.resourceId, entryId: e.id!, start, end, utf16Start: offsets[start], utf16End: offsets[end], type });
      };
      // Existing B-tree index answers bounded substring probes: independent of total dictionary size.
      const entries = await this.target.entries.where("text").anyOf([...positions.keys()]).filter(e => ids.has(e.resourceId)).limit(501).toArray(); check();
      if (entries.length > 500) warnings.push("词条命中达到 500 条上限，拆分仅基于已返回命中");
      for (const e of entries) for (const p of positions.get(e.text) || []) add(e, p.start, p.end, p.normalized ? "normalized" : p.start === 0 && p.end === chars.length ? "exact" : "fragment");
      if (matches.length >= 500 && !warnings.length) warnings.push("位置命中达到 500 条上限");
      if (options.pinyin && matches.length < 500) {
        const { pinyin } = await import("pinyin-pro");
        let scanned = 0;
        const phoneticPositions = new Map<string, { start: number; end: number }[]>();
        for (let start = 0; start < chars.length; start++) for (let end = start + 1; end <= chars.length; end++) {
          const text = chars.slice(start, end).join("");
          const spelling = pinyin(text, { toneType: "none", type: "array" }).join("").toLowerCase();
          phoneticPositions.set(spelling, [...(phoneticPositions.get(spelling) || []), { start, end }]);
        }
        // Optional phonetic fallback scans selected libraries in bounded keyset pages.
        for (const resource of selected.filter(r => r.kind !== "relation")) {
          let cursor = 0;
          while (scanned < 10000) {
            check(); const page = await this.target.entries.where("[resourceId+id]").between([resource.id, cursor], [resource.id, Infinity], false, true).limit(Math.min(256, 10000 - scanned)).toArray(); if (!page.length) break;
            cursor = page.at(-1)!.id!;
            for (const e of page) {
              scanned++; if (!/\p{Script=Han}/u.test(e.text)) continue;
              const spelling = pinyin(e.text, { toneType: "none", type: "array" }).join("").toLowerCase();
              for (const { start, end } of phoneticPositions.get(spelling) || []) add(e, start, end, "pinyin");
            }
            progress?.("pinyin", scanned);
          }
          if (scanned >= 10000) break;
        }
        if (scanned >= 10000) warnings.push("拼音候选只扫描前 10,000 个所选词条；不穷尽多音字");
      }
      for (let i = 0; i < matches.length; i += 50) { check(); batch?.(matches.slice(i, i + 50)); }
      const rawRows = await this.target.relations.where("left").anyOf([...positions.keys()]).filter(r => ids.has(r.resourceId)).limit(201).toArray(); check();
      const reverseRows = await this.target.relations.where("right").anyOf([...positions.keys()]).filter(r => ids.has(r.resourceId) && canReverse(r)).limit(201).toArray(); check();
      const relations: RelationMatch[] = [...rawRows.map(row => ({ row, traversal: "forward" as const, neighbor: row.right, paired: positions.has(row.right) })), ...reverseRows.filter(r => !rawRows.some(f => f.id === r.id)).map(row => ({ row, traversal: "reverse" as const, neighbor: row.left, paired: positions.has(row.left) }))].slice(0, 200);
      if (rawRows.length + reverseRows.length > 200) warnings.push("关系命中最多返回 200 行");
      result = { input, matches, paths: rankSplits(chars.length, matches, options.topK), patterns: detectPatterns(input), relations, possibleTemplates: [], warnings, cacheHit: false };
    }
    check();
    // Provenance requires an actual persisted run + its generated record, never an inferred candidate.
    const known = await this.target.generated.where("text").equals(input).last();
    if (known?.runId && (await this.target.runs.get(known.runId))) result.known = known;
    const workflows = await this.target.workflows.limit(21).toArray();
    if (workflows.length > 20) result.warnings.push("已知模板最多分析前 20 个已保存工作流");
    let examinedTemplates = 0;
    templates: for (const workflow of workflows.slice(0, 20)) {
      check();
      for (const node of workflow.nodes.filter(n => n.op === "template")) {
        if (examinedTemplates++ >= 20) { result.warnings.push("模板节点分析达到 20 个上限"); break templates; }
        try {
          const { slots } = templateConfig(node.params);
          const reader = async function* (id: string): AsyncGenerator<Candidate> {
            if (!ids.has(id)) return;
            for (const m of new Map(result.matches.filter(m => m.resourceId === id && ["exact", "fragment"].includes(m.type)).map(m => [m.entryId, m])).values()) yield { text: m.text, parts: [] };
            for (const { row } of result.relations.filter(r => r.row.resourceId === id)) yield { text: `${row.left} / ${row.right}`, pair: row, parts: [] };
          };
          if (slots.some(s => !ids.has(s.resourceId))) continue;
          const probe: Workflow = { ...workflow, limit: 200, nodes: [node, { id: "reverse_probe_out", op: "output", inputs: [node.id], params: {} }] };
          let found = false;
          await execute(probe, reader, batch => { check(); if (batch.some(c => c.text === input)) found = true; }, { steps: 10000, milliseconds: 100 });
          if (found) result.possibleTemplates.push({ workflowId: workflow.id, name: workflow.name, nodeId: node.id });
        } catch (e) { check(); result.warnings.push(`模板 ${workflow.name}/${node.id} 未完成分析：${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    check();
    const latest = await this.target.resources.toArray();
    if (JSON.stringify(latest.filter(r => !options.resourceIds || ids.has(r.id)).map(r => [r.id, r.version]).sort()) !== signature) throw new Error("资源在检索期间发生变化，请重新检索");
    result.warnings = [...new Set(result.warnings)];
    const { known: _, possibleTemplates: __, ...cacheValue } = result;
    this.cache.set(key, structuredClone(cacheValue));
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
