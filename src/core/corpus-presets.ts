import type { Workflow } from "./model";
import type { CorpusStyle } from "./corpus";

export const corpusPresets: { style: CorpusStyle; label: string; description: string; sample: string; tone: string }[] = [
  { style: "cute", label: "FF14 · 萌系日常", description: "动物、食物与亲昵表达，轻松一点，可爱一点。", sample: "奶糖 · 草莓 · 猫猫", tone: "rose" },
  { style: "nature", label: "FF14 · 自然意象", description: "从星月、山海和四季里，拾一段自然意象。", sample: "月光 · 听雨 · 春日", tone: "sage" },
  { style: "literary", label: "FF14 · 清冷文艺", description: "克制的情绪与文学意象，让名字留一点空白。", sample: "留白 · 余音 · 无声", tone: "mist" },
  { style: "fantasy", label: "FF14 · 奇幻角色", description: "音译字根与幻想世界的联想，为角色取个名字。", sample: "艾琳 · 菲娜 · 希尔", tone: "lilac" },
  { style: "trend", label: "FF14 · 趣味潮流", description: "网络口语、抽象与反差，给日常加一点梗。", sample: "赛博 · 摸鱼 · 勇者", tone: "amber" },
  { style: "haidu", label: "FF14 · 海都潮人", description: "现代字根与冷感词语，短一点，利落一点。", sample: "留白 · 失真 · 零号", tone: "ink" },
];
export const corpusPresetMarker = (style: CorpusStyle) => `// glyphforge:preset:playertrack-${style}-v1`;
export function matchesCorpusPreset(workflow: Workflow, style: CorpusStyle) {
  return workflow.comments?.includes(corpusPresetMarker(style)) ||
    Boolean(workflow.comments?.includes("// glyphforge:playertrack:v1") && workflow.nodes.some(n => n.op === "corpus" && n.params.style === style));
}

export interface WorkflowCardInfo { category: string; description: string; sample: string; length: string; tone: string; order: number }
export function workflowCardInfo(workflow: Workflow): WorkflowCardInfo {
  const index = corpusPresets.findIndex(p => matchesCorpusPreset(workflow, p.style));
  if (index >= 0) {
    const preset = corpusPresets[index], node = workflow.nodes.find(n => n.op === "corpus");
    return { description: preset.description, sample: preset.sample, tone: preset.tone, category: "FF14 玩家语料", length: `${node?.params.minLength ?? 2}–${node?.params.maxLength ?? (preset.style === "haidu" ? 3 : 6)} 字`, order: index };
  }
  if (workflow.comments?.includes("// glyphforge:preset:haidu-original-xlsx-v1")) return { category: "海都 · 原版 xlsx", description: "原表四列词库，保留五种经典组合。", sample: "1+1 · 1+2 · 小xx · 直出", length: "2–3 字", tone: "sage", order: 6 };
  if (workflow.comments?.includes("// glyphforge:preset:haidu-workflow-v3")) return { category: "海都 · 扩充版", description: "独立素材池与关系评分，沿用五列工作流。", sample: "单字组合 · 双字搭配", length: "2–3 字", tone: "ink", order: 7 };
  return { category: "我的工作流", description: "使用已保存的词库、规则与生成设置。", sample: `${workflow.nodes.length} 个节点 · 最多 ${workflow.limit} 个结果`, length: "自定规则", tone: "sage", order: 10 };
}
