import {
  authorizeExternalSigner,
  resolveSigningLinkContext,
  verifyExternalSigningOtpCode,
} from '../services/signingAuthorization/index.js';

export default async function verifyExternalSigningOtp(request) {
  const context = await resolveSigningLinkContext({
    token: request.params?.token || '',
    docId: request.params?.docId || '',
    signerEmail: request.params?.signerEmail || '',
    signerId: request.params?.signerId || '',
    cloudFunction: 'verifyExternalSigningOtp',
  });

  const verification = await verifyExternalSigningOtpCode(
    context,
    request.params?.otpCode || request.params?.otp || '',
    request
  );

  await authorizeExternalSigner({
    doc: context.doc,
    signer: context.signer,
    placeholder: context.placeholder,
    signingToken: request.params?.token || '',
    externalGrantToken: verification.grantToken,
    requirePending: true,
    traceId: verification.traceId,
    cloudFunction: 'verifyExternalSigningOtp',
  });

  return {
    success: true,
    traceId: verification.traceId,
    docId: context.doc.objectId,
    signerId: context.signerId,
    authMode: 'external_email_otp',
    externalGrant: verification.grantToken,
    expiresAt: verification.expiresAt,
    maskedEmail: verification.maskedEmail,
  };
}
