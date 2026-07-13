import { randomBytes } from 'node:crypto';
import getPresignedUrl from '../parsefunction/getSignedUrl.js';
import {
  createTraceId,
  hashSensitiveValue,
  maskEmailAddress,
} from './signingAuthorization/index.js';
import {
  getSignerEmail,
  getSignerName,
  normalizeEmail,
  pointerId,
} from '../utils/recipientIdentity.js';

export const EXTERNAL_SIGNED_DOWNLOAD_CLASS = 'contracts_ExternalSignedDocumentDownload';

const DOWNLOAD_TTL_MINUTES = Number(
  process.env.EXTERNAL_SIGNED_DOWNLOAD_TTL_MINUTES || 60
);
const DOWNLOAD_MAX_USES = Number(process.env.EXTERNAL_SIGNED_DOWNLOAD_MAX_USES || 5);

function createPrivateAcl() {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  return acl;
}

function createDownloadToken() {
  return randomBytes(32).toString('base64url');
}

function getExpiryDate() {
  return new Date(Date.now() + DOWNLOAD_TTL_MINUTES * 60 * 1000);
}

export function stripSignedFileCredential(url = '') {
  return String(url || '').split('?')[0];
}

export function buildExternalDownloadFilename(documentTitle = '', completed = false) {
  const fallback = completed ? 'Fully-Signed-Document' : 'Signed-Copy';
  const safeTitle = String(documentTitle || fallback)
    .replace(/[^a-zA-Z0-9._ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${safeTitle || fallback}${completed ? ' - Fully Signed' : ' - Signed Copy'}.pdf`;
}

export async function createExternalSignedDocumentDownloadAuthorization({
  doc = {},
  signer = {},
  signingToken = '',
  signedPdfUrl = '',
  operationId = '',
  documentCompleted = false,
  signedAt = new Date(),
  traceId = createTraceId(),
}) {
  if (!doc?.objectId || !pointerId(signer) || !signedPdfUrl) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Signed document download could not be created.'
    );
  }

  const normalizedEmail = normalizeEmail(getSignerEmail(signer));
  const downloadToken = createDownloadToken();
  const expiresAt = getExpiryDate();
  const fileUrl = stripSignedFileCredential(signedPdfUrl);
  const record = new Parse.Object(EXTERNAL_SIGNED_DOWNLOAD_CLASS);

  record.set('DownloadTokenHash', hashSensitiveValue(downloadToken));
  record.set('DocumentId', doc.objectId);
  record.set('SignerId', pointerId(signer));
  record.set('SignerClassName', signer.className || 'contracts_Contactbook');
  record.set('NormalizedEmail', normalizedEmail);
  record.set('SigningTokenHash', signingToken ? hashSensitiveValue(signingToken) : '');
  record.set('SignedPdfUrl', fileUrl);
  record.set('DocumentTitle', doc?.Name || 'Document');
  record.set('DocumentCompleted', Boolean(documentCompleted));
  record.set('OperationId', operationId || traceId);
  record.set('IssuedAt', new Date());
  record.set('ExpiresAt', expiresAt);
  record.set('MaxDownloads', DOWNLOAD_MAX_USES);
  record.set('DownloadCount', 0);
  record.set('SignedAt', signedAt);
  record.set('SignerDisplayName', getSignerName(signer) || '');
  record.set('MaskedEmail', maskEmailAddress(normalizedEmail));
  record.setACL(createPrivateAcl());
  await record.save(null, { useMasterKey: true });

  console.log('DOWNLOAD_AUTHORIZATION_CREATED', {
    traceId,
    documentId: doc.objectId,
    signerId: pointerId(signer),
    operationId: operationId || traceId,
    documentCompleted: Boolean(documentCompleted),
    expiresAt: expiresAt.toISOString(),
  });

  return {
    completionReference: downloadToken,
    expiresAt,
    downloadAvailable: true,
  };
}

async function findDownloadRecord(completionReference = '') {
  const tokenHash = hashSensitiveValue(completionReference || '');
  const query = new Parse.Query(EXTERNAL_SIGNED_DOWNLOAD_CLASS);
  query.equalTo('DownloadTokenHash', tokenHash);
  query.doesNotExist('RevokedAt');
  query.descending('createdAt');
  return query.first({ useMasterKey: true });
}

function assertDownloadRecordUsable(record) {
  if (!record) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'This download link is invalid or no longer available.'
    );
  }

  const expiresAt = record.get('ExpiresAt');
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This download link has expired.');
  }

  const count = Number(record.get('DownloadCount') || 0);
  const max = Number(record.get('MaxDownloads') || DOWNLOAD_MAX_USES);
  if (max > 0 && count >= max) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This download link has already been used.'
    );
  }

  if (!record.get('SignedPdfUrl')) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'The signed document is not available for download.'
    );
  }
}

export async function getExternalSigningCompletionMetadata(completionReference = '') {
  const record = await findDownloadRecord(completionReference);
  assertDownloadRecordUsable(record);
  const documentCompleted = Boolean(record.get('DocumentCompleted'));

  return {
    success: true,
    documentId: record.get('DocumentId'),
    signerId: record.get('SignerId'),
    documentTitle: record.get('DocumentTitle') || 'Document',
    signedAt: record.get('SignedAt')?.toISOString?.() || '',
    signerDisplayName: record.get('SignerDisplayName') || '',
    maskedEmail: record.get('MaskedEmail') || maskEmailAddress(record.get('NormalizedEmail')),
    documentCompleted,
    copyLabel: documentCompleted ? 'Fully signed PDF' : 'Signed copy',
    expiresAt: record.get('ExpiresAt')?.toISOString?.() || '',
    remainingDownloads: Math.max(
      Number(record.get('MaxDownloads') || DOWNLOAD_MAX_USES) -
        Number(record.get('DownloadCount') || 0),
      0
    ),
  };
}

export async function getExternalSignedDocumentDownloadUrl(completionReference = '', traceId = createTraceId()) {
  const record = await findDownloadRecord(completionReference);
  assertDownloadRecordUsable(record);

  const fileUrl = stripSignedFileCredential(record.get('SignedPdfUrl'));
  const signedUrl = await getPresignedUrl(fileUrl);
  record.increment('DownloadCount', 1);
  record.set('LastDownloadedAt', new Date());
  await record.save(null, { useMasterKey: true });

  console.log('EXTERNAL_SIGNED_DOCUMENT_DOWNLOAD', {
    traceId,
    documentId: record.get('DocumentId'),
    signerId: record.get('SignerId'),
    operationId: record.get('OperationId') || '',
    downloadCount: record.get('DownloadCount'),
    status: 'authorized',
  });

  return {
    success: true,
    downloadUrl: signedUrl,
    filename: buildExternalDownloadFilename(
      record.get('DocumentTitle'),
      record.get('DocumentCompleted')
    ),
    expiresAt: record.get('ExpiresAt')?.toISOString?.() || '',
  };
}
