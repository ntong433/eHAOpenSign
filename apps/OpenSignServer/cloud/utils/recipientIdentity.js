export const normalizeEmail = value =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const pointerId = value => value?.objectId || value?.id || '';

export const isContactOnlyUser = value =>
  Boolean(value?.IsContactOnlyUser || value?.get?.('IsContactOnlyUser'));

export const getSignerEmail = signer =>
  normalizeEmail(
    signer?.Email ||
      signer?.email ||
      signer?.mail ||
      signer?.userPrincipalName ||
      signer?.UPN ||
      signer?.username ||
      ''
  );

export const getSignerName = signer =>
  signer?.Name || signer?.displayName || signer?.name || getSignerEmail(signer) || '';

export const getSignerParseUserId = signer => {
  if (isContactOnlyUser(signer?.UserId)) return '';
  if (isContactOnlyUser(signer?.parseUser)) return '';
  return pointerId(signer?.UserId) || pointerId(signer?.parseUser);
};

export const getSignerMicrosoftOid = signer =>
  signer?.microsoftObjectId || signer?.microsoftOid || signer?.oid || '';

export function buildRecipientMatchWhere(identity = {}) {
  const userId = identity.userId || identity.currentUserId || '';
  const emails = [
    identity.email,
    identity.currentUserEmail,
    identity.username,
    identity.userPrincipalName,
    ...(Array.isArray(identity.emails) ? identity.emails : []),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
  const uniqueEmails = [...new Set(emails)];
  const microsoftOid = identity.microsoftOid || identity.microsoftObjectId || identity.oid || '';

  const contactOr = [];
  const directoryOr = [];

  if (userId) {
    const parseUserPtr = { __type: 'Pointer', className: '_User', objectId: userId };
    contactOr.push({ UserId: parseUserPtr });
    directoryOr.push({ parseUser: parseUserPtr });
  }

  uniqueEmails.forEach(email => {
    contactOr.push({ Email: email });
    contactOr.push({ normalizedEmail: email });
    directoryOr.push({ email });
    directoryOr.push({ mail: email });
    directoryOr.push({ userPrincipalName: email });
    directoryOr.push({ normalizedEmail: email });
  });

  if (microsoftOid) {
    directoryOr.push({ microsoftObjectId: microsoftOid });
    directoryOr.push({ microsoftOid });
    directoryOr.push({ oid: microsoftOid });
  }

  return {
    contactbookWhere: contactOr.length > 1 ? { $or: contactOr } : contactOr[0] || {},
    directoryWhere: directoryOr.length > 1 ? { $or: directoryOr } : directoryOr[0] || {},
    emails: uniqueEmails,
  };
}

export function signerMatchesIdentity(signer, identity = {}) {
  if (!signer) return false;
  const signerObjectId = pointerId(signer);
  const explicitSignerId = identity.signerObjectId || identity.reqUserId || '';
  if (explicitSignerId && signerObjectId === explicitSignerId) return true;

  const userId = identity.userId || identity.currentUserId || '';
  if (userId && getSignerParseUserId(signer) === userId) return true;

  const signerEmail = getSignerEmail(signer);
  const emails = [
    identity.email,
    identity.currentUserEmail,
    identity.username,
    identity.userPrincipalName,
    ...(Array.isArray(identity.emails) ? identity.emails : []),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
  if (signerEmail && emails.includes(signerEmail)) return true;

  const microsoftOid = identity.microsoftOid || identity.microsoftObjectId || identity.oid || '';
  return Boolean(microsoftOid && getSignerMicrosoftOid(signer) === microsoftOid);
}

export function findSignerForIdentity(signers = [], identity = {}) {
  if (!Array.isArray(signers)) return null;
  return signers.find(signer => signerMatchesIdentity(signer, identity)) || null;
}

export function getSignerClassName(signer, fallback = 'contracts_Contactbook') {
  return signer?.className || signer?.__type?.className || fallback;
}
