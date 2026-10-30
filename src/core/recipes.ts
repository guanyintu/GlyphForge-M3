import { operators } from "./model";
import type { PairValue, Resource, RuleNode, Workflow } from "./model";
import { db, saveNewResource, saveRelationRows } from "../storage/db";

export const recipeExamples: { meta: Resource; words?: string[]; rows?: PairValue[] }[] = [
  { meta: meta("p1b-sky", "呼应的天体", "relation"), rows: [
    { left: "月亮", right: "星星", relation: "couple" }, { left: "落日", right: "晚霞", relation: "associated" },
  ] },
  { meta: meta("p1b-roles", "通信的角色", "relation"), rows: [
    { left: "邮差", right: "收件人", relation: "couple" }, { left: "写信人", right: "读信人", relation: "associated" },
  ] },
  { meta: meta("p1b-antonyms", "明确的反义词", "relation"), rows: [
    { left: "冷", right: "热", relation: "antonym" }, { left: "昼", right: "夜", relation: "antonym" },
    { left: "猫", right: "月", relation: "associated" },
  ] },
  ...[
    ["p1b-season", "对仗：时序", "春", "秋"], ["p1b-weather", "对仗：风雨", "风", "雨"], ["p1b-action", "对仗：动词", "入梦", "归心"],
  ].map(([id, name, left, right]) => ({ meta: meta(id, name, "relation"), rows: [{ left, right, relation: "parallel" as const }] })),
  { meta: meta("p1b-space", "战队主题：星际", "word"), words: ["月亮", "星星", "彗星", "银河", "极光", "流星", "星云", "北斗", "天狼", "织女", "晨星", "长庚"] },
  { meta: meta("p1b-animals", "镜像：动物", "word"), words: ["猫", "鹿"] },
  { meta: meta("p1b-moon", "镜像：天体", "word"), words: ["月", "星"] },
];
function meta(id: string, name: string, kind: Resource["kind"]): Resource {
  return { id, name, kind, description: "P1-B 可编辑示例素材", color: kind === "relation" ? "purple" : "green", count: 0, version: 1, updatedAt: 0 };
}
export const relationRecipes = [
  { id: "couple", title: "情侣 ID", sample: "月亮邮差 / 星星收件人", description: "多个关系槽位，共享变量保持呼应" },
  { id: "squad-prefix", title: "战队统一前缀 ID", sample: "星河·月亮 / 星河·彗星 / …", description: "动态 N 人、公共前后缀、去重和长度限制" },
  { id: "squad-theme", title: "战队主题 ID", sample: "银河巡游者 / 极光巡游者 / …", description: "共同主题词库、统一模板、随机批量分组" },
  { id: "antonyms", title: "反义词组合", sample: "冷面骑士 / 热面骑士", description: "只使用明确标记为反义的关系行" },
  { id: "parallel", title: "对仗关联组合", sample: "春风入梦 / 秋雨归心", description: "多个关联槽位、对应词序、等长约束" },
  { id: "mirror-pair", title: "双人镜像 ID", sample: "猫追月 / 月追猫", description: "交换变量、倒置词序和结构镜像" },
] as const;
export type RelationRecipeId = typeof relationRecipes[number]["id"];
export function createRelationRecipe(id: RelationRecipeId): Workflow {
  const recipe = relationRecipes.find(r => r.id === id)!;
  const slot = (name: string, resourceId: string, kind = "pair", relation = "") => ({ name, resourceId, kind, relation });
  const template = (slots: ReturnType<typeof slot>[], templates: string[], extra = {}): RuleNode => ({ id: "names", op: "template", inputs: [], params: { ...operators.template.defaults, slots: JSON.stringify(slots), templates: JSON.stringify(templates), ...extra } });
  let nodes: RuleNode[];
  switch (id) {
    case "couple": nodes = [template([slot("sky", "p1b-sky"), slot("role", "p1b-roles")], ["{sky.left}{role.left}", "{sky.right}{role.right}"])]; break;
    case "antonyms": nodes = [template([slot("opposite", "p1b-antonyms", "pair", "antonym")], ["{opposite.left}面骑士", "{opposite.right}面骑士"])]; break;
    case "parallel": nodes = [template([slot("season", "p1b-season", "pair", "parallel"), slot("weather", "p1b-weather", "pair", "parallel"), slot("action", "p1b-action", "pair", "parallel")], ["{season.left}{weather.left}{action.left}", "{season.right}{weather.right}{action.right}"], { equalLength: true })]; break;
    case "mirror-pair": nodes = [template([slot("animal", "p1b-animals", "word"), slot("sky", "p1b-moon", "word")], ["{animal}追{sky}", "{sky}追{animal}"])]; break;
    case "squad-prefix": nodes = [{ id: "names", op: "resource", inputs: [], params: { resourceId: "p1b-space" } }]; break;
    case "squad-theme": nodes = [template([slot("theme", "p1b-space", "word")], ["{theme}巡游者"])]; break;
  }
  if (id.startsWith("squad-")) nodes.push({ id: "team", op: "group", inputs: ["names"], params: { ...operators.group.defaults, ...(id === "squad-theme" ? { prefix: "", separator: "", batches: 2 } : {}) } });
  nodes.push({ id: "result", op: "output", inputs: [nodes.at(-1)!.id], params: {} });
  return { version: 1, id: crypto.randomUUID(), name: recipe.title, nodes, layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: 35 + i * 280, y: 120 }])), seed: 42, limit: 200 };
}
export async function ensureRecipeExamples() {
  await db.transaction("rw", db.resources, db.entries, db.relations, async () => {
    for (const example of recipeExamples) {
      const existing = await db.resources.get(example.meta.id);
      if (existing) {
        if (existing.kind !== example.meta.kind) throw new Error(`示例 ID ${existing.id} 类型冲突，请先导出并处理该资源`);
        continue;
      }
      await saveNewResource({ ...example.meta, updatedAt: Date.now() }, example.words || []);
      if (example.rows) await saveRelationRows(example.meta.id, example.rows);
    }
  });
}
