import { getExternalSignedDocumentDownloadUrl } from '../services/externalSignedDocumentDownload.js';
import { createTraceId } from '../services/signingAuthorization/index.js';

export default async function getExternalSignedDocumentDownload(request) {
  const traceId = request?.params?.traceId || createTraceId();
  try {
    const completionReference = request?.params?.completionReference || '';
    return await getExternalSignedDocumentDownloadUrl(completionReference, traceId);
  } catch (err) {
    console.log('EXTERNAL_SIGNED_DOCUMENT_DOWNLOAD_FAILED', {
      traceId,
      code: err?.code || '',
      message: err?.message || 'Signed document download failed.',
    });
    throw err;
  }
}
