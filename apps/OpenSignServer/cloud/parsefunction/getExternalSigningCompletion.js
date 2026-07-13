import { getExternalSigningCompletionMetadata } from '../services/externalSignedDocumentDownload.js';
import { createTraceId } from '../services/signingAuthorization/index.js';

export default async function getExternalSigningCompletion(request) {
  const traceId = request?.params?.traceId || createTraceId();
  try {
    const completionReference = request?.params?.completionReference || '';
    const result = await getExternalSigningCompletionMetadata(completionReference);
    return {
      ...result,
      traceId,
    };
  } catch (err) {
    console.log('EXTERNAL_SIGNING_COMPLETION_LOOKUP_FAILED', {
      traceId,
      code: err?.code || '',
      message: err?.message || 'Completion lookup failed.',
    });
    throw err;
  }
}
