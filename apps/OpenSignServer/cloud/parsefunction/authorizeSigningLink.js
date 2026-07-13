import {
  RECIPIENT_AUTH_MODE_EXTERNAL,
  authorizeSigner,
  authorizeExternalSigner,
  createTraceId,
  hashToken,
  resolveSigningLinkContext,
} from '../services/signingAuthorization/index.js';

export default async function authorizeSigningLink(request) {
  const traceId = createTraceId();
  const token = request.params?.token || '';
  if (!token) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Signature token is required.');
  }
  const tokenHash = hashToken(token);
  const context = await resolveSigningLinkContext({
    token,
    docId: request.params?.docId || '',
    signerEmail: request.params?.signerEmail || '',
    signerId: request.params?.signerId || '',
    traceId,
    cloudFunction: 'authorizeSigningLink',
  });

  const authorization =
    context.authMode === RECIPIENT_AUTH_MODE_EXTERNAL
      ? await authorizeExternalSigner({
          doc: context.doc,
          signer: context.signer,
          placeholder: context.placeholder,
          signingToken: token,
          externalGrantToken: request.params?.externalSigningGrant || '',
          requirePending: true,
          traceId,
          cloudFunction: 'authorizeSigningLink',
        })
      : authorizeSigner({
          doc: context.doc,
          signer: context.signer,
          requestUser: request.user,
          tokenEmail: context.decoded.signerEmail,
          requirePending: true,
          traceId,
          tokenHash,
          cloudFunction: 'authorizeSigningLink',
        });

  return {
    authorized: true,
    status: 'authorized',
    traceId,
    docId: context.doc.objectId,
    signerId: authorization.signerId,
    signingOrderAllowed: true,
    alreadySigned: false,
    authMode: context.authMode,
    sendmail: context.decoded.sendmail,
  };
}
