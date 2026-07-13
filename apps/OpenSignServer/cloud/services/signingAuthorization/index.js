import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  COMPLETION_ACTIVITIES,
  findPlaceholderIndex,
  findPendingPriorSigner,
  isCompletionRelevant,
} from '../../../utils/workflowUtils.js';
import {
  getSignerEmail,
  getSignerMicrosoftOid,
  getSignerParseUserId,
  isContactOnlyUser,
  normalizeEmail,
  pointerId,
} from '../../utils/recipientIdentity.js';

export const AUTHENTICATED_SIGNING_REQUIRED =
  String(process.env.ALLOW_ANONYMOUS_SIGNING || 'false').toLowerCase() !== 'true';
export const RECIPIENT_AUTH_MODE_INTERNAL = 'internal_account';
export const RECIPIENT_AUTH_MODE_EXTERNAL = 'external_email_otp';
export const EXTERNAL_OTP_CLASS = 'contracts_ExternalSigningOtp';
export const EXTERNAL_GRANT_CLASS = 'contracts_ExternalSigningGrant';

const OTP_EXPIRY_MINUTES = Number(process.env.EXTERNAL_SIGNING_OTP_EXPIRY_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.EXTERNAL_SIGNING_OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_SECONDS = Number(
  process.env.EXTERNAL_SIGNING_OTP_RESEND_COOLDOWN_SECONDS || 60
);
const OTP_MAX_SENDS_PER_HOUR = Number(process.env.EXTERNAL_SIGNING_OTP_MAX_SENDS_PER_HOUR || 5);
const EXTERNAL_GRANT_TTL_MINUTES = Number(process.env.EXTERNAL_SIGNING_GRANT_TTL_MINUTES || 20);

export function createTraceId() {
  return randomUUID();
}

function logSigningAuthorization({
  traceId,
  cloudFunction = '',
  authenticatedUserId = '',
  tokenHash = '',
  documentId = '',
  recipientId = '',
  identityMatchMethod = '',
  authorizationResult = '',
  failureReason = '',
}) {
  console.log('SIGNING AUTHORIZATION', {
    traceId,
    cloudFunction,
    authenticatedUserId,
    tokenHash,
    documentId,
    recipientId,
    identityMatchMethod,
    authorizationResult,
    failureReason,
  });
}

function logExternalSigningEvent(event, payload = {}) {
  console.log(event, payload);
}

export function hashToken(token = '') {
  if (!token) return '';
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

function getSensitiveHashSecret() {
  return (
    process.env.EXTERNAL_SIGNING_HASH_SECRET ||
    process.env.SIGNING_AUTH_HASH_SECRET ||
    process.env.MASTER_KEY ||
    'lhi-signing-secret'
  );
}

export function hashSensitiveValue(value = '') {
  return createHmac('sha256', getSensitiveHashSecret()).update(String(value)).digest('hex');
}

export function createOpaqueGrantToken() {
  return randomBytes(32).toString('base64url');
}

export function maskEmailAddress(value = '') {
  const normalized = normalizeEmail(value);
  if (!normalized || !normalized.includes('@')) return '';
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return '';
  const visible = localPart.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(localPart.length - 1, 1))}@${domain}`;
}

function safeCompareHash(expectedHash = '', actualHash = '') {
  if (!expectedHash || !actualHash) return false;
  const expected = Buffer.from(String(expectedHash), 'hex');
  const actual = Buffer.from(String(actualHash), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function createPrivateAcl() {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  return acl;
}

function normalizeOtpCode(value = '') {
  return String(value).replace(/\D/g, '').slice(0, 6);
}

function buildOtpSecret(normalizedEmail = '', otpCode = '') {
  return `${normalizeEmail(normalizedEmail)}:${normalizeOtpCode(otpCode)}`;
}

function buildQueryOr(conditions = []) {
  const valid = conditions.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  return { $or: valid };
}

export function getUserIdentity(user) {
  if (!user) return {};
  const emails = [
    user.get?.('email'),
    user.get?.('username'),
    user.get?.('Email'),
    user.get?.('mail'),
    user.get?.('UPN'),
    user.get?.('userPrincipalName'),
  ]
    .map(normalizeEmail)
    .filter(Boolean);

  return {
    userId: user.id,
    emails: [...new Set(emails)],
    microsoftOid:
      user.get?.('microsoftObjectId') ||
      user.get?.('microsoftOid') ||
      user.get?.('entraObjectId') ||
      user.get?.('oid') ||
      '',
  };
}

export function matchSignerIdentity(signer, identity = {}) {
  if (!signer || !identity) return { matched: false, method: '' };

  const signerParseUserId = getSignerParseUserId(signer);
  if (signerParseUserId && identity.userId && signerParseUserId === identity.userId) {
    return { matched: true, method: 'parseUserPointer' };
  }

  const signerMicrosoftOid = getSignerMicrosoftOid(signer);
  if (signerMicrosoftOid && identity.microsoftOid && signerMicrosoftOid === identity.microsoftOid) {
    return { matched: true, method: 'entraObjectId' };
  }

  const signerEmails = [
    signer?.Email,
    signer?.email,
    signer?.normalizedEmail,
    signer?.mail,
    signer?.userPrincipalName,
    signer?.UPN,
    signer?.username,
  ]
    .map(normalizeEmail)
    .filter(Boolean);

  const userEmails = Array.isArray(identity.emails) ? identity.emails.map(normalizeEmail).filter(Boolean) : [];
  const emailMatch = signerEmails.find(email => userEmails.includes(email));
  if (emailMatch) {
    return { matched: true, method: 'normalizedEmail' };
  }

  return { matched: false, method: '' };
}

export function findSignerById(signers = [], signerId = '') {
  if (!Array.isArray(signers) || !signerId) return null;
  return signers.find(signer => pointerId(signer) === signerId) || null;
}

export function decodeSigningToken(token = '') {
  try {
    const decoded = Buffer.from(String(token), 'base64').toString('utf8');
    const [docId, email, signerId, sendmail] = decoded.split('/');
    return {
      docId: docId || '',
      signerEmail: email || '',
      signerId: signerId || '',
      sendmail,
    };
  } catch {
    return { docId: '', signerEmail: '', signerId: '', sendmail: undefined };
  }
}

export function findSignerByToken(signers = [], placeholders = [], tokenEmail = '', signerId = '') {
  const byId = findSignerById(signers, signerId);
  if (byId) return byId;

  const email = normalizeEmail(tokenEmail);
  if (!email) return null;

  const bySignerEmail = signers.find(signer => getSignerEmail(signer) === email);
  if (bySignerEmail) return bySignerEmail;

  const placeholder = placeholders.find(item => normalizeEmail(item?.email) === email);
  if (!placeholder?.signerObjId) return null;
  return findSignerById(signers, placeholder.signerObjId);
}

export function findPlaceholderForSigner(placeholders = [], signer) {
  const signerId = pointerId(signer);
  if (!Array.isArray(placeholders) || !signerId) return null;
  return (
    placeholders.find(
      placeholder =>
        placeholder?.Role !== 'prefill' &&
        (placeholder?.signerObjId === signerId || pointerId(placeholder?.signerPtr) === signerId)
    ) || null
  );
}

function getSignerNormalizedEmailFromContext(signer, placeholder) {
  return normalizeEmail(
    placeholder?.recipientNormalizedEmail ||
      placeholder?.email ||
      getSignerEmail(signer) ||
      signer?.normalizedEmail ||
      ''
  );
}

export function isSignerCompleted(doc = {}, signerId = '') {
  if (!signerId) return false;
  return (doc.AuditTrail || []).some(
    entry =>
      COMPLETION_ACTIVITIES.includes(entry?.Activity) &&
      pointerId(entry?.UserPtr) === signerId
  );
}

export function getRemainingSignerCount(doc = {}, completedSignerId = '') {
  const relevant = Array.isArray(doc.Placeholders)
    ? doc.Placeholders.filter(isCompletionRelevant)
    : [];
  const completedIds = new Set(
    (doc.AuditTrail || [])
      .filter(entry => COMPLETION_ACTIVITIES.includes(entry?.Activity))
      .map(entry => pointerId(entry?.UserPtr))
      .filter(Boolean)
  );
  if (completedSignerId) completedIds.add(completedSignerId);
  return Math.max(relevant.length - completedIds.size, 0);
}

export function assertDocumentAvailable(doc = {}) {
  if (!doc?.objectId) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Signature request not found.');
  }
  if (doc.IsArchive || doc.IsCancelled || doc.IsCanceled || doc.IsRevoked) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This signature request has been cancelled.');
  }
  if (doc.IsDeclined) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This signature request has been declined.');
  }
  if (doc.IsCompleted) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This document has already been completed.');
  }
  const expiry = doc.ExpiryDate?.iso ? new Date(doc.ExpiryDate.iso).getTime() : null;
  if (expiry && Date.now() > expiry) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This signature request has expired.');
  }
}

export function assertSigningOrder(doc = {}, signerId = '') {
  if (!signerId || doc.SendinOrder !== true) return;
  const placeholders = Array.isArray(doc.Placeholders)
    ? doc.Placeholders.filter(p => p?.Role !== 'prefill')
    : [];
  const myIdx = findPlaceholderIndex(placeholders, signerId);
  if (myIdx > 0) {
    const pendingId = findPendingPriorSigner(placeholders, myIdx, doc.AuditTrail);
    if (pendingId) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'It is not yet your turn to sign.');
    }
  }
}

async function findInternalUserMatchesByEmail(normalizedEmail = '') {
  if (!normalizedEmail) return [];

  const emailQuery = new Parse.Query(Parse.User);
  emailQuery.equalTo('email', normalizedEmail);
  const usernameQuery = new Parse.Query(Parse.User);
  usernameQuery.equalTo('username', normalizedEmail);
  const normalizedEmailQuery = new Parse.Query(Parse.User);
  normalizedEmailQuery.equalTo('normalizedEmail', normalizedEmail);

  const userResults = await Parse.Query.or(emailQuery, usernameQuery, normalizedEmailQuery).find({
    useMasterKey: true,
  });
  const filteredResults = userResults.filter(user => !isContactOnlyUser(user));
  return [...new Map(filteredResults.map(user => [user.id, user])).values()];
}

async function findContractUserMatchesByEmail(normalizedEmail = '') {
  if (!normalizedEmail) return [];

  const emailQuery = new Parse.Query('contracts_Users');
  emailQuery.equalTo('Email', normalizedEmail);
  const normalizedEmailQuery = new Parse.Query('contracts_Users');
  normalizedEmailQuery.equalTo('normalizedEmail', normalizedEmail);

  const results = await Parse.Query.or(emailQuery, normalizedEmailQuery).find({ useMasterKey: true });
  return results.filter(user => user.get('IsDisabled') !== true);
}

async function findContractUserMatchesByUserId(userId = '') {
  if (!userId) return [];
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  query.notEqualTo('IsDisabled', true);
  return query.find({ useMasterKey: true });
}

async function findDirectoryUserMatchesByEmail(normalizedEmail = '', options = {}) {
  if (!normalizedEmail) return [];
  const requireParseUser = options.requireParseUser !== false;
  const conditions = buildQueryOr([
    { email: normalizedEmail },
    { mail: normalizedEmail },
    { userPrincipalName: normalizedEmail },
  ]);
  if (!conditions) return [];

  if (conditions.$or) {
    const orQueries = conditions.$or.map(condition => {
      const [field, fieldValue] = Object.entries(condition)[0];
      const query = new Parse.Query('DirectoryUser');
      query.equalTo(field, fieldValue);
      query.include('parseUser');
      return query;
    });
    const results = await Parse.Query.or(...orQueries).find({ useMasterKey: true });
    return requireParseUser ? results.filter(user => user.get('parseUser')) : results;
  }

  const directoryQuery = new Parse.Query('DirectoryUser');
  directoryQuery.include('parseUser');
  Object.entries(conditions).forEach(([key, value]) => {
    directoryQuery.equalTo(key, value);
  });
  const directResults = await directoryQuery.find({ useMasterKey: true });
  return requireParseUser ? directResults.filter(user => user.get('parseUser')) : directResults;
}

async function findDirectoryUserMatchesByUserId(userId = '') {
  if (!userId) return [];
  const query = new Parse.Query('DirectoryUser');
  query.include('parseUser');
  query.equalTo('parseUser', { __type: 'Pointer', className: '_User', objectId: userId });
  return query.find({ useMasterKey: true });
}

function getSignerClassName(signer = {}) {
  return signer?.className || signer?.__type?.className || '';
}

function getRawSignerParseUserId(signer = {}) {
  return pointerId(signer?.UserId) || pointerId(signer?.parseUser);
}

function isGuestContactSigner(signer = {}) {
  return (
    getSignerClassName(signer) === 'contracts_Contactbook' &&
    (signer?.UserRole === 'contracts_Guest' || signer?.Role === 'contracts_Guest')
  );
}

async function hasCanonicalInternalIdentity({ signer, normalizedEmail = '' }) {
  if (!signer) return false;

  if (getSignerClassName(signer) === 'DirectoryUser') {
    return true;
  }

  const linkedUserId = getRawSignerParseUserId(signer);
  if (linkedUserId) {
    const [contractUsers, directoryUsers] = await Promise.all([
      findContractUserMatchesByUserId(linkedUserId),
      findDirectoryUserMatchesByUserId(linkedUserId),
    ]);
    if (contractUsers.length > 0 || directoryUsers.length > 0) {
      return true;
    }
  }

  const [contractUsersByEmail, directoryUsersByEmail] = await Promise.all([
    findContractUserMatchesByEmail(normalizedEmail),
    findDirectoryUserMatchesByEmail(normalizedEmail, { requireParseUser: false }),
  ]);

  return contractUsersByEmail.length > 0 || directoryUsersByEmail.length > 0;
}

export async function classifyRecipientAuthMode({ signer, placeholder }) {
  const normalizedEmail = getSignerNormalizedEmailFromContext(signer, placeholder);
  if (!normalizedEmail) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const canonicalInternalIdentity = await hasCanonicalInternalIdentity({ signer, normalizedEmail });
  const inferredAuthMode = canonicalInternalIdentity
    ? RECIPIENT_AUTH_MODE_INTERNAL
    : RECIPIENT_AUTH_MODE_EXTERNAL;

  if (
    placeholder?.recipientAuthMode === RECIPIENT_AUTH_MODE_INTERNAL ||
    placeholder?.recipientAuthMode === RECIPIENT_AUTH_MODE_EXTERNAL
  ) {
    if (placeholder.recipientAuthMode !== inferredAuthMode) {
      logExternalSigningEvent('RECIPIENT AUTH MODE CORRECTED', {
        signerId: pointerId(signer),
        previousAuthMode: placeholder.recipientAuthMode,
        correctedAuthMode: inferredAuthMode,
        normalizedEmail,
        signerClassName: getSignerClassName(signer),
        signerUserRole: signer?.UserRole || '',
        hasCanonicalInternalIdentity: canonicalInternalIdentity,
      });
    }
    return {
      authMode: inferredAuthMode,
      normalizedEmail,
      matchType:
        placeholder.recipientAuthMode === inferredAuthMode
          ? 'placeholder-explicit'
          : 'placeholder-corrected-by-canonical-identity',
    };
  }

  const linkedUser = signer?.UserId || signer?.parseUser;
  if (isContactOnlyUser(linkedUser) || (isGuestContactSigner(signer) && !canonicalInternalIdentity)) {
    return {
      authMode: RECIPIENT_AUTH_MODE_EXTERNAL,
      normalizedEmail,
      matchType: 'contact-only-user',
    };
  }

  if (canonicalInternalIdentity || getSignerParseUserId(signer)) {
    return {
      authMode: canonicalInternalIdentity ? RECIPIENT_AUTH_MODE_INTERNAL : RECIPIENT_AUTH_MODE_EXTERNAL,
      normalizedEmail,
      matchType: canonicalInternalIdentity ? 'canonical-internal-identity' : 'user-pointer-without-profile',
    };
  }

  const directoryUsers = await findDirectoryUserMatchesByEmail(normalizedEmail);
  const contractUsers = await findContractUserMatchesByEmail(normalizedEmail);
  const internalUsers = await findInternalUserMatchesByEmail(normalizedEmail);
  const canonicalUserIds = new Set([
    ...contractUsers.map(user => pointerId(user.get('UserId'))).filter(Boolean),
    ...directoryUsers.map(user => user.get('parseUser')?.id).filter(Boolean),
  ]);
  const uniqueInternalUserIds = new Set([
    ...internalUsers.map(user => user.id).filter(userId => canonicalUserIds.has(userId)),
    ...directoryUsers.map(user => user.get('parseUser')?.id).filter(Boolean),
    ...contractUsers.map(user => pointerId(user.get('UserId'))).filter(Boolean),
  ]);

  if (uniqueInternalUserIds.size === 1) {
    return {
      authMode: RECIPIENT_AUTH_MODE_INTERNAL,
      normalizedEmail,
      matchType: directoryUsers.length > 0 ? 'directory-email' : 'parse-email',
      internalUserId: [...uniqueInternalUserIds][0],
    };
  }

  if (uniqueInternalUserIds.size > 1) {
    logExternalSigningEvent('RECIPIENT AUTH CLASSIFICATION', {
      normalizedEmail,
      signerId: pointerId(signer),
      result: 'ambiguous_internal_identity',
    });
  }

  return {
    authMode: RECIPIENT_AUTH_MODE_EXTERNAL,
    normalizedEmail,
    matchType: uniqueInternalUserIds.size > 1 ? 'ambiguous-email-fallback' : 'external-email',
  };
}

export async function syncRecipientAuthMetadata(docObj, signer, placeholder) {
  if (!docObj || !signer || !placeholder) return null;

  const classification = await classifyRecipientAuthMode({ signer, placeholder });
  const placeholders = Array.isArray(docObj.get('Placeholders')) ? [...docObj.get('Placeholders')] : [];
  const signerId = pointerId(signer);
  const placeholderIndex = placeholders.findIndex(
    item =>
      item?.Role !== 'prefill' &&
      (item?.signerObjId === signerId || pointerId(item?.signerPtr) === signerId)
  );

  if (placeholderIndex === -1) {
    return classification;
  }

  const current = placeholders[placeholderIndex] || {};
  const next = {
    ...current,
    email: current?.email || getSignerEmail(signer) || classification.normalizedEmail,
    recipientNormalizedEmail: classification.normalizedEmail,
    recipientAuthMode: classification.authMode,
  };

  if (
    current?.recipientNormalizedEmail !== next.recipientNormalizedEmail ||
    current?.recipientAuthMode !== next.recipientAuthMode ||
    current?.email !== next.email
  ) {
    placeholders[placeholderIndex] = next;
    docObj.set('Placeholders', placeholders);
    await docObj.save(null, { useMasterKey: true });
  }

  return classification;
}

export function buildSigningDocumentQuery() {
  const query = new Parse.Query('contracts_Document');
  query.include(
    'ExtUserPtr,ExtUserPtr.UserId,ExtUserPtr.TenantId,Signers,Signers.UserId,Signers.parseUser,CreatedBy,Placeholders.signerPtr,Placeholders.signerPtr.UserId,Placeholders.signerPtr.parseUser,AuditTrail.UserPtr'
  );
  query.notEqualTo('IsArchive', true);
  return query;
}

export async function resolveSigningLinkContext({
  token = '',
  docId = '',
  signerEmail = '',
  signerId = '',
  traceId = createTraceId(),
  cloudFunction = '',
}) {
  if (!token) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Signature token is required.');
  }

  const decoded = decodeSigningToken(token);
  const resolvedDocId = docId || decoded.docId;
  const resolvedSignerEmail = signerEmail || decoded.signerEmail;
  const resolvedSignerId = signerId || decoded.signerId;
  const tokenHash = hashToken(token);

  if (!resolvedDocId || decoded.docId !== resolvedDocId) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Signature token is invalid.');
  }

  const query = buildSigningDocumentQuery();
  query.equalTo('objectId', resolvedDocId);
  const docObj = await query.first({ useMasterKey: true });
  if (!docObj) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Signature request not found.');
  }

  const doc = docObj.toJSON();
  assertDocumentAvailable(doc);

  const signer = findSignerByToken(
    doc.Signers || [],
    doc.Placeholders || [],
    resolvedSignerEmail,
    resolvedSignerId
  );
  if (!signer) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const placeholder = findPlaceholderForSigner(doc.Placeholders || [], signer);
  if (!placeholder) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const classification = await syncRecipientAuthMetadata(docObj, signer, placeholder);
  const refreshedDoc = docObj.toJSON();
  const refreshedSigner = findSignerByToken(
    refreshedDoc.Signers || [],
    refreshedDoc.Placeholders || [],
    resolvedSignerEmail,
    resolvedSignerId
  );
  const refreshedPlaceholder = findPlaceholderForSigner(refreshedDoc.Placeholders || [], refreshedSigner);

  return {
    traceId,
    cloudFunction,
    tokenHash,
    decoded,
    docObj,
    doc: refreshedDoc,
    signer: refreshedSigner,
    placeholder: refreshedPlaceholder,
    signerId: pointerId(refreshedSigner),
    normalizedEmail: classification.normalizedEmail,
    authMode:
      refreshedPlaceholder?.recipientAuthMode ||
      classification.authMode ||
      RECIPIENT_AUTH_MODE_EXTERNAL,
  };
}

function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

function getGrantExpiryDate() {
  return new Date(Date.now() + EXTERNAL_GRANT_TTL_MINUTES * 60 * 1000);
}

function getRequestIp(request = {}) {
  return (
    request?.headers?.['x-real-ip'] ||
    request?.headers?.['x-forwarded-for'] ||
    request?.ip ||
    ''
  );
}

function buildOtpQueryBase(context) {
  const query = new Parse.Query(EXTERNAL_OTP_CLASS);
  query.equalTo('DocumentId', context.doc.objectId);
  query.equalTo('SignerId', context.signerId);
  query.equalTo('NormalizedEmail', context.normalizedEmail);
  query.equalTo('SigningTokenHash', buildSigningTokenBinding(context));
  return query;
}

function buildGrantQueryBase(context) {
  const query = new Parse.Query(EXTERNAL_GRANT_CLASS);
  query.equalTo('DocumentId', context.doc.objectId);
  query.equalTo('SignerId', context.signerId);
  query.equalTo('NormalizedEmail', context.normalizedEmail);
  query.equalTo('SigningTokenHash', buildSigningTokenBinding(context));
  return query;
}

async function revokeActiveOtpRecords(context, revokedAt = new Date()) {
  const query = buildOtpQueryBase(context);
  query.doesNotExist('UsedAt');
  query.doesNotExist('RevokedAt');
  const records = await query.find({ useMasterKey: true });
  for (const record of records) {
    record.set('RevokedAt', revokedAt);
  }
  if (records.length > 0) {
    await Parse.Object.saveAll(records, { useMasterKey: true });
  }
}

export async function revokeExternalSigningOtpRecords(context, revokedAt = new Date()) {
  await revokeActiveOtpRecords(context, revokedAt);
}

async function revokeActiveGrantRecords(context, revokedAt = new Date(), completedAt = null) {
  const query = buildGrantQueryBase(context);
  query.doesNotExist('RevokedAt');
  query.doesNotExist('CompletedAt');
  const grants = await query.find({ useMasterKey: true });
  for (const grant of grants) {
    grant.set('RevokedAt', revokedAt);
    if (completedAt) {
      grant.set('CompletedAt', completedAt);
    }
  }
  if (grants.length > 0) {
    await Parse.Object.saveAll(grants, { useMasterKey: true });
  }
}

function buildSigningTokenBinding(context) {
  return hashSensitiveValue(
    `${context.doc.objectId}:${context.signerId}:${context.normalizedEmail}:${context.tokenHash}`
  );
}

export async function appendExternalSigningAudit(docObj, signer, activity, meta = {}) {
  if (!docObj || !signer || !activity) return;
  const auditTrail = Array.isArray(docObj.get('AuditTrail')) ? [...docObj.get('AuditTrail')] : [];
  auditTrail.push({
    UserPtr: {
      __type: 'Pointer',
      className: signer.className,
      objectId: signer.objectId,
    },
    Activity: activity,
    ipAddress: meta.ipAddress || '',
    verificationMethod: 'email_otp',
    traceId: meta.traceId || '',
    recipientMaskedEmail: meta.recipientMaskedEmail || '',
    result: meta.result || '',
    createdAt: new Date().toISOString(),
  });
  docObj.set('AuditTrail', auditTrail);
  await docObj.save(null, { useMasterKey: true });
}

function updatePlaceholderAuthFields(docObj, signerId, updates = {}) {
  const placeholders = Array.isArray(docObj.get('Placeholders')) ? [...docObj.get('Placeholders')] : [];
  const index = placeholders.findIndex(
    item =>
      item?.Role !== 'prefill' &&
      (item?.signerObjId === signerId || pointerId(item?.signerPtr) === signerId)
  );
  if (index === -1) return false;
  placeholders[index] = {
    ...placeholders[index],
    ...updates,
  };
  docObj.set('Placeholders', placeholders);
  return true;
}

export async function issueExternalSigningOtp(context, request = {}) {
  if (context.authMode !== RECIPIENT_AUTH_MODE_EXTERNAL) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This signature request requires account sign-in.'
    );
  }

  if (isSignerCompleted(context.doc, context.signerId)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This document has already been signed.');
  }

  assertSigningOrder(context.doc, context.signerId);

  const now = Date.now();
  const ipHash = hashSensitiveValue(getRequestIp(request) || '');
  const signingTokenBinding = buildSigningTokenBinding(context);

  const recentSendQuery = new Parse.Query(EXTERNAL_OTP_CLASS);
  recentSendQuery.equalTo('DocumentId', context.doc.objectId);
  recentSendQuery.equalTo('SignerId', context.signerId);
  recentSendQuery.greaterThanOrEqualTo('LastSentAt', new Date(now - 60 * 60 * 1000));
  const recentSendCount = await recentSendQuery.count({ useMasterKey: true });
  if (recentSendCount >= OTP_MAX_SENDS_PER_HOUR) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Please wait before requesting another code.'
    );
  }

  const activeOtpQuery = buildOtpQueryBase(context);
  activeOtpQuery.doesNotExist('UsedAt');
  activeOtpQuery.doesNotExist('RevokedAt');
  activeOtpQuery.descending('createdAt');
  const activeOtp = await activeOtpQuery.first({ useMasterKey: true });
  if (activeOtp) {
    const lastSentAt = activeOtp.get('LastSentAt')?.getTime?.() || 0;
    if (lastSentAt && now - lastSentAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Please wait before requesting another code.'
      );
    }
  }

  await revokeActiveOtpRecords(context, new Date(now));

  const otpCode = String(randomInt(100000, 1000000));
  const otpObject = new Parse.Object(EXTERNAL_OTP_CLASS);
  otpObject.set('DocumentId', context.doc.objectId);
  otpObject.set('SignerId', context.signerId);
  otpObject.set('SignerClassName', context.signer.className || '');
  otpObject.set('NormalizedEmail', context.normalizedEmail);
  otpObject.set('SigningTokenHash', signingTokenBinding);
  otpObject.set('OtpHash', hashSensitiveValue(buildOtpSecret(context.normalizedEmail, otpCode)));
  otpObject.set('OtpExpiresAt', getOtpExpiryDate());
  otpObject.set('AttemptCount', 0);
  otpObject.set('MaxAttempts', OTP_MAX_ATTEMPTS);
  otpObject.set('LastSentAt', new Date(now));
  otpObject.set('RequestIpHash', ipHash);
  otpObject.setACL(createPrivateAcl());
  await otpObject.save(null, { useMasterKey: true });

  logExternalSigningEvent('EXTERNAL OTP GENERATED', {
    signingTraceId: context.traceId,
    traceId: context.traceId,
    documentId: context.doc.objectId,
    signerId: context.signerId,
    recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
    cloudFunction: 'requestExternalSigningOtp',
    authMode: context.authMode,
    rateLimitResult: 'accepted',
    result: 'generated',
  });

  await appendExternalSigningAudit(context.docObj, context.signer, 'External OTP requested', {
    traceId: context.traceId,
    recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
    result: 'sent',
    ipAddress: getRequestIp(request),
  });

	  return {
	    otpCode,
	    otpObjectId: otpObject.id,
	    expiresAt: otpObject.get('OtpExpiresAt'),
	    maskedEmail: maskEmailAddress(context.normalizedEmail),
	    traceId: context.traceId,
	  };
	}

export async function verifyExternalSigningOtpCode(context, otpCode = '', request = {}) {
  if (context.authMode !== RECIPIENT_AUTH_MODE_EXTERNAL) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This signature request requires account sign-in.'
    );
  }

  if (isSignerCompleted(context.doc, context.signerId)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This document has already been signed.');
  }

  assertSigningOrder(context.doc, context.signerId);

  const query = buildOtpQueryBase(context);
  query.doesNotExist('UsedAt');
  query.doesNotExist('RevokedAt');
  query.descending('createdAt');
  const otpRecord = await query.first({ useMasterKey: true });
  if (!otpRecord) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'This authorization session has expired. Verify your email again.'
    );
  }

  const now = new Date();
  const attemptCount = Number(otpRecord.get('AttemptCount') || 0);
  if (attemptCount >= OTP_MAX_ATTEMPTS) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Too many incorrect attempts. Request a new code.'
    );
  }

  const expiresAt = otpRecord.get('OtpExpiresAt');
  if (!expiresAt || expiresAt.getTime() < now.getTime()) {
    otpRecord.set('RevokedAt', now);
    await otpRecord.save(null, { useMasterKey: true });
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This verification code has expired.');
  }

  const submittedOtp = normalizeOtpCode(otpCode);
  const submittedHash = hashSensitiveValue(buildOtpSecret(context.normalizedEmail, submittedOtp));
  const storedHash = otpRecord.get('OtpHash') || '';

  if (!safeCompareHash(storedHash, submittedHash)) {
    otpRecord.set('AttemptCount', attemptCount + 1);
    await otpRecord.save(null, { useMasterKey: true });

    logExternalSigningEvent('EXTERNAL OTP VERIFICATION FAILED', {
      traceId: context.traceId,
      documentId: context.doc.objectId,
      signerId: context.signerId,
      recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
      cloudFunction: 'verifyExternalSigningOtp',
      result: 'invalid_code',
    });

    await appendExternalSigningAudit(context.docObj, context.signer, 'External OTP verification failed', {
      traceId: context.traceId,
      recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
      result: 'invalid_code',
      ipAddress: getRequestIp(request),
    });

    if (attemptCount + 1 >= OTP_MAX_ATTEMPTS) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Too many incorrect attempts. Request a new code.'
      );
    }

    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This verification code is incorrect.');
  }

  otpRecord.set('AttemptCount', attemptCount + 1);
  otpRecord.set('UsedAt', now);
  await otpRecord.save(null, { useMasterKey: true });

  await revokeActiveGrantRecords(context, now);

  const grantToken = createOpaqueGrantToken();
  const grantRecord = new Parse.Object(EXTERNAL_GRANT_CLASS);
  grantRecord.set('DocumentId', context.doc.objectId);
  grantRecord.set('SignerId', context.signerId);
  grantRecord.set('SignerClassName', context.signer.className || '');
  grantRecord.set('NormalizedEmail', context.normalizedEmail);
  grantRecord.set('SigningTokenHash', buildSigningTokenBinding(context));
  grantRecord.set('GrantHash', hashSensitiveValue(grantToken));
  grantRecord.set('AuthorizationMethod', 'email_otp');
  grantRecord.set('IssuedAt', now);
  grantRecord.set('ExpiresAt', getGrantExpiryDate());
  grantRecord.set('RequestIpHash', hashSensitiveValue(getRequestIp(request) || ''));
  grantRecord.setACL(createPrivateAcl());
  await grantRecord.save(null, { useMasterKey: true });

  if (updatePlaceholderAuthFields(context.docObj, context.signerId, { otpVerifiedAt: now })) {
    await context.docObj.save(null, { useMasterKey: true });
  }

  logExternalSigningEvent('EXTERNAL OTP VERIFICATION SUCCEEDED', {
    traceId: context.traceId,
    documentId: context.doc.objectId,
    signerId: context.signerId,
    recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
    cloudFunction: 'verifyExternalSigningOtp',
    result: 'authorized',
  });

  await appendExternalSigningAudit(context.docObj, context.signer, 'External OTP verification succeeded', {
    traceId: context.traceId,
    recipientMaskedEmail: maskEmailAddress(context.normalizedEmail),
    result: 'authorized',
    ipAddress: getRequestIp(request),
  });

  return {
    grantToken,
    expiresAt: grantRecord.get('ExpiresAt'),
    maskedEmail: maskEmailAddress(context.normalizedEmail),
    traceId: context.traceId,
  };
}

export async function authorizeExternalSigner({
  doc,
  signer,
  placeholder,
  signingToken = '',
  externalGrantToken = '',
  requirePending = true,
  traceId = createTraceId(),
  cloudFunction = '',
}) {
  assertDocumentAvailable(doc);

  if (!signer || !placeholder) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const normalizedEmail = getSignerNormalizedEmailFromContext(signer, placeholder);
  const context = {
    doc,
    signer,
    placeholder,
    signerId: pointerId(signer),
    normalizedEmail,
    tokenHash: hashToken(signingToken),
    decoded: decodeSigningToken(signingToken),
  };

  if (placeholder?.recipientAuthMode && placeholder.recipientAuthMode !== RECIPIENT_AUTH_MODE_EXTERNAL) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This signature request requires account sign-in.'
    );
  }

  if (!externalGrantToken) {
    logExternalSigningEvent('EXTERNAL SIGNING AUTHORIZATION REJECTED', {
      traceId,
      documentId: doc.objectId,
      signerId: context.signerId,
      cloudFunction,
      result: 'missing_grant',
    });
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This authorization session has expired. Verify your email again.'
    );
  }

  const query = new Parse.Query(EXTERNAL_GRANT_CLASS);
  query.equalTo('DocumentId', doc.objectId);
  query.equalTo('SignerId', context.signerId);
  query.equalTo('NormalizedEmail', normalizedEmail);
  query.equalTo('SigningTokenHash', buildSigningTokenBinding(context));
  query.doesNotExist('RevokedAt');
  query.doesNotExist('CompletedAt');
  query.descending('createdAt');
  const grants = await query.find({ useMasterKey: true });
  const matchingGrant = grants.find(grant =>
    safeCompareHash(grant.get('GrantHash') || '', hashSensitiveValue(externalGrantToken))
  );

  if (!matchingGrant) {
    logExternalSigningEvent('EXTERNAL SIGNING AUTHORIZATION REJECTED', {
      traceId,
      documentId: doc.objectId,
      signerId: context.signerId,
      cloudFunction,
      result: 'grant_mismatch',
    });
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This authorization session has expired. Verify your email again.'
    );
  }

  const expiresAt = matchingGrant.get('ExpiresAt');
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    matchingGrant.set('RevokedAt', new Date());
    await matchingGrant.save(null, { useMasterKey: true });
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This authorization session has expired. Verify your email again.'
    );
  }

  if (requirePending && isSignerCompleted(doc, context.signerId)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'You have already completed this signature.');
  }

  assertSigningOrder(doc, context.signerId);

  logExternalSigningEvent('EXTERNAL SIGNING AUTHORIZATION ISSUED', {
    traceId,
    documentId: doc.objectId,
    signerId: context.signerId,
    cloudFunction,
    result: 'authorized',
  });

  return {
    signer,
    signerId: context.signerId,
    placeholder,
    grant: matchingGrant,
    identityMatchMethod: 'email_otp',
    traceId,
  };
}

export async function completeExternalGrant({
  docObj,
  signer,
  grant,
}) {
  const completedAt = new Date();
  if (grant) {
    grant.set('CompletedAt', completedAt);
    grant.set('RevokedAt', completedAt);
    await grant.save(null, { useMasterKey: true });
  }

  if (docObj && signer && updatePlaceholderAuthFields(docObj, pointerId(signer), { externalSigningCompletedAt: completedAt })) {
    await docObj.save(null, { useMasterKey: true });
  }
}

export function authorizeSigner({
  doc,
  signer,
  requestUser,
  tokenEmail = '',
  requirePending = true,
  traceId = createTraceId(),
  tokenHash = '',
  cloudFunction = '',
}) {
  if (AUTHENTICATED_SIGNING_REQUIRED && !requestUser) {
    logSigningAuthorization({
      traceId,
      cloudFunction,
      authenticatedUserId: requestUser?.id || '',
      tokenHash,
      documentId: doc?.objectId || '',
      recipientId: pointerId(signer),
      identityMatchMethod: '',
      authorizationResult: 'denied',
      failureReason: 'authentication-required',
    });
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required.');
  }

  assertDocumentAvailable(doc);

  if (!signer) {
    logSigningAuthorization({
      traceId,
      cloudFunction,
      authenticatedUserId: requestUser?.id || '',
      tokenHash,
      documentId: doc?.objectId || '',
      recipientId: '',
      identityMatchMethod: '',
      authorizationResult: 'denied',
      failureReason: 'recipient-not-found',
    });
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const placeholder = findPlaceholderForSigner(doc.Placeholders || [], signer);
  if (!placeholder) {
    logSigningAuthorization({
      traceId,
      cloudFunction,
      authenticatedUserId: requestUser?.id || '',
      tokenHash,
      documentId: doc?.objectId || '',
      recipientId: pointerId(signer),
      identityMatchMethod: '',
      authorizationResult: 'denied',
      failureReason: 'placeholder-not-found',
    });
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Recipient record not found.');
  }

  const identity = getUserIdentity(requestUser);
  const identityMatch = matchSignerIdentity(signer, identity);
  const tokenEmailMatch = tokenEmail
    ? getSignerEmail(signer) === normalizeEmail(tokenEmail) ||
      normalizeEmail(placeholder?.email) === normalizeEmail(tokenEmail)
    : true;

  if (!identityMatch.matched || !tokenEmailMatch) {
    logSigningAuthorization({
      traceId,
      cloudFunction,
      authenticatedUserId: requestUser?.id || '',
      tokenHash,
      documentId: doc.objectId,
      recipientId: pointerId(signer),
      identityMatchMethod: identityMatch.method || 'none',
      authorizationResult: 'denied',
      failureReason: !identityMatch.matched ? 'identity-mismatch' : 'token-email-mismatch',
    });
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This signature request was sent to a different account.'
    );
  }

  if (requirePending && isSignerCompleted(doc, pointerId(signer))) {
    logSigningAuthorization({
      traceId,
      cloudFunction,
      authenticatedUserId: requestUser?.id || '',
      tokenHash,
      documentId: doc.objectId,
      recipientId: pointerId(signer),
      identityMatchMethod: identityMatch.method,
      authorizationResult: 'denied',
      failureReason: 'already-signed',
    });
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'You have already completed this signature.');
  }

  assertSigningOrder(doc, pointerId(signer));

  logSigningAuthorization({
    traceId,
    cloudFunction,
    authenticatedUserId: requestUser?.id || '',
    tokenHash,
    documentId: doc.objectId,
    recipientId: pointerId(signer),
    identityMatchMethod: identityMatch.method,
    authorizationResult: 'authorized',
    failureReason: '',
  });

  return {
    signer,
    signerId: pointerId(signer),
    placeholder,
    identityMatchMethod: identityMatch.method,
    traceId,
  };
}
