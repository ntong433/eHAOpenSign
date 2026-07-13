import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import Parse from 'parse/node';
import {
  getSignerEmail,
  getSignerParseUserId,
  normalizeEmail,
  pointerId,
} from './cloud/utils/recipientIdentity.js';

const appId = process.env.APP_ID || 'opensign';
const masterKey = process.env.MASTER_KEY;
const serverURL = process.env.SERVER_URL || 'http://localhost:8085/app';
const write = process.argv.includes('--write');

Parse.initialize(appId, undefined, masterKey);
Parse.serverURL = serverURL;

const stats = {
  scanned: 0,
  repaired: 0,
  skipped: 0,
  failed: 0,
  reasons: {},
};

const addReason = reason => {
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
};

async function findUniqueParseUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { user: null, reason: 'missing-email' };

  const usernameQuery = new Parse.Query(Parse.User);
  usernameQuery.equalTo('username', normalized);
  const emailQuery = new Parse.Query(Parse.User);
  emailQuery.equalTo('email', normalized);
  const query = Parse.Query.or(usernameQuery, emailQuery);
  const users = await query.find({ useMasterKey: true });
  const unique = [...new Map(users.map(user => [user.id, user])).values()];
  if (unique.length === 1) return { user: unique[0], reason: '' };
  if (unique.length > 1) return { user: null, reason: 'ambiguous-parse-user' };
  return { user: null, reason: 'parse-user-not-found' };
}

function isPendingDocument(doc) {
  const json = doc.toJSON();
  if (json.IsCompleted || json.IsDeclined || json.IsArchive || json.IsCancelled) return false;
  if (json.ExpiryDate?.iso && new Date(json.ExpiryDate.iso).getTime() <= Date.now()) return false;
  const hasSigners = Array.isArray(json.Signers) && json.Signers.length > 0;
  const hasPlaceholderSigners =
    Array.isArray(json.Placeholders) &&
    json.Placeholders.some(placeholder => placeholder.Role !== 'prefill' && placeholder.signerPtr);
  return Boolean(json.SignedUrl && (hasSigners || hasPlaceholderSigners));
}

function ensureAcl(doc, userIds) {
  const acl = doc.getACL() || new Parse.ACL();
  let changed = false;
  userIds.filter(Boolean).forEach(userId => {
    if (!acl.getReadAccess(userId)) {
      acl.setReadAccess(userId, true);
      changed = true;
    }
    if (!acl.getWriteAccess(userId)) {
      acl.setWriteAccess(userId, true);
      changed = true;
    }
  });
  if (changed) doc.setACL(acl);
  return changed;
}

async function fetchDirectoryUserById(objectId) {
  const signerObj = new Parse.Query('DirectoryUser');
  signerObj.equalTo('objectId', objectId);
  signerObj.include('parseUser');
  return signerObj.first({ useMasterKey: true });
}

async function fetchContactbookById(objectId) {
  const contactQuery = new Parse.Query('contracts_Contactbook');
  contactQuery.equalTo('objectId', objectId);
  contactQuery.include('UserId');
  return contactQuery.first({ useMasterKey: true });
}

async function repairDirectoryUser(signer) {
  if (getSignerParseUserId(signer)) {
    return { userId: getSignerParseUserId(signer), changed: false, reason: '', resolvedSigner: signer };
  }
  const dirUser = await fetchDirectoryUserById(signer.objectId);
  if (!dirUser) return { userId: '', changed: false, reason: 'directory-user-not-found', resolvedSigner: signer };
  const existingParseUser = dirUser.get('parseUser');
  const resolvedSigner = {
    ...signer,
    ...dirUser.toJSON(),
    objectId: dirUser.id,
    className: 'DirectoryUser',
  };
  if (existingParseUser?.id) {
    return { userId: existingParseUser.id, changed: false, reason: '', resolvedSigner };
  }

  const { user, reason } = await findUniqueParseUserByEmail(getSignerEmail(signer));
  if (!user) return { userId: '', changed: false, reason, resolvedSigner };

  dirUser.set('parseUser', user);
  if (write) await dirUser.save(null, { useMasterKey: true });
  resolvedSigner.parseUser = user.toJSON();
  return { userId: user.id, changed: true, reason: '', resolvedSigner };
}

