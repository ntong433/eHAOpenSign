import {
  buildRecipientMatchWhere,
  findSignerForIdentity,
  getSignerEmail,
  getSignerName,
  signerMatchesIdentity,
} from '../cloud/utils/recipientIdentity.js';

describe('recipient identity resolver', () => {
  it('matches a DirectoryUser signer by parse user and normalized email', () => {
    const signer = {
      objectId: 'UXi1EE5G12',
      className: 'DirectoryUser',
      displayName: 'James Bassey',
      email: ' James.Bassey@LHINigeria.org ',
      userPrincipalName: 'james.bassey@lhinigeria.org',
      parseUser: { objectId: 'kRlfG20fhr' },
    };

    expect(signerMatchesIdentity(signer, { userId: 'kRlfG20fhr' })).toBeTrue();
    expect(
      signerMatchesIdentity(signer, { email: 'james.bassey@lhinigeria.org' })
    ).toBeTrue();
    expect(getSignerName(signer)).toBe('James Bassey');
    expect(getSignerEmail(signer)).toBe('james.bassey@lhinigeria.org');
  });

  it('matches a local Contactbook signer by UserId', () => {
    const signer = {
      objectId: 'contact1',
      className: 'contracts_Contactbook',
      Name: 'Local Recipient',
      Email: 'local@example.org',
      UserId: { objectId: 'localUser1' },
    };

    expect(findSignerForIdentity([signer], { userId: 'localUser1' })).toBe(signer);
  });

  it('does not treat empty or undefined emails as a successful match', () => {
    const signer = {
      objectId: 'UXi1EE5G12',
      className: 'DirectoryUser',
      email: '',
      parseUser: { objectId: 'kRlfG20fhr' },
    };

    expect(signerMatchesIdentity(signer, { email: undefined })).toBeFalse();
    expect(signerMatchesIdentity(signer, { email: '   ' })).toBeFalse();
  });

  it('builds recipient dashboard clauses for both Contactbook and DirectoryUser identities', () => {
    const { contactbookWhere, directoryWhere, emails } = buildRecipientMatchWhere({
      userId: 'kRlfG20fhr',
      email: ' James.Bassey@LHINigeria.org ',
      userPrincipalName: 'james.bassey@lhinigeria.org',
      microsoftOid: '66c19120-d634-4393-ae9f-0957f77bfc17',
    });

    const contactJson = JSON.stringify(contactbookWhere);
    const directoryJson = JSON.stringify(directoryWhere);

    expect(emails).toEqual(['james.bassey@lhinigeria.org']);
    expect(contactJson).toContain('"className":"_User"');
    expect(contactJson).toContain('"objectId":"kRlfG20fhr"');
    expect(contactJson).toContain('"Email":"james.bassey@lhinigeria.org"');
    expect(directoryJson).toContain('"parseUser"');
    expect(directoryJson).toContain('"email":"james.bassey@lhinigeria.org"');
    expect(directoryJson).toContain('"userPrincipalName":"james.bassey@lhinigeria.org"');
    expect(directoryJson).toContain('"microsoftObjectId":"66c19120-d634-4393-ae9f-0957f77bfc17"');
  });
});
