import { SHARE_LIMITS, checkShareText } from './share-code';
import type { Workflow } from './model';
import type { encodeShareCode } from './share-code';
export type EncodedShare = Awaited<ReturnType<typeof encodeShareCode>>;
type Request = { action: 'encode'; workflow: Workflow; selection: false | string[] } | { action: 'decode' | 'preview'; code: string };
let active = 0;
/** Dedicated, disposable worker: export/JSON/hash/native streams never block the UI. */
export function shareTask<T = unknown>(request: Request, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('分享任务已取消'));
  if (request.action !== 'encode') { try { checkShareText(request.code); } catch (e) { return Promise.reject(e); } }
  if (active >= 2) return Promise.reject(new Error('最多同时执行两个分享任务'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('../workers/sharing.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('无法创建分享 Worker，请使用 JSON 文件')); return; }
    active++;
    let settled = false;
    const finish = (error?: Error, data?: T) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate(); active--;
      if (error) reject(error); else resolve(data!);
    };
    const cancel = () => finish(new Error('分享任务已取消'));
    const timer = setTimeout(() => finish(new Error('分享任务超过 8 秒；请减少快照或下载 JSON 文件')), SHARE_LIMITS.ms);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(undefined, data.result);
    worker.onerror = () => finish(new Error('分享 Worker 无法启动，请使用 JSON 文件'));
    try { worker.postMessage(request); } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
  });
}
