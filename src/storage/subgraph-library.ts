import Dexie, { type Table } from "dexie";
import type { SubgraphDefinition } from "../core/model";
import { keyOf, reachableDefinitions } from "../core/subgraphs";
interface LibraryItem { key: string; definition: SubgraphDefinition; dependencies: SubgraphDefinition[]; extensions?: import("../core/packs").ExtensionPack[] }
class FunctionLibrary extends Dexie {
  definitions!: Table<LibraryItem, string>;
  constructor() { super("glyphforge-functions-v1"); this.version(1).stores({ definitions: "key" }); }
}
export const functionLibrary = new FunctionLibrary();
export async function saveDefinition(definition: SubgraphDefinition, dependencies: SubgraphDefinition[], extensions?: import("../core/packs").ExtensionPack[]) {
  const needed = [definition, ...reachableDefinitions(definition.nodes, dependencies).filter(d => keyOf(d) !== keyOf(definition))];
  await functionLibrary.transaction("rw", functionLibrary.definitions, async () => {
    const old = await functionLibrary.definitions.get(keyOf(definition));
    if (old && JSON.stringify({ ...old.definition, name: definition.name }) !== JSON.stringify(definition)) throw new Error("子图库中已有不同的同版本定义，请发布新版本或复制定义");
    await functionLibrary.definitions.put({ key: keyOf(definition), definition, dependencies: needed, ...(extensions?{extensions}:{}) });
  });
}
