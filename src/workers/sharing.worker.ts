import { captureShareResources } from '../storage/share-resources';
import { SHARE_LIMITS } from '../core/share-code';
import { exportPackage } from '../core/sharing';
import { encodeShareCode, decodeShareCode } from '../core/share-code';
import { previewShare } from '../core/share-preview';
self.onmessage = async ({ data }) => {
  try {
    let result = data.action === 'encode'
      ? await encodeShareCode(await exportPackage(data.workflow, data.selection, undefined, {plan:await captureShareResources(data.workflow),maxBytes:SHARE_LIMITS.json}))
      : await decodeShareCode(data.code);
    if (data.action === 'preview') result = { data: result, summary: await previewShare(result) };
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
