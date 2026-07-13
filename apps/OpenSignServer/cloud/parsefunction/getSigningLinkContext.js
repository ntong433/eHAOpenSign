import {
  RECIPIENT_AUTH_MODE_EXTERNAL,
  RECIPIENT_AUTH_MODE_INTERNAL,
  createTraceId,
  hashToken,
  isSignerCompleted,
  maskEmailAddress,
  resolveSigningLinkContext,
} from '../services/signingAuthorization/index.js';

export default async function getSigningLinkContext(request) {
  const traceId = createTraceId();
  try {
    const context = await resolveSigningLinkContext({
      token: request.params?.token || '',
      docId: request.params?.docId || '',
      signerEmail: request.params?.signerEmail || '',
      signerId: request.params?.signerId || '',
      traceId,
      cloudFunction: 'getSigningLinkContext',
    });

    const alreadySigned = isSignerCompleted(context.doc, context.signerId);
    const authMode =
      context.authMode === RECIPIENT_AUTH_MODE_INTERNAL
        ? RECIPIENT_AUTH_MODE_INTERNAL
        : RECIPIENT_AUTH_MODE_EXTERNAL;
    const maskedEmail = maskEmailAddress(context.normalizedEmail);

    console.log('SIGNING LINK PREFLIGHT', {
      signingTraceId: traceId,
      traceId,
      tokenHash: hashToken(request.params?.token || ''),
      documentId: context.doc.objectId,
      signerId: context.signerId,
      authMode,
      maskedRecipient: maskedEmail,
      alreadySigned,
      result: 'resolved',
    });

    return {
      valid: true,
      status: 'ready',
      traceId,
      signingTraceId: traceId,
      docId: context.doc.objectId,
      signerId: context.signerId,
      authMode,
      maskedEmail,
      otpRequired: authMode === RECIPIENT_AUTH_MODE_EXTERNAL,
      loginRequired: authMode === RECIPIENT_AUTH_MODE_INTERNAL,
      alreadySigned,
    };
  } catch (err) {
    console.log('SIGNING LINK PREFLIGHT', {
      signingTraceId: traceId,
      traceId,
      tokenHash: hashToken(request.params?.token || ''),
      documentId: '',
      signerId: request.params?.signerId || '',
      authMode: '',
      maskedRecipient: '',
      alreadySigned: false,
      result: 'rejected',
      failureReason: err?.message || 'invalid-link',
    });
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'This signing link is invalid or no longer available.'
    );
  }
}
