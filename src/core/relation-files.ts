import { csvCell, DelimitedParser } from "./files";
import type { PairValue, RelationKind } from "./model";
import { validatePair } from "./relations";

export function parseRelationRows(text: string, name: string, defaultRelation: RelationKind = "associated"): PairValue[] {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("关系文件最大 2 MB");
  let rows: unknown;
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    if (!Array.isArray(data) && data?.format !== undefined && (data.format !== "glyphforge-relations" || data.version !== 1)) throw new Error("关系文件格式或版本不受支持");
    rows = Array.isArray(data) ? data : data?.rows;
  } else {
    const parsed = new DelimitedParser(/\.csv$/i.test(name) ? "," : "\t").feed(text, true);
    if (parsed[0]?.[0] === "left" && parsed[0]?.[1] === "right") parsed.shift();
    rows = parsed.map((r, i) => {
      if (r.length < 2 || r.length > 3) throw new Error(`第 ${i + 1} 行需要 左词、右词、可选关系类型 共 2–3 列`);
      return { left: r[0], right: r[1], relation: r[2]?.trim() || defaultRelation };
    });
  }
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("需要关系行数组，每次最多 10,000 行");
  return rows.map(row => { validatePair(row); return { left: row.left.trim(), right: row.right.trim(), relation: row.relation }; });
}
export function relationRowsFile(rows: PairValue[], format: "json" | "csv") {
  return format === "json" ? JSON.stringify({ format: "glyphforge-relations", version: 1, rows }, null, 2)
    : "\uFEFFleft,right,relation\r\n" + rows.map(r => [r.left, r.right, r.relation].map(csvCell).join(",")).join("\r\n");
}
