import type { Workflow } from "./model";
import { operators } from "./model";
import { parseProgram } from "./program";
import { curationDefaults } from "./curation";

export function sampledWords(id: string, source: string, count: number, maxLength: number): Workflow {
  return { version: 1, id, name: "固定种子抽取素材", seed: 42, limit: count, layout: { words: {x:20,y:80}, sample: {x:300,y:80}, result: {x:580,y:80} }, nodes: [
    { id: "words", op: "resource", inputs: [], params: { resourceId: source } },
    { id: "sample", op: "group", inputs: ["words"], params: { ...operators.group.defaults, count: 1, batches: count, prefix: "", suffix: "", separator: "", joiner: "", maxLength, random: true } },
    { id: "result", op: "output", inputs: ["sample"], params: {} },
  ] };
}

export function haiduWorkflow(ids: { oneHead: string; oneTail: string; twoHead: string; twoTail: string; direct: string; reviewed: string }): Workflow {
  return { version: 1, id: "haidu-workflow-v3", name: "海都潮人 ID · 五列工作流", seed: 42, limit: 24,
    comments: ["// glyphforge:preset:haidu-workflow-v3", "// 原表五列：1+1、1+2、2+1、小+双字、双字直出。", "// 素材从独立词库读取；固定种子抽样控制组合规模。", "// 关系评分只优化已生成的候选，不替代词库组合。"],
    layout: { formulas: {x:40,y:120}, selection: {x:360,y:120}, result: {x:680,y:120} }, nodes: [
      { id: "formulas", op: "program", inputs: [], params: {}, program: parseProgram(`
// 两字：1 + 1
for head in @${ids.oneHead} { for tail in @${ids.oneTail} { emit(head + tail); } }
// 三字：1 + 2
for head in @${ids.oneHead} { for word in @${ids.twoTail} { emit(head + word); } }
// 三字：2 + 1
for word in @${ids.twoHead} { for tail in @${ids.oneTail} { emit(word + tail); } }
// 三字：固定小前缀 + 双字
for word in @${ids.direct} { emit(prefix(word, "小")); }
// 双字词组直出
for word in @${ids.direct} { emit(word); }
`) },
      { id: "selection", op: "curate", inputs: ["formulas"], params: { ...curationDefaults, recipes: "", reviewedResourceId: ids.reviewed } },
      { id: "result", op: "output", inputs: ["selection"], params: {} },
    ] };
}
