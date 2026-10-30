export const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export function glyphs(text: string) {
  return Array.from(segmenter.segment(text), (x) => x.segment);
}
export function unicodeMetrics(text: string) {
  return {
    utf16: text.length,
    codePoints: Array.from(text).length,
    graphemes: glyphs(text).length,
    bytes: new TextEncoder().encode(text).length,
  };
}
