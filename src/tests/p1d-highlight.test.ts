import { expect, it } from "vitest";
import { highlightedParts } from "../animation/highlight";
it("highlights only literal matching characters, including repeated hits", () => {
  expect(highlightedParts("电子猫猫咪", "猫")).toEqual([{ text: "电子", hit: false }, { text: "猫猫", hit: true }, { text: "咪", hit: false }]);
  expect(highlightedParts("星际猫咪", "猫")).toEqual([{ text: "星际", hit: false }, { text: "猫", hit: true }, { text: "咪", hit: false }]);
});
it("never splits a ZWJ emoji, modifier, flag or combining sequence", () => {
  for (const [text, query] of [["👨‍👩‍👧猫", "👩"], ["👍🏽猫", "🏽"], ["🇨🇳猫", "🇨"], ["e\u0301猫", "e"]]) {
    const parts = highlightedParts(text, query); expect(parts[0]).toEqual({ text: text.slice(0, -1), hit: true }); expect(parts.map(p => p.text).join("")).toBe(text);
  }
});
it("supports empty input, non-matches, extension Han and literal regex punctuation", () => {
  expect(highlightedParts("", "猫")).toEqual([]);
  expect(highlightedParts("猫", "")).toEqual([{ text: "猫", hit: false }]);
  expect(highlightedParts("猫", "狗")).toEqual([{ text: "猫", hit: false }]);
  expect(highlightedParts("𠀀.猫", ".")[1]).toEqual({ text: ".", hit: true });
  expect(highlightedParts("𠀀猫", "𠀀")[0]).toEqual({ text: "𠀀", hit: true });
});
it("handles multi-grapheme literal matches without changing the original text", () => {
  expect(highlightedParts("猫咪猫咪", "咪猫")).toEqual([{ text: "猫", hit: false }, { text: "咪猫", hit: true }, { text: "咪", hit: false }]);
});
