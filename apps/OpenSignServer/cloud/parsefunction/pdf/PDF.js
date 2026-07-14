import fs from 'node:fs';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import {
  cloudServerUrl,
  saveFileUsage,
  getSecureUrl,
  serverAppId,
  useLocal,
} from '../../../Utils.js';
import GenerateCertificate from './GenerateCertificate.js';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { Placeholder } from './Placeholder.js';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { parseUploadFile } from '../../../utils/fileUtils.js';
import { EmailService } from '../../services/EmailService.js';
import {
  buildFinalNotification,
  buildFinalPdfFilename,
  buildProgressNotification,
} from '../../templates/lhi/requesterNotifications.js';
import {
  COMPLETION_ACTIVITIES,
  isCompletionRelevant,
} from '../../../utils/workflowUtils.js';
import {
  getSignerEmail,
  getSignerName,
  normalizeEmail,
  pointerId,
} from '../../utils/recipientIdentity.js';
import {
  AUTHENTICATED_SIGNING_REQUIRED,
  RECIPIENT_AUTH_MODE_EXTERNAL,
  authorizeSigner,
  authorizeExternalSigner,
  completeExternalGrant,
  createTraceId,
  findSignerById,
  getRemainingSignerCount,
  hashToken,
  isSignerCompleted,
  resolveSigningLinkContext,
} from '../../services/signingAuthorization/index.js';
import { createExternalSignedDocumentDownloadAuthorization } from '../../services/externalSignedDocumentDownload.js';

// Audit-trail activities that count toward document completion. The free
// build only counts 'Signed'; EE additionally counts 'Approved'.

// A placeholder participates in completion unless it is a prefill entry.
// EE additionally excludes viewers (who never act on the document).

// Strict-order gating: returns the signerObjId of the prior placeholder
// still pending, or null when the strict-order requirement is satisfied.

const serverUrl = cloudServerUrl; // process.env.SERVER_URL;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;
const eSignName = 'Life Helpers Signature Portal';
const eSigncontact = 'helpdesk@lhinigeria.org';
const docUrl = `${serverUrl}/classes/contracts_Document`;
const SIGNING_OPERATION_CLASS = 'contracts_SigningOperation';
const headers = {
  'Content-Type': 'application/json',
  'X-Parse-Application-Id': APPID,
  'X-Parse-Master-Key': masterKEY,
};

function generateDocumentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function decodeSigningToken(token = '') {
  if (!token) return {};
  try {
    const decoded = Buffer.from(String(token), 'base64').toString('utf8');
    const [docId, email, signerId] = decoded.split('/');
    return { docId: docId || '', email: email || '', signerId: signerId || '' };
  } catch {
    return {};
  }
}

async function unlinkFile(path) {
  if (fs.existsSync(path)) {
    try {
      fs.unlinkSync(path);
    } catch (err) {
      console.log('Err in unlink file: ', path);
    }
  }
}

// `updateDoc` is used to create url in from pdfFile
async function uploadFile(pdfName, filepath) {
  try {
    const filedata = fs.readFileSync(filepath);
    let fileUrl;

    const fileRes = await parseUploadFile(pdfName, filedata, 'application/pdf');
    fileUrl = getSecureUrl(fileRes?.url)?.url;

    return { imageUrl: fileUrl };
  } catch (err) {
    console.log('Err ', err);
    // below line of code is used to remove exported signed pdf file from exports folder
    unlinkFile(filepath);
    throw err;
  }
}

function createPrivateAcl() {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  return acl;
}

function buildAuditTrailUpdate(data, userId, ipAddress, className, sign, signedUrl = '', operationId = '') {
  const UserPtr = { __type: 'Pointer', className: className, objectId: userId };
  const obj = {
    UserPtr: UserPtr,
    SignedUrl: signedUrl,
    Activity: 'Signed',
    ipAddress: ipAddress,
    SignedOn: new Date(),
    Signature: sign,
  };
  if (operationId) {
    obj.SigningOperationId = operationId;
  }

  if (data.AuditTrail && data.AuditTrail.length > 0) {
    const AuditTrail = JSON.parse(JSON.stringify(data.AuditTrail));
    const existingIndex = AuditTrail.findIndex(
      entry => entry.UserPtr.objectId === userId && entry.Activity !== 'Created'
    );
    existingIndex !== -1
      ? (AuditTrail[existingIndex] = { ...AuditTrail[existingIndex], ...obj })
      : AuditTrail.push(obj);
    return AuditTrail;
  }

  return [obj];
}

function computeDocumentCompleted(data, updateAuditTrail) {
  const auditTrail = updateAuditTrail.filter(x => COMPLETION_ACTIVITIES.includes(x.Activity));
  if (data.Signers && data.Signers.length > 0) {
    const completionRelevant =
      data.Placeholders?.length > 0 ? data.Placeholders.filter(isCompletionRelevant) : [];
    return auditTrail.length >= completionRelevant.length && completionRelevant.length > 0;
  }
  return true;
}

