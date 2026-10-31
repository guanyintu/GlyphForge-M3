import { guardJSON } from './packs';

// A transport envelope only. The payload remains the existing v1–v7 JSON package.
export const SHARE_LIMITS = Object.freeze({ json: 1024 * 1024, compressed: 64 * 1024, chars: 87500, ms: 8000, inputChunk: 128 });
const fallback = '；请下载 JSON 文件或本地保存，减少快照后重试';
const fail = (message: string): never => { throw new Error(`分享码：${message}${fallback}`); };
export function checkShareText(text: string) {
  if (text.length > SHARE_LIMITS.chars) fail('字符数超过 87500 上限');
  if (!/^GFS1\.deflate\.[1-9][0-9]{0,6}\.[a-f0-9]{64}\.[A-Za-z0-9_-]+$/.test(text)) fail('编码、协议版本或压缩算法不受支持（仅 GFS1 / deflate）');
}
function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64(s: string) {
  if (s.length % 4 === 1 || s.length > Math.ceil(SHARE_LIMITS.compressed * 4 / 3)) fail('压缩字节或 base64url 长度无效');
  const raw = atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (bytes.length > SHARE_LIMITS.compressed || base64(bytes) !== s) fail('非规范 base64url 或压缩字节超限');
  return bytes;
}
async function hash(bytes: Uint8Array<ArrayBuffer>) {
  if (!globalThis.crypto?.subtle) fail('浏览器缺少安全上下文 SHA-256');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function alive(signal?: AbortSignal) { if (signal?.aborted) throw new Error('分享任务已取消或超时'); }
async function transform(bytes: Uint8Array<ArrayBuffer>, decode: boolean, limit: number, signal?: AbortSignal) {
  alive(signal);
  let stream: CompressionStream | DecompressionStream;
  try { stream = decode ? new DecompressionStream('deflate') : new CompressionStream('deflate'); }
  catch { return fail('浏览器不支持原生 deflate 压缩 API'); }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, SHARE_LIMITS.ms);
  let offset = 0, total = 0;
  // Small compressed writes bound each native expansion; never materialize a full bomb.
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull(c) {
    if (offset === bytes.length) { c.close(); return; }
    const end = Math.min(bytes.length, offset + (decode ? SHARE_LIMITS.inputChunk : 16384));
    c.enqueue(bytes.slice(offset, end)); offset = end;
  } }, { highWaterMark: 0 });
  const reader = input.pipeThrough(stream, { signal: controller.signal }).getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      alive(controller.signal);
      const { value, done } = await reader.read();
      alive(controller.signal);
      if (done) break;
      total += value.byteLength;
      if (total > limit) fail(decode ? '流式解压超过声明长度 / 1 MiB 上限' : '压缩字节超过 64 KiB 上限');
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let start = 0; for (const chunk of chunks) { result.set(chunk, start); start += chunk.length; }
    return result;
  } catch (e) {
    if (controller.signal.aborted) throw new Error('分享任务已取消或超时');
    if (e instanceof TypeError) fail(decode ? '压缩数据损坏或截断' : '原生压缩失败');
    throw e;
  } finally {
    controller.abort(); void reader.cancel().catch(() => {});
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
export function validateSharePayload(data: unknown) {
  guardJSON(data, 3 * SHARE_LIMITS.json, 150000);
  const p = data as Record<string, unknown>;
  if (!p || p.format !== 'glyphforge' || ![1,2,3,4,5,6,7].includes(p.version as number)) fail('仅接受原有 v1–v7 工作流包，禁止嵌套 envelope');
  const allowed = ['format','version','irVersion','operatorVersions','resourceDefinitionVersion','workflow','dependencies','resources','packManifest'];
  if (Object.keys(p).some(k => !allowed.includes(k))) fail('工作流包包含未知字段或历史记录');
  if (!p.workflow || !Array.isArray(p.resources) || p.resources.length > 100) fail('工作流 / 资源快照无效');
  if (p.dependencies !== undefined && (!Array.isArray(p.dependencies) || p.dependencies.length > 100)) fail('依赖清单超过 100 项或无效');
}
export async function encodeShareCode(data: unknown, signal?: AbortSignal) {
  alive(signal);
  // Serialize the existing JSON format first (including its omission of optional undefined fields).
  // The replacer bounds work/allocation before the final encoded-byte check.
  let nodes = 0, units = 0;
  const text = JSON.stringify(data, (key, value: unknown) => {
    if (++nodes > 150000 || ['__proto__','prototype','constructor'].includes(key)) fail('序列化节点数量 / 保留键无效');
    units += key.length + (typeof value === 'string' ? value.length : 8);
    if (units > SHARE_LIMITS.json) fail('压缩前 JSON 超过 1 MiB 预算');
    if (typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol') fail('仅接受 JSON 内容');
    return value;
  });
  if (typeof text !== 'string') fail('仅接受 JSON 内容');
  const json = new TextEncoder().encode(text);
  if (json.length > SHARE_LIMITS.json) fail('压缩前 JSON 超过 1 MiB');
  validateSharePayload(JSON.parse(text));
  const packed = await transform(json, false, SHARE_LIMITS.compressed, signal);
  const checksum = await hash(json); alive(signal);
  const code = `GFS1.deflate.${json.length}.${checksum}.${base64(packed)}`;
  checkShareText(code);
  return { code, jsonBytes: json.length, compressedBytes: packed.length, chars: code.length, ratio: packed.length / json.length };
}
export async function decodeShareCode(code: string, signal?: AbortSignal): Promise<unknown> {
  alive(signal); checkShareText(code);
  const [, , length, checksum, body] = code.split('.');
  const size = Number(length);
  if (size > SHARE_LIMITS.json) fail('声明 JSON 超过 1 MiB');
  const bytes = await transform(unbase64(body), true, size, signal);
  if (bytes.length !== size) fail('解压长度不符');
  if (await hash(bytes) !== checksum) fail('内容 SHA-256 不符（仅检错，不验证身份）');
  alive(signal);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Bound structure before JSON.parse; ignore brackets inside JSON strings.
  let depth = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > 20) fail('JSON 深度超过 20'); }
    else if (c === '}' || c === ']') depth--;
  }
  const data: unknown = JSON.parse(text);
  validateSharePayload(data); alive(signal);
  return data;
}