async function repairContactbookUser(signer) {
  if (getSignerParseUserId(signer)) {
    return { userId: getSignerParseUserId(signer), changed: false, reason: '', resolvedSigner: signer };
  }
  const contact = await fetchContactbookById(signer.objectId);
  if (!contact) {
    const directoryFallback = await repairDirectoryUser({ ...signer, className: 'DirectoryUser' });
    if (directoryFallback.userId) {
      return {
        ...directoryFallback,
        changed: true,
        reason: '',
      };
    }
    return { userId: '', changed: false, reason: 'contact-not-found', resolvedSigner: signer };
  }
  const existingUser = contact.get('UserId');
  const resolvedSigner = {
    ...signer,
    ...contact.toJSON(),
    objectId: contact.id,
    className: 'contracts_Contactbook',
  };
  if (existingUser?.id) {
    return { userId: existingUser.id, changed: false, reason: '', resolvedSigner };
  }

  const { user, reason } = await findUniqueParseUserByEmail(getSignerEmail(signer));
  if (!user) return { userId: '', changed: false, reason, resolvedSigner };

  contact.set('UserId', user);
  if (write) await contact.save(null, { useMasterKey: true });
  resolvedSigner.UserId = user.toJSON();
  return { userId: user.id, changed: true, reason: '', resolvedSigner };
}

function repairPlaceholders(doc, signers) {
  const placeholders = doc.get('Placeholders') || [];
  if (!Array.isArray(placeholders) || placeholders.length === 0) return false;
  let changed = false;
  const signerById = new Map(signers.map(signer => [signer.objectId, signer]));
  const signerByEmail = new Map(
    signers.map(signer => [getSignerEmail(signer), signer]).filter(([email]) => email)
  );

  const updated = placeholders.map(placeholder => {
    if (placeholder.Role === 'prefill') return placeholder;
    const currentId = placeholder.signerObjId || pointerId(placeholder.signerPtr);
    const signer =
      signerById.get(currentId) || signerByEmail.get(normalizeEmail(placeholder.email));
    if (!signer) return placeholder;

    const signerClass = signer.className || placeholder.signerPtr?.className || 'contracts_Contactbook';
    const signerPtr = {
      __type: 'Pointer',
      className: signerClass,
      objectId: signer.objectId,
    };
    if (
      placeholder.signerObjId !== signer.objectId ||
      pointerId(placeholder.signerPtr) !== signer.objectId ||
      placeholder.signerPtr?.className !== signerClass
    ) {
      changed = true;
      return { ...placeholder, signerObjId: signer.objectId, signerPtr };
    }
    return placeholder;
  });

  if (changed) doc.set('Placeholders', updated);
  return changed;
}

function toSignerCandidate(value) {
  if (!value) return null;
  if (typeof value.toJSON === 'function') {
    return {
      ...value.toJSON(),
      objectId: value.id,
      className: value.className,
    };
  }
  if (value.objectId) return value;
  return null;
}

function collectSigners(doc, json) {
  const rawSigners = (doc.get('Signers') || []).map(toSignerCandidate).filter(Boolean);
  if (rawSigners.length > 0) {
    const includedSigners = Array.isArray(json.Signers) ? json.Signers : [];
    const includedByKey = new Map(
      includedSigners.map(signer => [`${signer.className}:${signer.objectId}`, signer])
    );
    return rawSigners.map(signer => {
      const enriched = includedByKey.get(`${signer.className}:${signer.objectId}`);
      return enriched ? { ...signer, ...enriched } : signer;
    });
  }

  const placeholders = Array.isArray(json.Placeholders) ? json.Placeholders : [];
  const signerMap = new Map();
  placeholders.forEach(placeholder => {
    const signer = placeholder.Role !== 'prefill' ? placeholder.signerPtr : null;
    if (signer?.objectId) signerMap.set(signer.objectId, signer);
  });
  const placeholderSigners = [...signerMap.values()];
  return placeholderSigners.length > 0 ? placeholderSigners : json.Signers || [];
}

