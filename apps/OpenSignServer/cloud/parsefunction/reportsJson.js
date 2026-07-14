import { buildRecipientMatchWhere } from '../utils/recipientIdentity.js';

export default function reportJson(id, currentUserId, currentUserEmail, currentUserIdentity = {}) {
  const commanKeys = [
    'IsSignyourself',
    'URL',
    'Name',
    'Note',
    'SignedUrl',
    'AuditTrail',
    'Folder.Name',
    'ExtUserPtr.Name',
    'ExtUserPtr.Email',
    'ExtUserPtr.DownloadFilenameFormat',
    'ExtUserPtr.Company',
    'ExtUserPtr.Phone',
    'Signers.Name',
    'Signers.Email',
    'Signers.displayName',
    'Signers.email',
    'Signers.mail',
    'Signers.userPrincipalName',
    'Signers.Phone',
    'Placeholders',
    'TemplateId',
    'ExpiryDate',
    'SenderName',
    'SenderMail',
  ];
  const inProgressKeys = [
    ...commanKeys,
    'AuditTrail.UserPtr',
    'SendMail',
    'RequestBody',
    'RequestSubject',
    'EmailEditorType',
    'ExtUserPtr.TenantId.RequestBody',
    'ExtUserPtr.TenantId.RequestSubject',
    'ExtUserPtr.TenantId.EmailEditorType',
    'DocSentAt',
  ];
  const filterKeys = [
    'TimeToCompleteDays',
    'AllowModifications',
    'IsEnableOTP',
    'IsTourEnabled',
    'NotifyOnSignatures',
    'RedirectUrl',
    'SendinOrder',
  ];
  const needYourSignKeys = [...commanKeys, 'Signers.UserId', 'Signers.parseUser'];
  switch (id) {
    // draft documents report
    case 'ByHuevtCFY':
      return {
        reportName: 'Draft Documents',
        params: {
          Type: { $ne: 'Folder' },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          $or: [
            { SignedUrl: { $exists: false } },
            { DocSentAt: { $exists: false } }
          ],
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
        },
        keys: [...commanKeys, ...filterKeys],
      };
    // Need your sign report
    case '4Hhwbp482K': {
      const { contactbookWhere, directoryWhere } = buildRecipientMatchWhere({
        currentUserId,
        currentUserEmail,
        ...currentUserIdentity,
      });

      return {
        reportName: 'Need your sign',
        params: {
          Type: { $ne: 'Folder' },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          SignedUrl: { $ne: null },
          ExpiryDate: { $gt: { __type: 'Date', iso: new Date().toISOString() } },
          Placeholders: { $ne: null },
          $or: [
            {
              Signers: {
                $inQuery: {
                  where: contactbookWhere,
                  className: 'contracts_Contactbook',
                },
              },
            },
            {
              Signers: {
                $inQuery: {
                  where: directoryWhere,
                  className: 'DirectoryUser',
                },
              },
            }
          ],
        },
        keys: [...needYourSignKeys, ...filterKeys],
      };
    }
    // In progress report
    case '1MwEuxLEkF':
      return {
        reportName: 'In-progress documents',
        params: {
          Type: { $ne: 'Folder' },
          SignedUrl: { $ne: null },
          DocSentAt: { $exists: true },
          Placeholders: { $ne: null },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
          ExpiryDate: { $gt: { __type: 'Date', iso: new Date().toISOString() } },
        },
        keys: [...inProgressKeys, ...filterKeys],
      };
    // completed documents report
    case 'kQUoW4hUXz':
      return {
        reportName: 'Completed Documents',
        params: {
          Type: { $ne: 'Folder' },
          IsCompleted: true,
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          $or: [
            // Condition 1: If `CreatedBy` exists, no need for `Signers` filter
            { CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId } },
            // Condition 2: If `CreatedBy` does not exist, apply the `Signers` filter
            {
              Signers: {
                $inQuery: {
                  where: {
                    UserId: { __type: 'Pointer', className: '_User', objectId: currentUserId },
                  },
                  className: 'contracts_Contactbook',
                },
              },
            },
          ],
        },
        keys: [...commanKeys, ...filterKeys, 'IsCompleted'],
      };
    //  declined documents report
    case 'UPr2Fm5WY3':
      return {
        reportName: 'Declined Documents',
        params: {
          Type: null,
          IsArchive: { $ne: true },
          IsDeclined: true,
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
        },
        keys: [...commanKeys, 'DeclineReason'],
      };
    //  Expired Documents report
    case 'zNqBHXHsYH':
      return {
        reportName: 'Expired Documents',
        params: {
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          Type: { $ne: 'Folder' },
          SignedUrl: { $ne: null },
          ExpiryDate: { $lt: { __type: 'Date', iso: new Date().toISOString() } },
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
        },
        keys: [...commanKeys, ...filterKeys],
      };
    //  Recently sent for signatures report show on dashboard
    case 'd9k3UfYHBc':
      return {
        reportName: 'Recently sent for signatures',
        params: {
          Type: { $ne: 'Folder' },
          SignedUrl: { $ne: null },
          DocSentAt: { $exists: true },
          Placeholders: { $ne: null },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
          ExpiryDate: { $gt: { __type: 'Date', iso: new Date().toISOString() } },
        },
        keys: inProgressKeys,
      };
    //  Recent signature requests report show on dashboard
    case '5Go51Q7T8r': {
      const { contactbookWhere, directoryWhere } = buildRecipientMatchWhere({
        currentUserId,
        currentUserEmail,
        ...currentUserIdentity,
      });

      return {
        reportName: 'Recent signature requests',
        params: {
          Type: { $ne: 'Folder' },
          SignedUrl: { $ne: null },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          ExpiryDate: { $gt: { __type: 'Date', iso: new Date().toISOString() } },
          Placeholders: { $ne: null },
          $or: [
            {
              Signers: {
                $inQuery: {
                  where: contactbookWhere,
                  className: 'contracts_Contactbook',
                },
              },
            },
            {
              Signers: {
                $inQuery: {
                  where: directoryWhere,
                  className: 'DirectoryUser',
                },
              },
            }
          ],
        },
        keys: needYourSignKeys,
      };
    }
    // Drafts report show on dashboard
    case 'kC5mfynCi4':
      return {
        reportName: 'Drafts',
        params: {
          Type: { $ne: 'Folder' },
          IsCompleted: { $ne: true },
          IsDeclined: { $ne: true },
          IsArchive: { $ne: true },
          $or: [
            { SignedUrl: { $exists: false } },
            { DocSentAt: { $exists: false } }
          ],
          CreatedBy: { __type: 'Pointer', className: '_User', objectId: currentUserId },
        },
        keys: commanKeys,
      };
    // contact book report
    case 'contacts':
      return {
        reportName: 'Contactbook',
        reportClass: 'DirectoryUser',
        params: {
          accountEnabled: { $ne: false },
        },
        keys: ['displayName', 'email', 'mobilePhone', 'jobTitle', 'company'],
      };
    // Templates report
    case '6TeaPr321t':
      return {
        reportName: 'Templates',
        reportClass: 'contracts_Template',
        params: { Type: { $ne: 'Folder' }, IsArchive: { $ne: true } },
        keys: [
          ...commanKeys,
          ...filterKeys,
          'IsPublic',
          'SharedWith.Name',
          'SendinOrder',
          'SignatureType',
          'NotifyOnSignatures',
        ],
      };
    default:
      return null;
  }
}

