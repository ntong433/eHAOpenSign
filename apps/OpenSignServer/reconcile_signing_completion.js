import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import Parse from 'parse/node';
import {
  COMPLETION_ACTIVITIES,
  isCompletionRelevant,
} from './utils/workflowUtils.js';
import { pointerId } from './cloud/utils/recipientIdentity.js';

const appId = process.env.APP_ID || 'opensign';
const masterKey = process.env.MASTER_KEY;
const serverURL = process.env.SERVER_URL || 'http://localhost:8085/app';
const write = process.argv.includes('--write');

Parse.initialize(appId, undefined, masterKey);
Parse.serverURL = serverURL;

const stats = {
  mode: write ? 'write' : 'dry-run',
  documentsScanned: 0,
  inconsistentRecordsFound: 0,
  signersRestoredToPending: 0,
  documentsRestoredToPending: 0,
  notificationsFlagged: 0,
  recordsRequiringManualReview: [],
};

function getRelevantSignerIds(doc = {}) {
  const placeholders = Array.isArray(doc.Placeholders) ? doc.Placeholders : [];
  return [
    ...new Set(
      placeholders
        .filter(isCompletionRelevant)
        .map(item => item.signerObjId || pointerId(item.signerPtr))
        .filter(Boolean)
    ),
  ];
}

function getCompletedSignerIds(doc = {}) {
  const auditTrail = Array.isArray(doc.AuditTrail) ? doc.AuditTrail : [];
  return [
    ...new Set(
      auditTrail
        .filter(entry => COMPLETION_ACTIVITIES.includes(entry?.Activity))
        .map(entry => pointerId(entry?.UserPtr))
        .filter(Boolean)
    ),
  ];
}

function buildCorrection(doc, reasons) {
  return {
    correctedAt: new Date().toISOString(),
    correctedBy: 'reconcile_signing_completion',
    reasons,
  };
}

async function reconcileDocument(docObj) {
  const doc = docObj.toJSON();
  stats.documentsScanned += 1;

  const relevantSignerIds = getRelevantSignerIds(doc);
  const completedSignerIds = getCompletedSignerIds(doc);
  const missingSignerIds = relevantSignerIds.filter(id => !completedSignerIds.includes(id));
  const hasSignedPdf = Boolean(doc.SignedUrl);
  const reasons = [];

  if (doc.IsCompleted && !hasSignedPdf) {
    reasons.push('completed-without-signed-pdf');
  }
  if (doc.IsCompleted && missingSignerIds.length > 0) {
    reasons.push('completed-before-all-required-signers');
  }
  if (!doc.IsCompleted && doc.finalEmailStatus === 'sent') {
    reasons.push('final-email-sent-while-document-pending');
  }
  if (doc.SigningState === 'processing' && doc.CurrentSigningOperationId) {
    const processingAt = doc.SigningProcessingAt?.iso
      ? new Date(doc.SigningProcessingAt.iso).getTime()
      : 0;
    if (processingAt && Date.now() - processingAt > 30 * 60 * 1000) {
      reasons.push('stale-processing-state');
    }
  }

  if (reasons.length === 0) return;

  stats.inconsistentRecordsFound += 1;
  stats.recordsRequiringManualReview.push({
    documentId: doc.objectId,
    name: doc.Name || '',
    reasons,
    isCompleted: Boolean(doc.IsCompleted),
    signedPdfPresent: hasSignedPdf,
    relevantSignerCount: relevantSignerIds.length,
    completedSignerCount: completedSignerIds.length,
    missingSignerIds,
    finalEmailStatus: doc.finalEmailStatus || '',
  });

  if (!write) return;

  const corrections = Array.isArray(docObj.get('CompletionReconciliation'))
    ? [...docObj.get('CompletionReconciliation')]
    : [];
  corrections.push(buildCorrection(doc, reasons));
  docObj.set('CompletionReconciliation', corrections);
  docObj.set('CompletionReconciliationRequired', true);

  if (reasons.includes('completed-without-signed-pdf') || reasons.includes('completed-before-all-required-signers')) {
    docObj.set('IsCompleted', false);
    docObj.set('SigningState', 'pending');
    docObj.set('CurrentSigningOperationId', '');
    docObj.set('SigningProcessingSignerId', '');
    stats.documentsRestoredToPending += 1;
    stats.signersRestoredToPending += missingSignerIds.length;
  }

  if (reasons.includes('final-email-sent-while-document-pending')) {
    docObj.set('finalEmailStatus', 'review_required');
    stats.notificationsFlagged += 1;
  }

  await docObj.save(null, { useMasterKey: true });
}

async function main() {
  const query = new Parse.Query('contracts_Document');
  query.notEqualTo('Type', 'Folder');
  query.include('Placeholders.signerPtr');
  query.limit(1000);
  query.ascending('createdAt');

  let skip = 0;
  // Parse skip is acceptable here because this is an operator-run reconciliation script.
  while (true) {
    query.skip(skip);
    const docs = await query.find({ useMasterKey: true });
    if (docs.length === 0) break;
    for (const doc of docs) {
      await reconcileDocument(doc);
    }
    skip += docs.length;
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch(error => {
  console.error('reconcile_signing_completion failed', error);
  process.exit(1);
});