// `updateDoc` is used to update signedUrl, AuditTrail, Iscompleted in document
async function updateDoc(
  docId,
  url,
  userId,
  ipAddress,
  data,
  className,
  sign,
  documentHash,
  activity,
  options = {}
) {
  try {
    const operationId = options.operationId || '';
    const updateAuditTrail = buildAuditTrailUpdate(
      data,
      userId,
      ipAddress,
      className,
      sign,
      url,
      operationId
    );
    const isCompleted = computeDocumentCompleted(data, updateAuditTrail);
    const committedAt = new Date();
    const body = {
      SignedUrl: url,
      AuditTrail: updateAuditTrail,
      IsCompleted: isCompleted,
      SigningState: isCompleted ? 'completed' : 'pending',
      LastSigningOperationId: operationId,
      LastSigningCompletedAt: committedAt,
      SigningProcessingSignerId: '',
      CurrentSigningOperationId: '',
    };
    if (documentHash && isCompleted) {
      body.DocumentHash = documentHash;
    }
    if (options.certificateUrl && isCompleted) {
      body.CertificateUrl = options.certificateUrl;
    }
    const signedRes = await axios.put(`${docUrl}/${docId}`, body, { headers });
    if (!signedRes?.data?.updatedAt) {
      throw new Error('Document signing state was not committed.');
    }
    return {
      isCompleted: isCompleted,
      message: 'success',
      AuditTrail: updateAuditTrail,
      DocumentHash: documentHash && isCompleted ? documentHash : undefined,
      CertificateUrl: options.certificateUrl,
      committedAt,
    };
  } catch (err) {
    console.log('update doc err ', err);
    throw err;
  }
}

function getRequesterEmail(doc = {}) {
  return normalizeEmail(doc?.SenderMail || doc?.ExtUserPtr?.Email || '');
}

function getViewUrl(publicUrl, docId) {
  const base = process.env.PUBLIC_APP_URL || publicUrl || process.env.PUBLIC_URL || process.env.APP_URL || 'https://sign.lhinigeria.org';
  return base ? `${base}/recipientSignPdf/${docId}` : '';
}

async function startSigningOperation({ docId, signerId, traceId, tokenHash, authMode }) {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const activeQuery = new Parse.Query(SIGNING_OPERATION_CLASS);
  activeQuery.equalTo('DocumentId', docId);
  activeQuery.equalTo('SignerId', signerId || '');
  activeQuery.equalTo('Status', 'processing');
  activeQuery.greaterThan('StartedAt', staleCutoff);
  const active = await activeQuery.first({ useMasterKey: true });
  if (active) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This signature is already being processed. Please wait a moment.'
    );
  }

  const operation = new Parse.Object(SIGNING_OPERATION_CLASS);
  operation.set('OperationId', traceId);
  operation.set('DocumentId', docId);
  operation.set('SignerId', signerId || '');
  operation.set('Status', 'processing');
  operation.set('StartedAt', new Date());
  operation.set('SigningTokenHash', tokenHash || '');
  operation.set('AuthMode', authMode || '');
  operation.setACL(createPrivateAcl());
  await operation.save(null, { useMasterKey: true });
  return operation;
}

async function markSigningOperation(operation, status, updates = {}) {
  if (!operation) return;
  operation.set('Status', status);
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) operation.set(key, value);
  });
  if (status === 'completed') {
    operation.set('CompletedAt', new Date());
  }
  if (status === 'failed') {
    operation.set('FailedAt', new Date());
  }
  await operation.save(null, { useMasterKey: true });
}

async function markDocumentProcessing(docObj, operation, signerId) {
  if (!docObj || !operation) return;
  docObj.set('SigningState', 'processing');
  docObj.set('CurrentSigningOperationId', operation.get('OperationId'));
  docObj.set('SigningProcessingSignerId', signerId || '');
  docObj.set('SigningProcessingAt', new Date());
  await docObj.save(null, { useMasterKey: true });
}

async function rollbackDocumentProcessing(docId, operationId, reason) {
  if (!docId || !operationId) return;
  try {
    const docObj = new Parse.Object('contracts_Document');
    docObj.id = docId;
    docObj.set('SigningState', 'pending');
    docObj.set('CurrentSigningOperationId', '');
    docObj.set('SigningProcessingSignerId', '');
    docObj.set('LastSigningFailure', reason || 'Signing failed.');
    docObj.set('LastSigningFailedAt', new Date());
    await docObj.save(null, { useMasterKey: true });
  } catch (err) {
    console.log('SIGNING_ROLLBACK_FAILED', {
      operationId,
      documentId: docId,
      message: err?.message || 'rollback failed',
    });
  }
}

async function verifyStoredPdfUrl(url, traceId) {
  try {
    let targetUrl = url;
    if (useLocal === 'true' || url.includes('/files/')) {
      const publicPrefix = process.env.SERVER_URL || '';
      const internalPrefix = cloudServerUrl;
      if (publicPrefix && url.startsWith(publicPrefix)) {
        targetUrl = url.replace(publicPrefix, internalPrefix);
      } else {
        targetUrl = url.replace('http://localhost:3000/api/app', 'http://localhost:8085/app');
      }
    }
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 50 * 1024 * 1024,
    });
    if (!response?.data || Buffer.byteLength(response.data) === 0) {
      throw new Error('Stored PDF is empty.');
    }
    return Buffer.byteLength(response.data);
  } catch (err) {
    console.log('PDF_STORAGE_FAILED', {
      traceId,
      failureReason: err?.message || 'Stored PDF could not be verified.',
    });
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      'The signed PDF could not be stored. Please try again.'
    );
  }
}

