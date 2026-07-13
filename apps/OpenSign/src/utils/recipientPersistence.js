import { normalizeEmail } from "./recipientIdentity";

const RECIPIENT_STORAGE_PREFIX = "lhi.signatureWizardRecipients.";

const recipientKey = (docId) => `${RECIPIENT_STORAGE_PREFIX}${docId}`;

const inferRecipientClassName = (recipient = {}) => {
  if (recipient.className) {
    return recipient.className;
  }
  if (
    recipient.parseUser ||
    recipient.directoryUserId ||
    recipient.DirectoryUserId ||
    recipient.microsoftObjectId ||
    recipient.microsoftOid ||
    recipient.oid ||
    recipient.mail ||
    recipient.userPrincipalName
  ) {
    return "DirectoryUser";
  }
  return "contracts_Contactbook";
};

export const getRecipientIdentity = (recipient = {}) =>
  recipient.objectId
    ? `${recipient.className || inferRecipientClassName(recipient)}:${recipient.objectId}`
    : recipient.id ||
      recipient.contactId ||
      recipient.parseUserId ||
      recipient.directoryUserId ||
      recipient.entraObjectId ||
      normalizeEmail(recipient.email || recipient.Email || recipient.mail);

export const normalizeRecipient = (recipient = {}, index = 0) => {
  const email = normalizeEmail(recipient.email || recipient.Email || recipient.mail);
  const objectId = recipient.objectId || recipient.id || recipient.value || "";
  return {
    ...recipient,
    id: recipient.id || objectId || email,
    objectId,
    contactId: recipient.contactId || objectId,
    parseUserId:
      recipient.parseUserId ||
      recipient.UserId?.objectId ||
      recipient.parseUser?.objectId ||
      "",
    directoryUserId: recipient.directoryUserId || recipient.DirectoryUserId || "",
    entraObjectId:
      recipient.entraObjectId ||
      recipient.microsoftObjectId ||
      recipient.microsoftOid ||
      recipient.oid ||
      "",
    email,
    normalizedEmail: email,
    Email: recipient.Email || email,
    displayName:
      recipient.displayName ||
      recipient.Name ||
      recipient.name ||
      recipient.label ||
      email,
    Name:
      recipient.Name ||
      recipient.displayName ||
      recipient.name ||
      recipient.label ||
      email,
    signingOrder: recipient.signingOrder ?? index + 1,
    role: recipient.role || recipient.Role || "signer",
    className: inferRecipientClassName(recipient)
  };
};

export const dedupeRecipients = (recipients = []) => {
  const seen = new Set();
  return recipients.reduce((acc, recipient, index) => {
    const normalized = normalizeRecipient(recipient, index);
    const identity = getRecipientIdentity(normalized);
    if (!identity || seen.has(identity)) return acc;
    seen.add(identity);
    acc.push(normalized);
    return acc;
  }, []);
};

export const storeWizardRecipients = (docId, recipients) => {
  if (!docId || typeof sessionStorage === "undefined") return;
  const canonical = dedupeRecipients(recipients);
  sessionStorage.setItem(recipientKey(docId), JSON.stringify(canonical));
};

export const readWizardRecipients = (docId) => {
  if (!docId || typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(recipientKey(docId)) || "[]");
    return dedupeRecipients(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
};

export const clearWizardRecipients = (docId) => {
  if (docId && typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(recipientKey(docId));
  }
};

export const mergeRecipients = (...groups) => dedupeRecipients(groups.flat().filter(Boolean));
