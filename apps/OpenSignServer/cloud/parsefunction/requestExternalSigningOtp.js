import { EmailService } from '../services/EmailService.js';
import {
  issueExternalSigningOtp,
  maskEmailAddress,
  resolveSigningLinkContext,
  revokeExternalSigningOtpRecords,
} from '../services/signingAuthorization/index.js';

const OTP_SUBJECT = 'Your verification code — Life Helpers Signature Portal';
const SUPPORT_EMAIL = 'helpdesk@lhinigeria.org';

function buildOtpEmailHtml({ otpCode = '', maskedEmail = '' }) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#1f2937;">
      <p>Hello,</p>
      <p>
        A verification code was requested to access a document sent to this email address
        through the Life Helpers Signature Portal.
      </p>
      <p style="margin:24px 0;">
        <span style="display:inline-block;padding:12px 18px;border-radius:10px;background:#f3f4f6;border:1px solid #d1d5db;font-size:28px;letter-spacing:6px;font-weight:700;color:#111827;">${otpCode}</span>
      </p>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not expect this request, you can ignore this email.</p>
      <p style="margin-top:24px;">
        Life Helpers Initiative<br />
        For assistance, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
  `;
}

export default async function requestExternalSigningOtp(request) {
  let context;
  let otpResult;
  try {
    context = await resolveSigningLinkContext({
      token: request.params?.token || '',
      docId: request.params?.docId || '',
      signerEmail: request.params?.signerEmail || '',
      signerId: request.params?.signerId || '',
      cloudFunction: 'requestExternalSigningOtp',
    });

    otpResult = await issueExternalSigningOtp(context, request);

    const emailResult = await EmailService.send({
      recipient: context.normalizedEmail,
      subject: OTP_SUBJECT,
      htmlContent: buildOtpEmailHtml({
        otpCode: otpResult.otpCode,
        maskedEmail: otpResult.maskedEmail,
      }),
      senderEmail: SUPPORT_EMAIL,
      forceApplication: true,
      replyTo: [SUPPORT_EMAIL],
      idempotencyKey: `external-otp:${context.doc.objectId}:${context.signerId}:${otpResult.traceId}`,
    });

    console.log('EXTERNAL OTP REQUEST', {
      signingTraceId: otpResult.traceId,
      traceId: otpResult.traceId,
      signerId: context.signerId,
      documentId: context.doc.objectId,
      maskedRecipient: otpResult.maskedEmail,
      authMode: context.authMode,
      rateLimitResult: 'accepted',
      GraphRequestId: emailResult.graphRequestId,
      sendStatus: 'sent',
      failureReason: '',
    });

    return {
      success: true,
      message: 'If this request is valid, a verification code has been sent.',
      traceId: otpResult.traceId,
      signingTraceId: otpResult.traceId,
      maskedEmail: otpResult.maskedEmail,
    };
  } catch (err) {
    if (context && otpResult) {
      await revokeExternalSigningOtpRecords(context, new Date());
    }
    const traceId = otpResult?.traceId || context?.traceId || '';
    console.log('EXTERNAL OTP REQUEST', {
      signingTraceId: traceId,
      traceId,
      signerId: context?.signerId || request.params?.signerId || '',
      documentId: context?.doc?.objectId || request.params?.docId || '',
      maskedRecipient: context?.normalizedEmail ? maskEmailAddress(context.normalizedEmail) : '',
      authMode: context?.authMode || '',
      rateLimitResult: err?.message?.includes('Please wait') ? 'rejected' : 'not_applicable',
      GraphRequestId: err?.response?.headers?.['request-id'] || '',
      sendStatus: 'failed',
      failureReason: err?.message || 'Unable to send verification code.',
    });
    if (err?.message?.includes('Please wait')) {
      throw err;
    }
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      'Unable to send the verification code.'
    );
  }
}