async function generateUploadCertificate(doc, pfx, traceId) {
  const certificate = await GenerateCertificate(doc);
  const certificatePdf = await PDFDocument.load(certificate);
  const P12Buffer = fs.readFileSync(pfx.name);
  const p12 = new P12Signer(P12Buffer, { passphrase: pfx.passphrase || null });
  pdflibAddPlaceholder({
    pdfDoc: certificatePdf,
    reason: `Digitally signed by ${eSignName}.`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await certificatePdf.save();
  const CertificateBuffer = Buffer.from(pdfWithPlaceholderBytes);
  const certificateOBJ = new SignPdf();
  const signedCertificate = await certificateOBJ.sign(CertificateBuffer, p12);
  const certificatePath = `./exports/signed_certificate_${doc.objectId}.pdf`;
  fs.writeFileSync(certificatePath, signedCertificate);
  const file = await uploadFile('certificate.pdf', certificatePath);
  if (!file?.imageUrl) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      'The completion certificate could not be stored.'
    );
  }
  console.log('CERTIFICATE_STORAGE_SUCCEEDED', {
    traceId,
    documentId: doc.objectId,
    certificateUrlHash: hashToken(file.imageUrl),
  });
  saveFileUsage(CertificateBuffer.length, file.imageUrl, doc?.CreatedBy?.objectId);
  return {
    certificateUrl: file.imageUrl,
    certificatePath,
  };
}

async function sendNotifyMail(doc, signUser, publicUrl, traceId) {
  try {
    const requesterEmail = getRequesterEmail(doc);
    if (!requesterEmail) return { status: 'skipped', reason: 'missing-requester-email' };
    const remainingCount = getRemainingSignerCount(doc, pointerId(signUser));
    if (remainingCount <= 0) return { status: 'skipped', reason: 'final-signer' };

    const viewUrl = getViewUrl(publicUrl, doc?.objectId);
    const { subject, html } = buildProgressNotification({
      doc,
      signer: signUser,
      remainingCount,
      status: 'Out for signatures',
      viewUrl,
      signedAt: new Date(),
    });

    const result = await EmailService.send({
      recipient: requesterEmail,
      subject,
      htmlContent: html,
      senderEmail: 'helpdesk@lhinigeria.org',
      forceApplication: true,
      replyTo: doc?.SenderMail || doc?.ExtUserPtr?.Email || '',
      idempotencyKey: `${doc.objectId}-${pointerId(signUser)}-progress`,
    });

    console.log('REQUESTER NOTIFICATION', {
      traceId,
      notificationType: 'signer-progress',
      sender: result.senderEmail,
      recipient: requesterEmail,
      subject,
      attachmentFilename: '',
      attachmentSize: 0,
      GraphRequestId: result.graphRequestId,
      status: 'sent',
    });
    return { status: 'sent', graphRequestId: result.graphRequestId };
  } catch (err) {
    console.log('REQUESTER NOTIFICATION', {
      traceId,
      notificationType: 'signer-progress',
      status: 'failed',
      error: err.message,
    });
    return { status: 'failed', error: err.message };
  }
}

async function acquireFinalEmailLock(docId) {
  const query = new Parse.Query('contracts_Document');
  const docObj = await query.get(docId, { useMasterKey: true });
  const status = docObj.get('finalEmailStatus');
  const lastAttempt = docObj.get('finalEmailLastAttemptAt');
  const staleSending =
    status === 'sending' &&
    lastAttempt &&
    Date.now() - new Date(lastAttempt).getTime() > 10 * 60 * 1000;

  if (status === 'sent') {
    return { shouldSend: false, docObj };
  }
  if (status === 'sending' && !staleSending) {
    return { shouldSend: false, docObj };
  }

  docObj.set('finalEmailStatus', 'sending');
  docObj.set('finalEmailLastAttemptAt', new Date());
  docObj.increment('finalEmailAttemptCount', 1);
  await docObj.save(null, { useMasterKey: true });
  return { shouldSend: true, docObj };
}

async function markFinalEmailSent(docId, result) {
  const docObj = new Parse.Object('contracts_Document');
  docObj.id = docId;
  docObj.set('finalEmailStatus', 'sent');
  docObj.set('requesterCompletionNotifiedAt', new Date());
  docObj.set('finalEmailMessageId', result?.messageId || result?.graphRequestId || '');
  docObj.set('finalEmailSentAt', new Date());
  await docObj.save(null, { useMasterKey: true });
}

async function markFinalEmailPending(docId, err) {
  const docObj = new Parse.Object('contracts_Document');
  docObj.id = docId;
  docObj.set('finalEmailStatus', 'pending');
  docObj.set('finalEmailLastError', err?.message || 'Final completion email failed.');
  await docObj.save(null, { useMasterKey: true });
}

