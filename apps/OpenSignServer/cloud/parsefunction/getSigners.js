// Function to escape special characters in the search string
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function dedupeByRecipientIdentity(records = []) {
  const seen = new Set();
  return records.filter(record => {
    const key = `${record.className || ''}:${record.objectId || ''}`;
    if (!record.objectId || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function getDirectoryUsers(searchRegex) {
  const displayNameQuery = new Parse.Query('DirectoryUser');
  displayNameQuery.matches('displayName', searchRegex);

  const emailQuery = new Parse.Query('DirectoryUser');
  emailQuery.matches('email', searchRegex);

  const mailQuery = new Parse.Query('DirectoryUser');
  mailQuery.matches('mail', searchRegex);

  const upnQuery = new Parse.Query('DirectoryUser');
  upnQuery.matches('userPrincipalName', searchRegex);

  const query = Parse.Query.or(displayNameQuery, emailQuery, mailQuery, upnQuery);
  query.notEqualTo('accountEnabled', false);
  query.include('parseUser');

  const users = await query.find({ useMasterKey: true });
  return users.map(user => ({
    objectId: user.id,
    className: 'DirectoryUser',
    Name: user.get('displayName'),
    Email: user.get('email'),
    Phone: user.get('mobilePhone'),
    JobTitle: user.get('jobTitle'),
    Company: user.get('company'),
    displayName: user.get('displayName'),
    email: user.get('email'),
    mail: user.get('mail'),
    userPrincipalName: user.get('userPrincipalName'),
    normalizedEmail: normalizeEmail(
      user.get('email') || user.get('mail') || user.get('userPrincipalName')
    ),
    parseUser: user.get('parseUser')?.toJSON?.() || undefined,
    microsoftObjectId: user.get('microsoftObjectId') || user.get('microsoftOid') || user.get('oid') || '',
    microsoftOid: user.get('microsoftOid') || user.get('microsoftObjectId') || user.get('oid') || '',
    oid: user.get('oid') || user.get('microsoftObjectId') || user.get('microsoftOid') || '',
  }));
}

async function getContactbookUsers(searchRegex, createdBy) {
  const nameQuery = new Parse.Query('contracts_Contactbook');
  nameQuery.matches('Name', searchRegex);

  const emailQuery = new Parse.Query('contracts_Contactbook');
  emailQuery.matches('Email', searchRegex);

  const query = Parse.Query.or(nameQuery, emailQuery);
  query.equalTo('CreatedBy', createdBy);
  query.notEqualTo('IsDeleted', true);
  query.include('UserId');

  const contacts = await query.find({ useMasterKey: true });
  return contacts.map(contact => ({
    objectId: contact.id,
    className: 'contracts_Contactbook',
    Name: contact.get('Name'),
    Email: contact.get('Email'),
    Phone: contact.get('Phone'),
    JobTitle: contact.get('JobTitle'),
    Company: contact.get('Company'),
    normalizedEmail: normalizeEmail(contact.get('Email')),
    UserId: contact.get('UserId')?.toJSON?.() || undefined,
  }));
}

export default async function getSigners(request) {
  const search = request.params.search || '';

  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
    }

    const escapedSearch = escapeRegExp(search);
    const searchRegex = new RegExp(escapedSearch, 'i');
    const createdBy = {
      __type: 'Pointer',
      className: '_User',
      objectId: request.user.id,
    };

    const [directoryUsers, contactbookUsers] = await Promise.all([
      getDirectoryUsers(searchRegex),
      getContactbookUsers(searchRegex, createdBy),
    ]);

    return dedupeByRecipientIdentity([...directoryUsers, ...contactbookUsers]);
  } catch (err) {
    console.log('err in get signers', err);
    throw err;
  }
}
