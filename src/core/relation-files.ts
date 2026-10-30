import { csvCell, DelimitedParser } from "./files";
import type { PairValue, RelationKind } from "./model";
import { normalizePair } from "./relations";

export function parseRelationRows(text: string, name: string, defaultRelation: RelationKind = "associated"): PairValue[] {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("关系文件最大 2 MB");
  let rows: unknown;
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    if (!Array.isArray(data) && data?.format !== undefined && (data.format !== "glyphforge-relations" || ![1, 2].includes(data.version))) throw new Error("关系文件格式或版本不受支持");
    rows = Array.isArray(data) ? data : data?.rows;
  } else {
    const parsed = new DelimitedParser(/\.csv$/i.test(name) ? "," : "\t").feed(text, true);
    if (parsed[0]?.[0] === "left" && parsed[0]?.[1] === "right") parsed.shift();
    rows = parsed.map((r, i) => {
      if (r.length < 2 || r.length > 9) throw new Error(`第 ${i + 1} 行需要 左词、右词、可选关系类型 以及可选类型、方向、反查、权重、标签 JSON、备注、来源 共 2–9 列`);
      return { left: r[0], right: r[1], relation: r[2]?.trim() || defaultRelation, direction: r[3]?.trim() || "unknown", reverseQueryable: r[4] ? JSON.parse(r[4]) : false, ...(r[5] ? { weight: Number(r[5]) } : {}), ...(r[6] ? { tags: JSON.parse(r[6]) } : {}), ...(r[7] ? { note: r[7] } : {}), ...(r[8] ? { source: r[8] } : {}) };
    });
  }
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("需要关系行数组，每次最多 10,000 行");
  return rows.map(row => normalizePair(row));
}
export function relationRowsFile(rows: PairValue[], format: "json" | "csv") {
  return format === "json" ? JSON.stringify({ format: "glyphforge-relations", version: 2, rows: rows.map(normalizePair) }, null, 2)
    : "\uFEFFleft,right,relation,direction,reverseQueryable,weight,tags,note,source\r\n" + rows.map(r => [r.left, r.right, r.relation, r.direction || "unknown", String(r.reverseQueryable ?? false), r.weight === undefined ? "" : String(r.weight), r.tags ? JSON.stringify(r.tags) : "", r.note || "", r.source || ""].map(csvCell).join(",")).join("\r\n");
}
