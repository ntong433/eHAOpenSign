const EXTERNAL_GRANT_PREFIX = "lhi.externalSigningGrant.";
const SIGNING_ENTRY_AUTH_PREFIX = "lhi.signingEntryAuthorized.";

const getKey = (signingToken = "") =>
  `${EXTERNAL_GRANT_PREFIX}${String(signingToken || "")}`;

export const storeExternalSigningGrant = (signingToken, grant = {}) => {
  if (!signingToken || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(getKey(signingToken), JSON.stringify(grant));
};

export const readExternalSigningGrant = (signingToken) => {
  if (!signingToken || typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(getKey(signingToken));
    if (!value) return null;
    const parsed = JSON.parse(value);
    const expiresAt = parsed?.expiresAt ? new Date(parsed.expiresAt).getTime() : 0;
    if (expiresAt && expiresAt <= Date.now()) {
      sessionStorage.removeItem(getKey(signingToken));
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(getKey(signingToken));
    return null;
  }
};

export const clearExternalSigningGrant = (signingToken) => {
  if (!signingToken || typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(getKey(signingToken));
};

const getEntryAuthKey = (signingToken = "") =>
  `${SIGNING_ENTRY_AUTH_PREFIX}${String(signingToken || "")}`;

export const markSigningEntryAuthorized = (signingToken, authorization = {}) => {
  if (!signingToken || typeof sessionStorage === "undefined") return;
  const expiresAt =
    authorization.expiresAt ||
    new Date(Date.now() + 5 * 60 * 1000).toISOString();
  sessionStorage.setItem(
    getEntryAuthKey(signingToken),
    JSON.stringify({
      ...authorization,
      expiresAt,
    })
  );
};

export const readSigningEntryAuthorization = (signingToken) => {
  if (!signingToken || typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(getEntryAuthKey(signingToken));
    if (!value) return null;
    const parsed = JSON.parse(value);
    const expiresAt = parsed?.expiresAt ? new Date(parsed.expiresAt).getTime() : 0;
    if (expiresAt && expiresAt <= Date.now()) {
      sessionStorage.removeItem(getEntryAuthKey(signingToken));
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(getEntryAuthKey(signingToken));
    return null;
  }
};

export const clearSigningEntryAuthorization = (signingToken) => {
  if (!signingToken || typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(getEntryAuthKey(signingToken));
};
