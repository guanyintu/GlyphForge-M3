import { glyphs, operators } from "./model";
import type { RuleNode, Workflow } from "./model";
import type { ReverseMatch } from "./reverse-search";
export function workflowFromMatches(matches: ReverseMatch[]): Workflow {
  if (!matches.length || matches.length > 64) throw new Error("请选择 1–64 个命中片段");
  const nodes: RuleNode[] = [];
  let previous = "";
  matches.forEach((m, i) => {
    nodes.push({ id: `source${i}`, op: "resource", inputs: [], params: { resourceId: m.resourceId } }, { id: `term${i}`, op: "filter", inputs: [`source${i}`], params: { ...operators.filter.defaults, includes: m.text, maxLength: glyphs(m.text).length } });
    if (i) nodes.push({ id: `join${i}`, op: "concat", inputs: [previous, `term${i}`], params: { separator: "" } });
    previous = i ? `join${i}` : `term${i}`;
  });
  nodes.push({ id: "result", op: "output", inputs: [previous], params: {} });
  return { version: 1, id: crypto.randomUUID(), name: "逆向命中片段组合", seed: 0, limit: 200, nodes, layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: (i % 4) * 260, y: Math.floor(i / 4) * 190 }])) };
}
