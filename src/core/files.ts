import type { Candidate } from "./model";
export class DelimitedParser {
  private quoted = false;
  private pendingQuote = false;
  private skipLF = false;
  private cell = "";
  private row: string[] = [];
  private first = true;
  constructor(private delimiter = ",") {}
  feed(text: string, final = false): string[][] {
    const rows: string[][] = [];
    const finishCell = () => {
      this.row.push(this.cell);
      this.cell = "";
    };
    const finishRow = () => {
      finishCell();
      if (this.row.some(Boolean)) rows.push(this.row);
      this.row = [];
    };
    for (let ch of text) {
      if (this.first) {
        this.first = false;
        if (ch === "\uFEFF") continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') {
          this.cell += '"';
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === '"') this.pendingQuote = true;
        else this.cell += ch;
      } else {
        if (this.skipLF) {
          this.skipLF = false;
          if (ch === "\n") continue;
        }
        if (ch === '"' && !this.cell) this.quoted = true;
        else if (ch === this.delimiter) finishCell();
        else if (ch === "\n" || ch === "\r") {
          finishRow();
          if (ch === "\r") this.skipLF = true;
        } else this.cell += ch;
      }
      if (this.cell.length > 65536 || this.row.length > 100)
        throw new Error("单行或字段过大");
    }
    if (final) {
      if (this.quoted && !this.pendingQuote) throw new Error("CSV 引号未闭合");
      this.quoted = false;
      this.pendingQuote = false;
      if (this.cell || this.row.length) finishRow();
    }
    return rows;
  }
}
export async function* fileWords(
  file: Blob,
  name: string,
): AsyncGenerator<string> {
  if (file.size > 64 * 1024 * 1024) throw new Error("资源文件最大 64 MB");
  if (/\.json$/i.test(name)) {
    const data: unknown = JSON.parse(await file.text());
    const entries = Array.isArray(data)
      ? data
      : data && typeof data === "object"
        ? (data as { entries: unknown }).entries
        : undefined;
    if (!Array.isArray(entries) || entries.length > 1000000)
      throw new Error("JSON 需要词条数组或含 entries 数组的对象，最多一百万条");
    for (const e of entries) {
      if (typeof e === "string") yield e;
      else if (e && typeof e.text === "string") yield e.text;
      else throw new Error("词条必须是字符串或包含 text 的对象");
    }
    return;
  }
  const delimiter = /\.csv$/i.test(name)
    ? ","
    : /\.tsv$/i.test(name)
      ? "\t"
      : "\u0000";
  const parser = new DelimitedParser(delimiter);
  const reader = file.stream().getReader(),
    decoder = new TextDecoder();
  let first = true,
    column = 0;
  function values(rows: string[][]) {
    const out: string[] = [];
    for (const row of rows) {
      if (first) {
        first = false;
        const header = row.findIndex((x) =>
          ["text", "词条", "名字"].includes(x.trim().toLowerCase()),
        );
        if (header >= 0) {
          column = header;
          continue;
        }
      }
      const text = row[column]?.trim();
      if (text) out.push(text);
    }
    return out;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield* values(parser.feed(decoder.decode(value, { stream: true })));
    }
    yield* values(parser.feed(decoder.decode(), true));
  } finally {
    reader.releaseLock();
  }
}
export function csvCell(text: string) {
  return `"${text.replaceAll('"', '""')}"`;
}
export function resultsFile(
  candidates: Candidate[],
  format: "txt" | "csv" | "json",
) {
  if (format === "json")
    return JSON.stringify(
      { format: "glyphforge-results", version: 1, entries: candidates },
      null,
      2,
    );
  if (format === "csv")
    return (
      "\uFEFFtext,workflowId,seed\r\n" +
      candidates
        .map((c) =>
          [c.text, c.workflowId || "", String(c.seed ?? "")]
            .map(csvCell)
            .join(","),
        )
        .join("\r\n")
    );
  return candidates.map((c) => c.text).join("\n");
}
