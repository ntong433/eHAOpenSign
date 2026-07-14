import axios from 'axios';
import { cloudServerUrl, mailTemplate, replaceMailVaribles, serverAppId } from '../../Utils.js';
import { setDocumentCount } from '../../utils/CountUtils.js';

import crypto from 'crypto';
import sendSystemMail from './sendSystemMail.js';

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
const appId = serverAppId;

async function sendOwnerSummaryEmail({
  ownerEmail,
  ownerName,
  total,
  created,
  failed,
  failedList,
}) {
  try {
    const subject = `Bulk send finished: ${failed} of ${total} failed to create`;

    const failureHtml = failedList?.length
      ? `<ul>${failedList
          .slice(0, 50)
          .map(f => `<li>#${f.index + 1}: ${String(f.error).slice(0, 200)}</li>`)
          .join('')}</ul>
         ${failedList.length > 50 ? `<p>…and ${failedList.length - 50} more.</p>` : ''}`
      : `<p>No failures.</p>`;

    const html = `
      <p>Hi ${ownerName || ''},</p>
      <p>Your bulk send processing is complete.</p>
      <p><b>Total requested:</b> ${total}<br/>
         <b>Created:</b> ${created}<br/>
         <b>Failed to create:</b> ${failed}</p>
      <h4>Failure details</h4>
      ${failureHtml}
    `;

    const params = {
      // keep provider selection consistent with your system; if you can’t decide, omit it.
      isbulksend: true,
      recipient: ownerEmail,
      subject,
      from: ownerEmail, // or use a tenant/from address if required by your provider
      replyto: ownerEmail,
      html,
    };

    await sendSystemMail({ params });
  } catch (e) {
    console.log('batchdoc Failed to send owner summary email:', e?.message || e);
  }
}

async function deductcount(docsCount, extUserId) {
  try {
    if (extUserId) {
      setDocumentCount(extUserId, docsCount);
    }
  } catch (err) {
    console.log('batchdoc deductcount error: ', err);
  }
}
async function sendMail(document, publicUrl) {
  const publicAppUrl = process.env.PUBLIC_URL || publicUrl || 'https://sign.lhinigeria.org';
  const baseUrl = new URL(publicAppUrl);
  const timeToCompleteDays = document?.TimeToCompleteDays || 15;
  const ExpireDate = new Date(document.createdAt);
  ExpireDate.setDate(ExpireDate.getDate() + timeToCompleteDays);
  const newDate = ExpireDate;
  const localExpireDate = newDate.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  let signerMail = document.Placeholders?.filter(x => x?.Role !== 'prefill');
  const senderName = document?.SenderName || document.ExtUserPtr.Name;
  const senderEmail = document?.SenderMail || document.ExtUserPtr.Email;
  const from =
    document?.SenderName || document?.ExtUserPtr?.UseNameAsSender === true
      ? document.ExtUserPtr.Name
      : senderEmail;

  if (document.SendinOrder) {
    const getRole = signer => signer?.SignerRole || signer?.signer_role || signer?.role || 'signer';
    const firstSignerIndex = signerMail.findIndex(signer => getRole(signer) === 'signer');
    signerMail = signerMail.filter((signer, idx) => {
      const role = getRole(signer);
      return role === 'viewer' || idx === firstSignerIndex;
    });
    if (signerMail.length === 0 && document?.Placeholders?.length > 0) {
      signerMail = document.Placeholders.filter(x => x?.Role !== 'prefill').slice(0, 1);
    }
  }

  for (let i = 0; i < signerMail.length; i++) {
    try {
      let url = `${serverUrl}/functions/sendmailv3`;
      const headers = {
        'Content-Type': 'application/json',
        'X-Parse-Application-Id': appId,
      };
      const objectId = signerMail[i]?.signerObjId;
      const hostUrl = process.env.PUBLIC_URL || baseUrl.origin;
      let encodeBase64;
      let existSigner = {};
      if (objectId) {
        existSigner = document?.Signers?.find(user => user.objectId === objectId);
        encodeBase64 = toBase64(`${document.objectId}/${existSigner?.Email}/${objectId}`);
      } else {
        encodeBase64 = toBase64(`${document.objectId}/${signerMail[i].email}`);
      }
      let signPdf = `${hostUrl}/login/${encodeURIComponent(encodeBase64)}`;
      const orgName = document.ExtUserPtr.Company ? document.ExtUserPtr.Company : '';
      const senderObj = document?.ExtUserPtr;
      let mailBody = senderObj?.TenantId?.RequestBody || '';
      let mailSubject = senderObj?.TenantId?.RequestSubject || '';
      let replaceVar;
      if (mailBody && mailSubject) {
        const replacedRequestBody = mailBody.replace(/"/g, "'");
        const htmlReqBody =
          "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body>" +
          replacedRequestBody +
          '</body></html>';
        const variables = {
          document_title: document?.Name,
          note: document?.Note || '',
          sender_name: senderName,
          sender_mail: senderEmail,
          sender_phone: senderObj?.Phone || '',
          receiver_name: existSigner?.Name || '',
          receiver_email: existSigner?.Email || signerMail[i].email,
          receiver_phone: existSigner?.Phone || '',
          expiry_date: localExpireDate,
          company_name: orgName,
          signing_url: signPdf,
        };
        replaceVar = replaceMailVaribles(mailSubject, htmlReqBody, variables);
      }
      const mailparam = {
        note: document?.Note || '',
        senderName: senderName,
        senderMail: senderEmail,
        title: document.Name,
        organization: orgName,
        localExpireDate: localExpireDate,
        signingUrl: signPdf,
      };
      let params = {
        extUserId: document.ExtUserPtr.objectId,
        recipient: existSigner?.Email || signerMail[i].email,
        subject: replaceVar?.subject ? replaceVar?.subject : mailTemplate(mailparam).subject,
        from: from,
        replyto: senderEmail || '',
        html: replaceVar?.body ? replaceVar?.body : mailTemplate(mailparam).body,
      };
      const response = await axios.post(url, params, { headers: headers });
      if (response.data?.result?.status === 'success' || response.data?.status === 'success') {
        const docUrl = `${serverUrl}/classes/contracts_Document/${document.objectId}`;
        await axios.put(docUrl, {
          DocSentAt: { __type: 'Date', iso: new Date().toISOString() }
        }, {
          headers: {
            'X-Parse-Application-Id': appId,
            'X-Parse-Master-Key': process.env.MASTER_KEY || 'opensign'
          }
        });
      }
    } catch (error) {
      console.log('batchdoc sendmail error: ', error);
    }
  }
}

async function startBulkSendInBackground(userId, Documents, Ip, parseConfig, type, publicUrl) {
  const BATCH_LIMIT = 50; // Parse batch limit (safe)
  const DOC_MAIL_CONCURRENCY = 5;

  // Find ext user
  const extCls = new Parse.Query('contracts_Users');
  extCls.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  const resExt = await extCls.first({ useMasterKey: true });
  if (!resExt) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');

  const _resExt = JSON.parse(JSON.stringify(resExt));

  // Resolve DirectoryUser classnames before mapping to avoid async inside map
  const allSignerIds = new Set();
  Documents.forEach(doc => {
    if (doc.Signers) {
      doc.Signers.forEach(s => {
        if (s.objectId) allSignerIds.add(s.objectId);
      });
    }
  });
  
  const dirUserQuery = new Parse.Query('DirectoryUser');
  dirUserQuery.containedIn('objectId', Array.from(allSignerIds));
  let dirUserIds = [];
  try {
    const foundDirUsers = await dirUserQuery.find({useMasterKey:true});
    dirUserIds = foundDirUsers.map(u => u.id);
  } catch(e) {}

  // Resolve or create contracts_Contactbook entries for missing signerPtr
  const emailsToResolve = new Set();
  Documents.forEach(doc => {
    doc.Placeholders?.forEach(p => {
      if (p.Role !== 'prefill' && (!p.signerPtr || !p.signerPtr.objectId) && p.email) {
        emailsToResolve.add(p.email.toLowerCase().trim());
      }
    });
  });

  const emailToContactId = {};
  if (emailsToResolve.size > 0) {
    try {
      const contactQuery = new Parse.Query('contracts_Contactbook');
      contactQuery.containedIn('Email', Array.from(emailsToResolve));
      contactQuery.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
      contactQuery.notEqualTo('IsDeleted', true);
      const existingContacts = await contactQuery.find({ useMasterKey: true });
      existingContacts.forEach(c => {
        emailToContactId[c.get('Email').toLowerCase().trim()] = c.id;
      });

      const newContacts = [];
      for (const email of emailsToResolve) {
        if (!emailToContactId[email]) {
          const contact = new Parse.Object('contracts_Contactbook');
          contact.set('Email', email);
          contact.set('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
          contact.set('UserRole', 'contracts_Guest');
          contact.set('IsDeleted', false);
          
          const acl = new Parse.ACL();
          acl.setReadAccess(userId, true);
          acl.setWriteAccess(userId, true);
          contact.setACL(acl);
          
          newContacts.push(contact);
        }
      }

      if (newContacts.length > 0) {
        await Parse.Object.saveAll(newContacts, { useMasterKey: true });
        newContacts.forEach(c => {
          emailToContactId[c.get('Email').toLowerCase().trim()] = c.id;
        });
      }
    } catch (err) {
      console.log('Error resolving missing contacts in batch docs', err);
    }
  }

  // Build Parse /batch requests from your existing mapping (same as your current code)
  const requests = Documents.map(x => {
    const Signers = x.Signers || [];
    const placeholders = x?.Placeholders?.filter(p => p?.Role !== 'prefill');
    
    const resolvedPlaceholders = placeholders?.map(y => {
      let sId = y?.signerPtr?.objectId;
      let resolvedClass = y?.signerPtr?.className || (sId && dirUserIds.includes(sId) ? 'DirectoryUser' : 'contracts_Contactbook');
      
      if (!sId && y.email) {
        const cleanEmail = y.email.toLowerCase().trim();
        if (emailToContactId[cleanEmail]) {
          sId = emailToContactId[cleanEmail];
          resolvedClass = 'contracts_Contactbook';
        }
      }
      
      return sId
        ? {
            ...y,
            signerPtr: {
              __type: 'Pointer',
              className: resolvedClass,
              objectId: sId,
            },
            signerObjId: sId,
            email: y?.signerPtr?.Email || y?.email || '',
          }
        : { ...y, signerPtr: {}, signerObjId: '', email: y.email || '' };
    });

    const allSigner = resolvedPlaceholders
      ?.map(item => Signers?.find(e => item?.signerPtr?.objectId === e?.objectId) || item?.signerPtr)
      .filter(signer => signer && Object.keys(signer).length > 0);
      
      
    const date = new Date();
    const isoDate = date.toISOString();
    let Acl = { [x.CreatedBy.objectId]: { read: true, write: true } };
    if (allSigner && allSigner.length > 0) {
      allSigner.forEach(x => {
        if (x?.CreatedBy?.objectId) {
          Acl = { ...Acl, [x.CreatedBy.objectId]: { read: true, write: true } };
        }
      });
    }
    let mailBody = x?.ExtUserPtr?.TenantId?.RequestBody || '';
    let mailSubject = x?.ExtUserPtr?.TenantId?.RequestSubject || '';
    let EmailEditorType = x?.ExtUserPtr?.TenantId?.EmailEditorType || '';
    return {
      method: 'POST',
      path: '/app/classes/contracts_Document',
      body: {
        Name: x.Name,
        URL: x.URL,
        Note: x.Note,
        Description: x.Description,
        CreatedBy: x.CreatedBy,
        SendinOrder: x.SendinOrder || true,
        SendInOrderStrict: x.SendInOrderStrict || false,
        ExtUserPtr: {
          __type: 'Pointer',
          className: x.ExtUserPtr.className,
          objectId: x.ExtUserPtr?.objectId,
        },
        Placeholders: resolvedPlaceholders,
        SignedUrl: x.URL || x.SignedUrl,
        SentToOthers: true,
        Signers: allSigner?.map(y => ({
          __type: 'Pointer',
          className: y.className || (dirUserIds.includes(y.objectId) ? 'DirectoryUser' : 'contracts_Contactbook'),
          objectId: y.objectId,
        })),
        ACL: Acl,
        SentToOthers: true,
        RemindOnceInEvery: x.RemindOnceInEvery ? parseInt(x.RemindOnceInEvery) : 5,
        AutomaticReminders: x.AutomaticReminders || false,
        TimeToCompleteDays: x.TimeToCompleteDays ? parseInt(x.TimeToCompleteDays) : 15,
        OriginIp: Ip,
        IsEnableOTP: x?.IsEnableOTP || false,
        IsTourEnabled: x?.IsTourEnabled || false,
        AllowModifications: x?.AllowModifications || false,
        ...(x?.SenderName ? { SenderName: x?.SenderName } : {}),
        ...(x?.SenderMail ? { SenderMail: x?.SenderMail } : {}),
        ...(type === 'bulksend' ? { BulkSendToken: generateId(10) } : {}),
        ...(x?.SignatureType ? { SignatureType: x?.SignatureType } : {}),
        ...(x?.NotifyOnSignatures ? { NotifyOnSignatures: x?.NotifyOnSignatures } : {}),
        ...(x?.Bcc?.length > 0 ? { Bcc: x?.Bcc } : {}),
        ...(x?.Cc?.length > 0 ? { Cc: x?.Cc } : {}),
        ...(x?.RedirectUrl ? { RedirectUrl: x?.RedirectUrl } : {}),
        ...(mailBody ? { RequestBody: mailBody } : {}),
        ...(mailSubject ? { RequestSubject: mailSubject } : {}),
        ...(EmailEditorType ? { EmailEditorType: EmailEditorType } : {}),
        ...(x?.objectId
          ? {
              TemplateId: {
                __type: 'Pointer',
                className: 'contracts_Template',
                objectId: x?.objectId,
              },
            }
          : {}),
        ...(x?.PenColors?.length > 0 ? { PenColors: x?.PenColors } : {}),
      },
    };
  });

  if (requests?.length > 0) {
    const newrequests = [requests?.[0]];
    const response = await axios.post('batch', { requests: newrequests }, parseConfig);
    // Handle the batch query response
    // console.log('Batch query response:', response.data);
    if (response.data && response.data.length > 0) {
      const document = Documents?.[0];
      const updateDocuments = {
        ...document,
        objectId: response.data[0]?.success?.objectId,
        createdAt: response.data[0]?.success?.createdAt,
      };

      // ========== SIGN REQUEST ==========
      console.log(`[createBatchDocs] ========== SIGN REQUEST ==========`);
      console.log(`[createBatchDocs] Document: ${document?.Name ?? '(unnamed)'}`);
      console.log(`[createBatchDocs] Document ID: ${updateDocuments.objectId}`);
      console.log(`[createBatchDocs] Owner: ${document?.ExtUserPtr?.Email ?? '(unknown)'}`);
      const recipientEmails = (document?.Placeholders || [])
        .filter(p => p?.Role !== 'prefill')
        .map(p => p?.signerPtr?.Email || p?.email || '(no email)');
      console.log(`[createBatchDocs] Recipients: ${recipientEmails.join(', ')}`);
      console.log(`[createBatchDocs] Signer Records Created: ${document?.Signers?.length ?? 0}`);
      console.log(`[createBatchDocs] Status: Document created, sending email notifications`);

      deductcount(response.data.length, resExt.id);
      sendMail(updateDocuments, publicUrl); //sessionToken
      return { total: 1, created: 1, failed: 0 };
    }
  }
}

export default async function createBatchDocs(request) {
  const strDocuments = request.params.Documents;
  const sessionToken = request.headers?.sessiontoken;
  const type = request.headers?.type || 'quicksend';
  const Documents = JSON.parse(strDocuments);

  const Ip = request?.headers?.['x-real-ip'] || '';
  // Access the host from the headers
  const publicUrl = request.headers.public_url;
  const parseConfig = {
    baseURL: serverUrl,
    headers: {
      'X-Parse-Application-Id': appId,
      'X-Parse-Session-Token': sessionToken,
      'Content-Type': 'application/json',
    },
  };
  try {
    let userId = '';

    if (request?.user) {
      userId = request.user.id;
      // return await batchQuery(request.user.id, Documents, Ip, parseConfig, type, publicUrl);
    }
    if (!userId) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
    }

    // quicksend
    return await startBulkSendInBackground(userId, Documents, Ip, parseConfig, type, publicUrl);
  } catch (err) {
    console.log('createbatchdoc error: ', err);
    const code = err?.code || 400;
    const msg = err?.message || 'Something went wrong.';
    throw new Parse.Error(code, msg);
  }
}
