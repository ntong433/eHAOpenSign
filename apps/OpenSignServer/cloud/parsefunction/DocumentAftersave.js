import { getSignerParseUserId } from '../utils/recipientIdentity.js';

async function DocumentAftersave(request) {
  try {
    if (!request.original) {
      console.log('new entry is insert in contracts_Document ', request?.object?.id);
      const obj = request.object;
      const objId = obj?.id;
      const createdAt = obj?.get?.('createdAt');
      const folder = obj?.get?.('Type');
      const ip = request?.headers?.['x-real-ip'] || '';
      const originIp = obj?.get?.('OriginIp') || '';
      if (createdAt) {
        await updateDocumentMeta({ objId, createdAt, folder, ip, originIp });
      }

      const signers = obj?.get?.('Signers');
      const hasSigners = Array.isArray(signers) && signers.length > 0;
      // update acl of New Document If There are signers present in array
      if (hasSigners) {
        await updateAclDoc(objId);
      } else if (objId && request?.user) {
        await updateSelfDoc(objId);
      }
    } else {
      const signers = request.object.get('Signers');
      const placeholders = request.object.get('Placeholders');
      const hasSigners = Array.isArray(signers) && signers.length > 0;
      const hasPlaceholderSigners =
        Array.isArray(placeholders) &&
        placeholders.some(item => item?.Role !== 'prefill' && (item?.signerObjId || item?.signerPtr));
      const signerShapeChanged =
        hasFieldChanged(request, 'Signers') ||
        hasFieldChanged(request, 'Placeholders') ||
        hasFieldChanged(request, 'CreatedBy');

      if (signerShapeChanged && (hasSigners || hasPlaceholderSigners)) {
        await updateAclDoc(request.object.id);
      } else if (signerShapeChanged && request?.object?.id) {
        await updateSelfDoc(request.object.id);
      }
    }
  } catch (err) {
    console.log('err in aftersave of contracts_Document');
    console.log(err);
  }

  async function updateDocumentMeta({ objId, createdAt, folder, ip, originIp }) {
    const documentQuery = new Parse.Query('contracts_Document');
    documentQuery.include('ExtUserPtr.TenantId');

    const doc = await documentQuery.get(objId, { useMasterKey: true });
    if (folder === undefined || folder === 'AIDoc') {
      // ExpiryDate
      const timeToCompleteDays =
        folder === undefined
          ? doc.get('TimeToCompleteDays') || 15 // keep your default=15 only for "undefined folder"
          : doc.get('TimeToCompleteDays'); // keep original behavior for AIDoc (no forced default)

      if (typeof timeToCompleteDays === 'number' && createdAt) {
        const expiryDate = new Date(createdAt);
        expiryDate.setDate(expiryDate.getDate() + timeToCompleteDays);
        doc.set('ExpiryDate', expiryDate);
      }

      // OriginIp
      if (!originIp) {
        doc.set('OriginIp', ip);
      }

      // Automatic reminders
      const autoReminder = doc.get('AutomaticReminders') || false;
      if (autoReminder && createdAt) {
        const remindOnceInEvery = doc.get('RemindOnceInEvery') || 5;
        const reminderDate = new Date(createdAt);
        reminderDate.setDate(reminderDate.getDate() + remindOnceInEvery);
        doc.set('NextReminderDate', reminderDate);
      }
    }

    await doc.save(null, { useMasterKey: true });
  }

  async function updateAclDoc(objId) {
    const Query = new Parse.Query('contracts_Document');
    Query.include('Signers');
    Query.include('Signers.UserId');
    Query.include('Signers.parseUser');
    Query.include('Placeholders.signerPtr');
    Query.include('Placeholders.signerPtr.UserId');
    Query.include('Placeholders.signerPtr.parseUser');
    Query.include('ExtUserPtr.TenantId');
    Query.include('CreatedBy');
    const updateACL = await Query.get(objId, { useMasterKey: true });
    const res = JSON.parse(JSON.stringify(updateACL));
    const placeholderSignerIds = (res.Placeholders || [])
      .filter(item => item?.Role !== 'prefill' && item?.signerPtr)
      .map(item => getSignerParseUserId(item.signerPtr))
      .filter(Boolean);
    const signerParseUserIds = [
      ...new Set(
        [...(res.Signers || []).map(getSignerParseUserId), ...placeholderSignerIds].filter(Boolean)
      ),
    ];

    if (res.Signers?.[0]?.ExtUserPtr) {
      const ExtUserSigners = res.Signers
        .filter(item => item?.ExtUserPtr?.objectId)
        .map(item => ({
          __type: 'Pointer',
          className: 'contracts_Users',
          objectId: item.ExtUserPtr.objectId,
        }));
      if (ExtUserSigners.length > 0) {
        updateACL.set('Signers', ExtUserSigners);
      }
    }

    const newACL = new Parse.ACL();
    newACL.setPublicReadAccess(false);
    newACL.setPublicWriteAccess(false);
    if (res?.CreatedBy) {
      newACL.setReadAccess(res?.CreatedBy?.objectId, true);
      newACL.setWriteAccess(res?.CreatedBy?.objectId, true);
    }
    signerParseUserIds.forEach(userObjectId => {
      if (userObjectId) {
        newACL.setReadAccess(userObjectId, true);
        newACL.setWriteAccess(userObjectId, true);
      }
    });

    updateACL.setACL(newACL);
    console.log(
      '[signatureTrace:DocumentAftersave:acl]',
      JSON.stringify({
        documentId: objId,
        signerCount: (res.Signers || []).length,
        placeholderSignerCount: (res.Placeholders || []).filter(
          item => item?.Role !== 'prefill' && item?.signerPtr
        ).length,
        signerParseUserIds,
      })
    );
    await updateACL.save(null, { useMasterKey: true });
  }

  async function updateSelfDoc(objId) {
    const Query = new Parse.Query('contracts_Document');
    Query.include('CreatedBy');
    Query.include('ExtUserPtr.TenantId');
    const updateACL = await Query.get(objId, { useMasterKey: true });
    const res = JSON.parse(JSON.stringify(updateACL));
    const newACL = new Parse.ACL();
    newACL.setPublicReadAccess(false);
    newACL.setPublicWriteAccess(false);
    if (res?.CreatedBy) {
      newACL.setReadAccess(res?.CreatedBy?.objectId, true);
      newACL.setWriteAccess(res?.CreatedBy?.objectId, true);
    }
    updateACL.setACL(newACL);
    await updateACL.save(null, { useMasterKey: true });
  }
}

function hasFieldChanged(request, fieldName) {
  const currentValue = request?.object?.get?.(fieldName);
  const originalValue = request?.original?.get?.(fieldName);
  return JSON.stringify(currentValue ?? null) !== JSON.stringify(originalValue ?? null);
}

export default DocumentAftersave;
