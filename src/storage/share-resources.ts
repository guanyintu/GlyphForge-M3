import { db } from './db';
import { planResources, resourceDependencies, workflowResourceIds } from '../core/resource-catalog';
import { guardJSON } from '../core/packs';
import { SHARE_LIMITS } from '../core/share-code';
import type { Resource, Workflow } from '../core/model';
/** Code export loads only the declared closure, never the entire local catalog. */
export async function captureShareResources(workflow: Workflow) {
  return db.transaction('r', db.resources, async () => {
    const roots = workflowResourceIds(workflow), seen = new Set<string>(), catalog: Resource[] = [];
    let bytes = 0;
    async function load(ids: string[], depth = 0): Promise<void> {
      if (depth >= 12) throw new Error('分享资源依赖超过 12 层');
      const next = [...new Set(ids)].filter(id => !seen.has(id));
      if (seen.size + next.length > 100) throw new Error('分享资源依赖超过 100 项');
      next.forEach(id => seen.add(id));
      for (const r of await db.resources.bulkGet(next)) if (r) {
        const text = JSON.stringify(r);
        if (text.length > SHARE_LIMITS.json) throw new Error('分享资源元数据超过 1 MiB；请下载 JSON 文件');
        guardJSON(JSON.parse(text), 3 * SHARE_LIMITS.json, 150000);
        bytes += new TextEncoder().encode(text).length;
        if (bytes > SHARE_LIMITS.json) throw new Error('分享资源元数据超过 1 MiB；请下载 JSON 文件');
        catalog.push(r);
      }
      const deps = catalog.flatMap(resourceDependencies).filter(id => !seen.has(id));
      if (deps.length) await load(deps, depth + 1);
    }
    await load(roots);
    return planResources(roots, catalog);
  });
}