// Escape regex special characters. Copied from filterDocs.js
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies searchTerm rules; combines existing access $or with search $or using $and.
 */
export function applySearch({ reportId, baseWhere, searchTerm }) {
  if (!searchTerm) return baseWhere;

  const escaped = escapeRegExp(searchTerm);
  const nameMatch = { Name: { $regex: `.*${escaped}.*`, $options: 'i' } };
  const emailMatch = { Email: { $regex: `.*${escaped}.*`, $options: 'i' } };

  if (reportId === 'contacts') {
    const dirNameMatch = { displayName: { $regex: `.*${escaped}.*`, $options: 'i' } };
    const dirEmailMatch = { email: { $regex: `.*${escaped}.*`, $options: 'i' } };
    return { ...baseWhere, $or: [dirNameMatch, dirEmailMatch] };
  }

  const searchOr = [
    nameMatch,
    { Signers: { $inQuery: { className: 'contracts_Contactbook', where: emailMatch } } },
    {
      Signers: {
        $inQuery: {
          className: 'DirectoryUser',
          where: { email: { $regex: `.*${escaped}.*`, $options: 'i' } },
        },
      },
    },
  ];

  // If baseWhere already has an access-control $or, combine using $and
  if (baseWhere.$or) {
    const { $or: accessOr, ...rest } = baseWhere;
    return { ...rest, $and: [{ $or: accessOr }, { $or: searchOr }] };
  }

  return { ...baseWhere, $or: searchOr };
}
