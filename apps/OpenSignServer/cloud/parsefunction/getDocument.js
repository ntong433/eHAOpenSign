import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import {
  RECIPIENT_AUTH_MODE_EXTERNAL,
  assertDocumentAvailable,
  authorizeExternalSigner,
  getUserIdentity,
  matchSignerIdentity,
  resolveSigningLinkContext,
} from '../services/signingAuthorization/index.js';
import { pointerId } from '../utils/recipientIdentity.js';

async function resolveRequestUser(request, sessiontoken, serverUrl) {
  if (request.user) return request.user;
  const token = sessiontoken || request?.headers?.['x-parse-session-token'] || '';
  if (!token) return null;
  const userRes = await axios.get(serverUrl + '/users/me', {
    headers: {
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Session-Token': token,
    },
  });
  const user = userRes?.data;
  if (!user?.objectId) return null;
  return {
    id: user.objectId,
    get: key => user[key],
  };
}

function getDocumentReadRole(document, user) {
  if (!user?.id) return false;
  const createdById = pointerId(document.CreatedBy);
  const ownerUserId = pointerId(document.ExtUserPtr?.UserId);
  if (createdById === user.id || ownerUserId === user.id) return 'owner';

  const identity = getUserIdentity(user);
  return (document.Signers || []).some(signer => matchSignerIdentity(signer, identity).matched)
    ? 'signer'
    : '';
}

export default async function getDocument(request) {
  const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
  const docId = request.params.docId;
  const include = request?.params?.include || '';
  const sessiontoken = request?.headers?.sessiontoken || '';
  const signingToken = request?.params?.signingToken || '';
  const externalSigningGrant = request?.params?.externalSigningGrant || '';
  const signerId = request?.params?.signerId || request?.params?.contactId || '';
  const formatError = err =>
    err?.message || err?.error || "You don't have access of this document!";
  try {
    if (docId) {
      try {
        const query = new Parse.Query('contracts_Document');
        query.equalTo('objectId', docId);
        query.include('ExtUserPtr');
        query.include('ExtUserPtr.UserId');
        query.include('ExtUserPtr.TenantId');
        query.include('CreatedBy');
        query.include('Signers');
        query.include('Signers.UserId');
        query.include('Signers.parseUser');
        query.include('AuditTrail.UserPtr');
        query.include('Placeholders');
        query.include('Placeholders.signerPtr');
        query.include('Placeholders.signerPtr.UserId');
        query.include('Placeholders.signerPtr.parseUser');
        query.include('DeclineBy');
        query.notEqualTo('IsArchive', true);
        if (include) {
          query?.include(include);
        }
        const res = await query.first({ useMasterKey: true });
        if (res) {
          const document = JSON.parse(JSON.stringify(res));
          if (document?.ExtUserPtr?.TenantId) {
            delete document.ExtUserPtr.TenantId.FileAdapters;
            delete document.ExtUserPtr.TenantId.PfxFile;
          }
          try {
            const user = await resolveRequestUser(request, sessiontoken, serverUrl);
            const readRole = getDocumentReadRole(document, user);
            if (readRole === 'owner') {
              return document;
            }
            if (readRole === 'signer') {
              assertDocumentAvailable(document);
              return document;
            }
          } catch (err) {
            console.log('err user is not authenticated', err.message);
          }

          if (signingToken && externalSigningGrant) {
            const context = await resolveSigningLinkContext({
              token: signingToken,
              docId,
              signerId,
              traceId: request?.params?.traceId,
              cloudFunction: 'getDocument',
            });

            if (context.authMode === RECIPIENT_AUTH_MODE_EXTERNAL) {
              await authorizeExternalSigner({
                doc: context.doc,
                signer: context.signer,
                placeholder: context.placeholder,
                signingToken,
                externalGrantToken: externalSigningGrant,
                requirePending: false,
                traceId: context.traceId,
                cloudFunction: 'getDocument',
              });
              return context.doc;
            }
          }

          return { error: "You don't have access of this document!" };
        } else {
          return { error: "document deleted or you don't have access." };
        }
      } catch (err) {
        console.log('err', err);
        return { error: formatError(err) };
      }
    } else {
      return { error: 'Please pass required parameters!' };
    }
  } catch (err) {
    console.log('err', err);
    if (err.code == 209) {
      return { error: 'Invalid session token' };
    } else {
      return { error: formatError(err) };
    }
  }
}