async function sendFinalCompletionEmail({ doc, finalPdfBuffer, certificatePath, publicUrl, traceId }) {
  const requesterEmail = getRequesterEmail(doc);
  if (!requesterEmail || !finalPdfBuffer) {
    return { status: 'skipped', reason: !requesterEmail ? 'missing-requester-email' : 'missing-pdf' };
  }

  const lock = await acquireFinalEmailLock(doc.objectId);
  if (!lock.shouldSend) {
    console.log('REQUESTER NOTIFICATION', {
      traceId,
      notificationType: 'final-completion',
      recipient: requesterEmail,
      subject: `Document Fully Signed — ${doc?.Name || 'Document'}`,
      status: `skipped-${lock.docObj.get('finalEmailStatus') || 'locked'}`,
    });
    return { status: 'skipped', reason: lock.docObj.get('finalEmailStatus') || 'locked' };
  }

  const viewUrl = getViewUrl(publicUrl, doc.objectId);
  const { subject, html } = buildFinalNotification({
    doc,
    signers: doc.Signers || [],
    viewUrl,
    completedAt: new Date(),
  });
  const finalPdfFilename = buildFinalPdfFilename(doc?.Name || 'Document');
  const attachments = [
    {
      name: finalPdfFilename,
      contentBytes: Buffer.from(finalPdfBuffer).toString('base64'),
      contentType: 'application/pdf',
    },
  ];

  if (certificatePath && fs.existsSync(certificatePath)) {
    const certificateBuffer = fs.readFileSync(certificatePath);
    attachments.push({
      name: `${doc?.Name || 'Document'}-Audit-Trail.pdf`,
      contentBytes: certificateBuffer.toString('base64'),
      contentType: 'application/pdf',
    });
  }

  try {
    const result = await EmailService.send({
      recipient: requesterEmail,
      subject,
      htmlContent: html,
      senderEmail: 'helpdesk@lhinigeria.org',
      forceApplication: true,
      replyTo: doc?.SenderMail || doc?.ExtUserPtr?.Email || '',
      attachments,
      idempotencyKey: `${doc.objectId}-final-completion`,
    });
    await markFinalEmailSent(doc.objectId, result);
    console.log('REQUESTER NOTIFICATION', {
      traceId,
      notificationType: 'final-completion',
      sender: result.senderEmail,
      recipient: requesterEmail,
      subject,
      attachmentFilename: finalPdfFilename,
      attachmentSize: Buffer.byteLength(finalPdfBuffer),
      GraphRequestId: result.graphRequestId,
      status: 'sent',
    });
    return { status: 'sent', graphRequestId: result.graphRequestId };
  } catch (err) {
    await markFinalEmailPending(doc.objectId, err);
    console.log('REQUESTER NOTIFICATION', {
      traceId,
      notificationType: 'final-completion',
      recipient: requesterEmail,
      subject,
      attachmentFilename: finalPdfFilename,
      attachmentSize: Buffer.byteLength(finalPdfBuffer),
      status: 'pending',
      error: err.message,
    });
    return { status: 'pending', error: err.message };
  }
}

