export const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const pointerId = (value) => value?.objectId || value?.id || "";

export const getSignerEmail = (signer) =>
  normalizeEmail(
    signer?.Email ||
      signer?.email ||
      signer?.mail ||
      signer?.userPrincipalName ||
      signer?.UPN ||
      signer?.username ||
      ""
  );

export const getSignerName = (signer) =>
  signer?.Name || signer?.displayName || signer?.name || getSignerEmail(signer) || "";

export const getSignerParseUserId = (signer) =>
  pointerId(signer?.UserId) || pointerId(signer?.parseUser);

export const getCurrentUserEmails = (user = {}) =>
  [
    user?.email,
    user?.username,
    user?.Email,
    user?.UPN,
    user?.userPrincipalName
  ]
    .map(normalizeEmail)
    .filter(Boolean);

export const signerMatchesCurrentUser = (signer, currentUser = {}) => {
  if (!signer || !currentUser) return false;
  const currentUserId = currentUser?.objectId || currentUser?.id || "";
  if (currentUserId && getSignerParseUserId(signer) === currentUserId) {
    return true;
  }
  const signerEmail = getSignerEmail(signer);
  return Boolean(signerEmail && getCurrentUserEmails(currentUser).includes(signerEmail));
};

export const findSignerForCurrentUser = (signers = [], currentUser = {}) =>
  Array.isArray(signers)
    ? signers.find((signer) => signerMatchesCurrentUser(signer, currentUser))
    : undefined;

export const auditBelongsToSigner = (audit, signerId) =>
  Boolean(pointerId(audit?.UserPtr) && signerId && pointerId(audit.UserPtr) === signerId);
