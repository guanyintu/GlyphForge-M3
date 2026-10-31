import { db } from '../storage/db';
import { packStatus, mergePacks } from '../storage/packs';
import { allNodes } from './subgraphs';
import { validateGraph } from './script';
import { validatePacks, type ExtensionPack } from './packs';
import { importPackage, ResourceDependencyError, type Dependency } from './sharing';
import { validateSharePayload } from './share-code';
import type { Resource, Workflow } from './model';

export interface SharePreview {
  name: string; version: number; nodes: number; subgraphs: number;
  dependencies: { id: string; label: string; status: string }[];
  extensions: { key: string; status: string }[];
  missing: Dependency[];
}
/** No writes, even for a fully self-contained portable package. Confirmation revalidates. */
export async function previewShare(data: unknown): Promise<SharePreview> {
  validateSharePayload(data);
  const p = data as { workflow: Workflow; version: number; dependencies?: Dependency[]; resources: { meta: Resource }[]; packManifest?: ExtensionPack[] };
  validateGraph(p.workflow);
  validatePacks(p.packManifest);
  const packs = mergePacks([p.packManifest ?? [], p.workflow.extensions ?? [], ...p.resources.flatMap(r => r.meta?.definition?.type === 'dynamic' ? [r.meta.definition.workflow.extensions ?? []] : [])]);
  if (p.version !== 7 && packs.length) throw new Error('扩展需要 v7 分享包');
  const installed = await db.extensionPacks.toArray();
  mergePacks([installed.map(r => r.manifest), packs]); // Same ID/version content conflicts fail before confirmation.
  let missing: Dependency[] = [];
  try { await importPackage(data, {}, true); }
  catch (e) { if (e instanceof ResourceDependencyError) missing = e.dependencies; else throw e; }
  const dependencies = await Promise.all((p.dependencies ?? []).map(async d => {
    const snapshot = p.resources.find(r => r.meta.id === d.id);
    const local = await db.resources.get(d.id);
    return { id: d.id, label: `${d.name} · ${d.kind} · v${d.version}`, status: snapshot ? `所选快照${snapshot.meta.definition ? ' / ' + snapshot.meta.definition.type + ' 定义' : ''}` : !local ? '缺失，需绑定' : local.kind !== d.kind || local.version !== d.version ? '本地类型 / 版本冲突，需绑定' : '本地已安装 / 版本一致' };
  }));
  return { name: p.workflow.name, version: p.version, nodes: allNodes(p.workflow).length, subgraphs: p.workflow.subgraphs?.length ?? 0, dependencies,
    extensions: packs.map(p => ({ key: `${p.id}@${p.version}`, status: packStatus(p, installed) + '；导入保留禁用状态，未知发布者不会自动启用' })), missing };
}