function repairSignersFromPlaceholders(doc, signers) {
  if (!Array.isArray(signers) || signers.length === 0) return false;
  const existing = doc.get('Signers') || [];
  const existingById = new Map(
    existing
      .map(signer => [signer?.id || signer?.objectId, signer?.className])
      .filter(([objectId]) => objectId)
  );
  const needsRepair =
    existing.length !== signers.length ||
    signers.some(signer => existingById.get(signer.objectId) !== signer.className);
  if (!needsRepair) return false;

  doc.set(
    'Signers',
    signers.map(signer => ({
      __type: 'Pointer',
      className: signer.className || 'contracts_Contactbook',
      objectId: signer.objectId,
    }))
  );
  return true;
}

async function run() {
  const query = new Parse.Query('contracts_Document');
  query.include('CreatedBy');
  query.include('Placeholders.signerPtr');
  query.include('Placeholders.signerPtr.UserId');
  query.include('Placeholders.signerPtr.parseUser');
  query.notEqualTo('IsCompleted', true);
  query.notEqualTo('IsDeclined', true);
  query.notEqualTo('IsArchive', true);
  query.notEqualTo('IsCancelled', true);
  query.exists('SignedUrl');
  query.limit(500);

  const docs = await query.find({ useMasterKey: true });
  for (const doc of docs) {
    if (!isPendingDocument(doc)) {
      stats.skipped += 1;
      addReason('not-pending-actionable');
      continue;
    }

    stats.scanned += 1;
    try {
      const json = doc.toJSON();
      const signers = collectSigners(doc, json);
      const parseUserIds = [pointerId(json.CreatedBy)].filter(Boolean);
      let changed = false;
      const documentReasons = [];
      const repairedSigners = [];

      for (const signer of signers) {
        let result;
        if (signer.className === 'DirectoryUser') {
          result = await repairDirectoryUser(signer);
        } else if (signer.className === 'contracts_Contactbook') {
          result = await repairContactbookUser(signer);
        } else {
          result = {
            userId: getSignerParseUserId(signer),
            changed: false,
            reason: getSignerParseUserId(signer) ? '' : `unsupported-signer-class-${signer.className}`,
            resolvedSigner: signer,
          };
        }

        if (result.userId) parseUserIds.push(result.userId);
        if (result.changed) changed = true;
        if (result.reason) documentReasons.push(result.reason);
        repairedSigners.push(result.resolvedSigner || signer);
      }

      if (repairSignersFromPlaceholders(doc, repairedSigners)) changed = true;
      if (repairPlaceholders(doc, repairedSigners)) changed = true;
      if (ensureAcl(doc, [...new Set(parseUserIds)])) changed = true;

      if (documentReasons.length > 0) {
        stats.skipped += 1;
        documentReasons.forEach(addReason);
      }

      if (changed) {
        if (write) await doc.save(null, { useMasterKey: true });
        stats.repaired += 1;
        console.log(
          JSON.stringify({
            documentId: doc.id,
            action: write ? 'repaired' : 'would-repair',
            signerIds: signers.map(signer => signer.objectId),
            parseUserIds: [...new Set(parseUserIds)],
            reasons: documentReasons,
          })
        );
      }
    } catch (err) {
      stats.failed += 1;
      addReason(err?.message || 'unknown-error');
      console.error(JSON.stringify({ documentId: doc.id, action: 'failed', error: err?.message }));
    }
  }

  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...stats }, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
