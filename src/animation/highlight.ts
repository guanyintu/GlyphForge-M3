import { segmenter } from "../core/unicode";
/** Literal search uses existing result semantics; expand visual matches to whole graphemes. */
export function highlightedParts(text: string, query: string): { text: string; hit: boolean }[] {
  if (!query) return [{ text, hit: false }];
  const ranges: [number, number][] = [];
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(query, from);
    if (index < 0) break;
    ranges.push([index, index + query.length]); from = index + query.length;
  }
  let range = 0;
  const parts: { text: string; hit: boolean }[] = [];
  for (const glyph of segmenter.segment(text)) {
    while (range < ranges.length && ranges[range][1] <= glyph.index) range++;
    const hit = range < ranges.length && ranges[range][0] < glyph.index + glyph.segment.length;
    if (parts.at(-1)?.hit === hit) parts[parts.length - 1].text += glyph.segment;
    else parts.push({ text: glyph.segment, hit });
  }
  return parts;
}
