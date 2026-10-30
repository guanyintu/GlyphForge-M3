import { ReverseSearcher } from "../core/reverse-search";
import type { ReverseOptions } from "../core/reverse-search";
const searcher = new ReverseSearcher();
self.onmessage = async (event: MessageEvent<{ id: number; input: string; options: ReverseOptions }>) => {
  const { id, input, options } = event.data;
  try {
    self.postMessage({ id, type: "started" });
    const result = await searcher.search(input, options, undefined, matches => self.postMessage({ id, type: "batch", matches }), (phase, processed) => self.postMessage({ id, type: "progress", phase, processed }));
    self.postMessage({ id, type: "done", result });
  } catch (e) { self.postMessage({ id, type: "error", message: e instanceof Error ? e.message : String(e) }); }
};