// `sendMailsaveCertifcate` is used send completion mail and update complete status of document
async function sendMailsaveCertifcate(
  doc,
  pfx,
  isCustomMail,
  mailProvider,
  filename,
  finalPdfBuffer,
  publicUrl,
  traceId
) {
  const certificate = await GenerateCertificate(doc);
  const certificatePdf = await PDFDocument.load(certificate);
  const P12Buffer = fs.readFileSync(pfx.name);
  const p12 = new P12Signer(P12Buffer, { passphrase: pfx.passphrase || null });
  //  `pdflibAddPlaceholder` is used to add code of only digitial sign in certificate
  pdflibAddPlaceholder({
    pdfDoc: certificatePdf,
    reason: `Digitally signed by ${eSignName}.`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await certificatePdf.save();
  const CertificateBuffer = Buffer.from(pdfWithPlaceholderBytes);
  //`new signPDF` create new instance of CertificateBuffer and p12Buffer
  const certificateOBJ = new SignPdf();
  // `signedCertificate` is used to sign certificate digitally
  const signedCertificate = await certificateOBJ.sign(CertificateBuffer, p12);
  const certificatePath = `./exports/signed_certificate_${doc.objectId}.pdf`;

  //below is used to save signed certificate in exports folder
  fs.writeFileSync(certificatePath, signedCertificate);
  const file = await uploadFile('certificate.pdf', certificatePath);
  const body = { CertificateUrl: file.imageUrl };
  await axios.put(`${docUrl}/${doc.objectId}`, body, { headers });
  // used in API only
  if (doc.IsSendMail === false) {
    console.log("don't send mail");
  } else {
    await sendFinalCompletionEmail({
      doc: { ...doc, CertificateUrl: file.imageUrl },
      finalPdfBuffer,
      certificatePath,
      publicUrl,
      traceId,
    });
  }
  saveFileUsage(CertificateBuffer.length, file.imageUrl, doc?.CreatedBy?.objectId);
  unlinkFile(certificatePath);
  unlinkFile(pfx.name);
  return file.imageUrl;
}

/**
 * Process a PDF for signing:
 * - updates audit trail, generates certificate.
 * - Optionally inserts a signature placeholder (Placeholder()).
 * - Otherwise (no merge + no placeholder), it flattens forms for finalization.
 *
 * @param {Object} _resDoc - Document details (expects AuditTrail, etc.)
 * @param {Buffer|Uint8Array} pdfBytes - Original PDF bytes
 * @param {string} [options.reason] - Reason text used in placeholder
 * @param {string} [options.UserPtr] -  user pointer (for audit trail)
 * @param {string} [options.ipAddress] - IP (for audit trail)
 * @param {string} [options.Signature] - Signature (for audit trail)
 * @returns {Promise<Buffer>} merged PDF Buffer
 */
async function processPdf(_resDoc, PdfBuffer, reason) {
  // No CC merge; operate directly on the original PDF
  const pdfDoc = await PDFDocument.load(PdfBuffer);
  const form = pdfDoc.getForm();
  // Updates the field appearances to ensure visual changes are reflected.
  form.updateFieldAppearances();
  // Flattens the form, converting all form fields into non-editable, static content
  form.flatten();
  Placeholder({
    pdfDoc: pdfDoc,
    reason: `Digitally signed by ${eSignName} for ${reason}`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await pdfDoc.save();
  return Buffer.from(pdfWithPlaceholderBytes);
}
/**
 *
 * @param docId Id of Document in which user is signing
 * @param pdfFile base64 of pdfFile which you want sign
 * @returns if success {status, data} else {status, message}
 */
async function PDF(req) {
  const docId = req.params.docId;
  const randomNumber = Math.floor(Math.random() * 5000);
  const pfxname = `keystore_${randomNumber}.pfx`;
  let signingOperation = null;
  let documentCommitted = false;
  let signedFilePathToCleanup = '';
  let certificatePathToCleanup = '';
  try {
    const userIP = req.headers['x-real-ip']; // client IPaddress
    const reqUserId = req.params.userId;
    const isCustomMail = req.params.isCustomCompletionMail || false;
    const mailProvider = req.params.mailProvider || '';
    const sign = req.params.signature || '';
    const auditActivity = 'Signed';
    const publicUrl = req.headers.public_url;
    const traceId = req.params.traceId || createTraceId();
    const tokenHash = hashToken(req.params.signingToken || '');
    const signingTokenData = decodeSigningToken(req.params.signingToken || '');
    const externalSigningGrant = req.params.externalSigningGrant || '';
    console.log('FINISH_STARTED', {
      traceId,
      documentId: docId,
      signerId: reqUserId || '',
      signingTokenHash: tokenHash,
      hasExternalGrant: Boolean(externalSigningGrant),
    });
    // below bode is used to get info of docId
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.include(
      'ExtUserPtr,ExtUserPtr.UserId,Signers,Signers.UserId,Signers.parseUser,ExtUserPtr.TenantId,Bcc,Cc,CreatedBy,Placeholders.signerPtr,Placeholders.signerPtr.UserId,Placeholders.signerPtr.parseUser'
    );
    docQuery.equalTo('objectId', docId);
    docQuery.notEqualTo('IsDeclined', true);
    docQuery.notEqualTo('IsArchive', true);
    const resDoc = await docQuery.first({ useMasterKey: true });
    if (!resDoc) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Signature request not found.');
    }
	    const _resDoc = resDoc?.toJSON();
    console.log('DOCUMENT_LOADED', {
      traceId,
      documentId: docId,
      signerId: reqUserId || '',
      isCompleted: Boolean(_resDoc?.IsCompleted),
      signerCount: _resDoc?.Signers?.length || 0,
    });
    let signUser;
    let className;
    let signingContext = null;
    let recipientAuthorization = null;

    // ========== SIGN DOCUMENT ==========
    console.log(`[signPdf] ========== SIGN DOCUMENT ==========`);
    console.log(`[signPdf] Document ID: ${docId}`);
    console.log(`[signPdf] Document Name: ${_resDoc?.Name ?? '(unknown)'}`);
    console.log(`[signPdf] Requested signer ID (reqUserId): ${reqUserId ?? '(none — owner flow)'}`);
    console.log(`[signPdf] Signer count on document: ${_resDoc?.Signers?.length ?? 0}`);

    // `reqUserId` is sent through the pdf-request signing flow (recipient flow)
    if (reqUserId) {
      if (
        req.params.signingToken &&
        (signingTokenData.docId !== docId ||
          (signingTokenData.signerId && signingTokenData.signerId !== reqUserId))
      ) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Signature token is invalid.');
      }
      const _contractUser = findSignerById(_resDoc?.Signers, reqUserId);
      if (!_contractUser) {
        const availableIds = Array.isArray(_resDoc?.Signers)
          ? _resDoc.Signers.map(s => s?.objectId ?? '(null)').join(', ')
          : '(no signers)';
        console.error(`[signPdf] ERROR: Signer record not found for reqUserId=${reqUserId}`);
        console.error(`[signPdf] Available signer IDs: ${availableIds}`);
        throw new Parse.Error(
          Parse.Error.OBJECT_NOT_FOUND,
          'Signer record not found. The signing token may be invalid or the signer has been removed from this document.'
        );
      }

      if (req.params.signingToken) {
        signingContext = await resolveSigningLinkContext({
          token: req.params.signingToken,
          docId,
          signerEmail: signingTokenData.email || '',
          signerId: reqUserId,
          traceId,
          cloudFunction: 'signPdf',
        });
      }

      if (signingContext?.authMode === RECIPIENT_AUTH_MODE_EXTERNAL) {
        recipientAuthorization = await authorizeExternalSigner({
          doc: signingContext.doc,
          signer: signingContext.signer,
          placeholder: signingContext.placeholder,
          signingToken: req.params.signingToken || '',
          externalGrantToken: externalSigningGrant,
          requirePending: true,
          traceId,
          cloudFunction: 'signPdf',
        });
      } else {
        recipientAuthorization = authorizeSigner({
          doc: _resDoc,
          signer: _contractUser,
          requestUser: req.user,
          tokenEmail: signingTokenData.email,
          requirePending: true,
          traceId,
          tokenHash,
          cloudFunction: 'signPdf',
        });
      }

      signUser = recipientAuthorization.signer;
      className =
        recipientAuthorization.placeholder?.signerPtr?.className ||
        signUser.className ||
        'contracts_Contactbook';
      const signerName = getSignerName(signUser) || '(no name)';
      const signerMail = getSignerEmail(signUser) || '(no email)';
      console.log(`[signPdf] Signer resolved: ${signerName} <${signerMail}> [${signUser?.objectId}]`);
      console.log('SIGNER_AUTHORIZED', {
        traceId,
        documentId: docId,
        signerId: signUser.objectId,
        authMode: signingContext?.authMode || 'internal_account',
        identityMatchMethod: recipientAuthorization.identityMatchMethod || '',
      });
    } else {
      // Owner / self-sign flow
      className = 'contracts_Users';
      signUser = _resDoc?.ExtUserPtr;
      if (!signUser) {
        console.error(`[signPdf] ERROR: Document owner (ExtUserPtr) is missing from document ${docId}`);
        throw new Parse.Error(
          Parse.Error.OBJECT_NOT_FOUND,
          'Document owner record is missing. Cannot complete signing.'
        );
      }
      const creatorUserId = pointerId(_resDoc.CreatedBy);
      const ownerUserId = pointerId(signUser?.UserId);
      if (
        AUTHENTICATED_SIGNING_REQUIRED &&
        req?.user?.id !== creatorUserId &&
        req?.user?.id !== ownerUserId
      ) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This request belongs to another recipient.');
      }
      if (isSignerCompleted(_resDoc, signUser.objectId)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'You have already completed this signature.');
      }
      const ownerName = getSignerName(signUser) || '(no name)';
      const ownerMail = getSignerEmail(signUser) || signUser?.Email || '(no email)';
      console.log(`[signPdf] Owner signing flow — ExtUserPtr: ${ownerName} <${ownerMail}>`);
      console.log('SIGNER_AUTHORIZED', {
        traceId,
        documentId: docId,
        signerId: signUser.objectId,
        authMode: 'owner',
        identityMatchMethod: 'owner',
      });
    }
    const username = getSignerName(signUser);
    const userEmail = getSignerEmail(signUser);
    if (req.params.pdfFile) {
      //  `PdfBuffer` used to create buffer from pdf file
      let PdfBuffer = Buffer.from(req.params.pdfFile, 'base64');
      //  `P12Buffer` used to create buffer from p12 certificate
      let pfxFile = process.env.PFX_BASE64;
      let passphrase = process.env.PASS_PHRASE;
      if (_resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64) {
        pfxFile = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64;
        passphrase = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.password;
      }
	      const pfx = { name: pfxname, passphrase: passphrase };
	      const P12Buffer = Buffer.from(pfxFile, 'base64');
	      fs.writeFileSync(pfxname, P12Buffer);
	      const UserPtr = { __type: 'Pointer', className: className, objectId: signUser.objectId };
	      const plannedAuditTrail = buildAuditTrailUpdate(
	        _resDoc,
	        signUser.objectId,
	        userIP,
	        className,
	        sign,
	        '',
	        traceId
	      );
	      const isCompleted = computeDocumentCompleted(_resDoc, plannedAuditTrail);
	      const authMode = signingContext?.authMode || (reqUserId ? 'internal_account' : 'owner');
	      signingOperation = await startSigningOperation({
	        docId,
	        signerId: signUser.objectId,
	        traceId,
	        tokenHash,
	        authMode,
	      });
	      await markDocumentProcessing(resDoc, signingOperation, signUser.objectId);
	      // below regex is used to replace all word with "_" except A to Z, a to z, numbers
	      const docName = _resDoc?.Name?.replace(/[^a-zA-Z0-9._-]/g, '_')?.toLowerCase();
	      const filename = docName?.length > 100 ? docName?.slice(0, 100) : docName;
	      const name = `${filename}_${randomNumber}.pdf`;
	      let filePath = `./exports/${name}`;
	      let signedFilePath = `./exports/signed_${name}`;
	      let pdfSize = PdfBuffer.length;
	      let documentHash;
	      let finalStoredPdfBuffer;
	      console.log('PDF_UPDATE_STARTED', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        operationId: traceId,
	        documentCompleted: Boolean(isCompleted),
	      });
	      try {
	        if (isCompleted) {
	          const signersName = _resDoc.Signers?.map(x => {
	            const name = getSignerName(x) || 'Signer';
	            const email = getSignerEmail(x) || 'no email';
	            return `${name} <${email}>`;
	          });
	          const reason =
	            signersName && signersName.length > 0
	              ? signersName?.join(', ')
	              : username + ' <' + userEmail + '>';
	          const p12Cert = new P12Signer(P12Buffer, { passphrase: passphrase || null });
	          signedFilePath = `./exports/signed_${name}`;
	          signedFilePathToCleanup = signedFilePath;
	          PdfBuffer = await processPdf(_resDoc, PdfBuffer, reason, UserPtr, userIP, sign);
	          const OBJ = new SignPdf();
	          const signedDocs = await OBJ.sign(PdfBuffer, p12Cert);
	          fs.writeFileSync(signedFilePath, signedDocs);
	          finalStoredPdfBuffer = Buffer.from(signedDocs);
	          pdfSize = signedDocs.length;
	          documentHash = generateDocumentHash(signedDocs);
	          console.log(`✅ PDF digitally signed created: ${signedFilePath} \n`);
	        } else {
	          fs.writeFileSync(signedFilePath, PdfBuffer);
	          signedFilePathToCleanup = signedFilePath;
	          finalStoredPdfBuffer = Buffer.from(PdfBuffer);
	          pdfSize = PdfBuffer.length;
	          console.log(`New Signed PDF created called: ${signedFilePath}`);
	        }
	        console.log('PDF_UPDATE_SUCCEEDED', {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          operationId: traceId,
	          size: pdfSize,
	        });
	      } catch (err) {
	        console.log('PDF_UPDATE_FAILED', {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          operationId: traceId,
	          failureReason: err?.message || 'PDF update failed.',
	        });
	        throw err;
	      }

	      let data;
	      try {
	        data = await uploadFile(`signed_${name}`, signedFilePath);
	        if (!data?.imageUrl) {
	          throw new Error('Signed PDF storage did not return a file URL.');
	        }
	        const storedByteLength = await verifyStoredPdfUrl(data.imageUrl, traceId);
	        console.log('PDF_STORAGE_SUCCEEDED', {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          operationId: traceId,
	          storedByteLength,
	        });
	      } catch (err) {
	        console.log('PDF_STORAGE_FAILED', {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          operationId: traceId,
	          failureReason: err?.message || 'PDF storage failed.',
	        });
	        throw err;
	      }

	      const committedAuditTrail = buildAuditTrailUpdate(
	        _resDoc,
	        signUser.objectId,
	        userIP,
	        className,
	        sign,
	        data.imageUrl,
	        traceId
	      );
	      const docForCommit = {
	        ..._resDoc,
	        AuditTrail: committedAuditTrail,
	        SignedUrl: data.imageUrl,
	        IsCompleted: Boolean(isCompleted),
	      };
	      if (documentHash && isCompleted) {
	        docForCommit.DocumentHash = documentHash;
	      }
	      let certificateInfo = null;
	      if (isCompleted) {
	        certificateInfo = await generateUploadCertificate(
	          {
	            ...docForCommit,
	            completedAt: new Date(),
	          },
	          pfx,
	          traceId
	        );
	        certificatePathToCleanup = certificateInfo?.certificatePath || '';
	        if (certificateInfo?.certificateUrl) {
	          docForCommit.CertificateUrl = certificateInfo.certificateUrl;
	        }
	      }

	      const updatedDoc = await updateDoc(
	        req.params.docId,
	        data.imageUrl,
	        signUser.objectId,
	        userIP,
	        _resDoc,
	        className,
	        sign,
	        isCompleted ? documentHash : undefined,
	        auditActivity,
	        {
	          operationId: traceId,
	          certificateUrl: certificateInfo?.certificateUrl || '',
	        }
	      );
	      documentCommitted = true;
	      const committedDoc = {
	        ...docForCommit,
	        AuditTrail: updatedDoc.AuditTrail,
	        SignedUrl: data.imageUrl,
	        IsCompleted: Boolean(updatedDoc.isCompleted),
	        CertificateUrl: updatedDoc.CertificateUrl || docForCommit.CertificateUrl,
	      };
	      console.log('SIGNER_STATUS_COMMITTED', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        operationId: traceId,
	        signerCompleted: true,
	      });
	      console.log('DOCUMENT_STATUS_COMMITTED', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        operationId: traceId,
	        documentCompleted: Boolean(updatedDoc.isCompleted),
	      });
	      console.log('SIGNATURE COMPLETION', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        requesterId: pointerId(_resDoc?.ExtUserPtr),
	        remainingSignerCount: getRemainingSignerCount(
	          { ..._resDoc, AuditTrail: updatedDoc.AuditTrail },
	          signUser.objectId
	        ),
	        documentCompleted: Boolean(updatedDoc.isCompleted),
	        signedPdfUrlHash: hashToken(data.imageUrl),
	      });

	      saveFileUsage(pdfSize, data.imageUrl, _resDoc?.CreatedBy?.objectId);
	      console.log('NOTIFICATION_STARTED', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        notificationType: updatedDoc.isCompleted ? 'final-completion' : 'signer-progress',
	      });
	      let notificationResult = { status: 'skipped' };
	      if (updatedDoc.isCompleted) {
	        if (committedDoc.IsSendMail === false) {
	          console.log("don't send mail");
	          notificationResult = { status: 'skipped', reason: 'document-disabled-mail' };
	        } else {
	          notificationResult = await sendFinalCompletionEmail({
	            doc: committedDoc,
	            finalPdfBuffer: finalStoredPdfBuffer,
	            certificatePath: certificateInfo?.certificatePath || '',
	            publicUrl,
	            traceId,
	          });
	        }
	      } else {
	        notificationResult = await sendNotifyMail(committedDoc, signUser, publicUrl, traceId);
	      }
	      console.log(
	        notificationResult?.status === 'failed' ? 'NOTIFICATION_FAILED' : 'NOTIFICATION_SUCCEEDED',
	        {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          status: notificationResult?.status || '',
	          failureReason: notificationResult?.error || '',
	        }
	      );

	      let downloadAuthorization = null;
	      const isExternalRecipient = signingContext?.authMode === RECIPIENT_AUTH_MODE_EXTERNAL;
	      if (isExternalRecipient) {
	        downloadAuthorization = await createExternalSignedDocumentDownloadAuthorization({
	          doc: committedDoc,
	          signer: signUser,
	          signingToken: req.params.signingToken || '',
	          signedPdfUrl: data.imageUrl,
	          operationId: traceId,
	          documentCompleted: Boolean(updatedDoc.isCompleted),
	          signedAt: updatedDoc.committedAt || new Date(),
	          traceId,
	        });
	        await completeExternalGrant({
	          docObj: signingContext.docObj,
	          signer: signUser,
	          grant: recipientAuthorization?.grant,
	        });
	        console.log('EXTERNAL_GRANT_COMPLETED', {
	          traceId,
	          documentId: docId,
	          signerId: signUser.objectId,
	          operationId: traceId,
	        });
	      }

	      await markSigningOperation(signingOperation, 'completed', {
	        SignedPdfUrl: data.imageUrl,
	        DocumentCompleted: Boolean(updatedDoc.isCompleted),
	        DownloadReferenceIssued: Boolean(downloadAuthorization?.completionReference),
	      });
	      console.log('FINISH_SUCCEEDED', {
	        traceId,
	        documentId: docId,
	        signerId: signUser.objectId,
	        operationId: traceId,
	        documentCompleted: Boolean(updatedDoc.isCompleted),
	        downloadAvailable: Boolean(downloadAuthorization?.downloadAvailable),
	      });

	      unlinkFile(signedFilePath);
	      if (certificateInfo?.certificatePath) {
	        unlinkFile(certificateInfo.certificatePath);
	      }
	      unlinkFile(pfxname);
	      const updatedPdfFile = {
	        fileUrl: isExternalRecipient ? '' : data.imageUrl,
	        fileId: '',
	        filename: `signed_${name}`,
	        version: 1,
	        pageCount: _resDoc?.PageCount || _resDoc?.pageCount || undefined,
	      };
	      return {
	        status: 'success',
	        success: true,
	        data: isExternalRecipient ? '' : data.imageUrl,
	        signerCompleted: true,
	        documentCompleted: Boolean(updatedDoc.isCompleted),
	        completionReference: downloadAuthorization?.completionReference || '',
	        downloadAvailable: Boolean(downloadAuthorization?.downloadAvailable),
	        downloadExpiresAt: downloadAuthorization?.expiresAt?.toISOString?.() || '',
	        documentId: docId,
	        signerId: signUser.objectId,
	        traceId,
	        updatedPdfDetails: isExternalRecipient ? [] : [committedDoc],
	        updatedPdfFile,
	      };
    } else {
      const error = new Error('Pdf file not present!');
      error.code = 400; // Set the error code (e.g., 400 for bad request)
      throw error;
    }
  } catch (err) {
    console.log('Err in signpdf', err);
    const operationId = signingOperation?.get?.('OperationId') || '';
    if (signingOperation) {
      try {
        await markSigningOperation(signingOperation, 'failed', {
          FailureReason: err?.message || 'Signing failed.',
          DocumentCommitted: Boolean(documentCommitted),
        });
      } catch (operationErr) {
        console.log('SIGNING_OPERATION_MARK_FAILED_ERROR', {
          operationId,
          documentId: docId,
          message: operationErr?.message || 'Could not mark signing operation failed.',
        });
      }
    }
    if (!documentCommitted && operationId) {
      await rollbackDocumentProcessing(docId, operationId, err?.message || 'Signing failed.');
    }
    console.log('FINISH_FAILED', {
      traceId: req?.params?.traceId || operationId || '',
      documentId: docId,
      signerId: req?.params?.userId || '',
      operationId,
      documentCommitted: Boolean(documentCommitted),
      failureReason: err?.message || 'Signing failed.',
    });
    const body = { DebugginLog: err?.message };
    try {
      await axios.put(`${docUrl}/${docId}`, body, { headers });
    } catch (err) {
      console.log('err in saving debugginglog', err);
    }
    if (signedFilePathToCleanup) {
      unlinkFile(signedFilePathToCleanup);
    }
    if (certificatePathToCleanup) {
      unlinkFile(certificatePathToCleanup);
    }
    unlinkFile(pfxname);
    throw err;
  }
}
export default PDF;
