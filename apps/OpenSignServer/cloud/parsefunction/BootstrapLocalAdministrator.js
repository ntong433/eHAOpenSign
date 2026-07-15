import axios from 'axios';
import { MongoClient } from 'mongodb';
import { serverAppId } from '../../Utils.js';

const ADMIN_ROLE = 'contracts_Admin';
const LOCK_ID = 'local-administrator-v1';

const normalizeIdentity = value =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const pointer = (className, objectId) => ({
  __type: 'Pointer',
  className,
  objectId,
});

async function findCompleteAdministrator() {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserRole', ADMIN_ROLE);
  query.notEqualTo('IsDisabled', true);
  query.exists('OrganizationId');
  return query.first({ useMasterKey: true });
}

async function acquireBootstrapLock() {
  const databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;
  const client = new MongoClient(databaseUri);
  await client.connect();
  const locks = client.db().collection('_BootstrapLocks');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  try {
    await locks.insertOne({
      _id: LOCK_ID,
      status: 'in_progress',
      startedAt: now,
      expiresAt,
    });
    return { client, locks };
  } catch (error) {
    if (error?.code !== 11000) {
      await client.close();
      throw error;
    }
  }

  const lock = await locks.findOneAndUpdate(
    {
      _id: LOCK_ID,
      $or: [
        { status: 'failed' },
        { status: 'in_progress', expiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        status: 'in_progress',
        startedAt: now,
        expiresAt,
      },
      $unset: { completedAt: '', failedAt: '' },
    },
    { returnDocument: 'after' }
  );

  if (!lock) {
    await client.close();
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Administrator bootstrap is already running or has completed.'
    );
  }

  return { client, locks };
}

async function resolveOrCreateUser(userDetails) {
  const identity = normalizeIdentity(userDetails.email);
  if (!identity) {
    throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'Email is required.');
  }

  const usernameQuery = new Parse.Query(Parse.User);
  usernameQuery.equalTo('username', identity);
  const emailQuery = new Parse.Query(Parse.User);
  emailQuery.equalTo('email', identity);
  let user = await Parse.Query.or(usernameQuery, emailQuery).first({ useMasterKey: true });

  if (user) {
    return user;
  }

  if (typeof userDetails.password !== 'string' || userDetails.password.length === 0) {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'Password is required.');
  }

  user = new Parse.User();
  user.set('username', identity);
  user.set('email', identity);
  user.set('password', userDetails.password);
  user.set('name', userDetails.name);
  if (userDetails.phone) {
    user.set('phone', userDetails.phone);
  }
  return user.signUp(null, { useMasterKey: true });
}

async function resolveOrCreateTenant(user, userDetails) {
  const userPointer = pointer('_User', user.id);
  const query = new Parse.Query('partners_Tenant');
  query.equalTo('UserId', userPointer);
  let tenant = await query.first({ useMasterKey: true });

  if (!tenant) {
    tenant = new Parse.Object('partners_Tenant');
    tenant.set('UserId', userPointer);
    tenant.set('CreatedBy', userPointer);
  }

  tenant.set('TenantName', userDetails.company);
  tenant.set('EmailAddress', normalizeIdentity(userDetails.email));
  tenant.set('IsActive', true);
  if (userDetails.phone) tenant.set('ContactNumber', userDetails.phone);
  if (userDetails.pincode) tenant.set('PinCode', userDetails.pincode);
  if (userDetails.country) tenant.set('Country', userDetails.country);
  if (userDetails.state) tenant.set('State', userDetails.state);
  if (userDetails.city) tenant.set('City', userDetails.city);
  if (userDetails.address) tenant.set('Address', userDetails.address);
  return tenant.save(null, { useMasterKey: true });
}

async function resolveOrCreateExtendedUser(user, tenant, userDetails) {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', pointer('_User', user.id));
  let extendedUser = await query.first({ useMasterKey: true });
  if (!extendedUser) extendedUser = new Parse.Object('contracts_Users');

  extendedUser.set('UserId', pointer('_User', user.id));
  extendedUser.set('TenantId', pointer('partners_Tenant', tenant.id));
  extendedUser.set('UserRole', ADMIN_ROLE);
  extendedUser.set('Email', normalizeIdentity(userDetails.email));
  extendedUser.set('Name', userDetails.name);
  extendedUser.set('IsDisabled', false);
  if (userDetails.phone) extendedUser.set('Phone', userDetails.phone);
  if (userDetails.company) extendedUser.set('Company', userDetails.company);
  if (userDetails.jobTitle) extendedUser.set('JobTitle', userDetails.jobTitle);
  if (userDetails.timezone) extendedUser.set('Timezone', userDetails.timezone);
  return extendedUser.save(null, { useMasterKey: true });
}

async function ensureOrganizationAndTeam(user, tenant, extendedUser, userDetails) {
  let organization;
  const existingOrganization = extendedUser.get('OrganizationId');
  if (existingOrganization?.id) {
    organization = existingOrganization;
  } else {
    const query = new Parse.Query('contracts_Organizations');
    query.equalTo('ExtUserId', pointer('contracts_Users', extendedUser.id));
    organization = await query.first({ useMasterKey: true });
  }

  if (!organization) organization = new Parse.Object('contracts_Organizations');
  organization.set('Name', userDetails.company);
  organization.set('IsActive', true);
  organization.set('ExtUserId', pointer('contracts_Users', extendedUser.id));
  organization.set('CreatedBy', pointer('_User', user.id));
  organization.set('TenantId', pointer('partners_Tenant', tenant.id));
  organization = await organization.save(null, { useMasterKey: true });

  const teamQuery = new Parse.Query('contracts_Teams');
  teamQuery.equalTo('OrganizationId', pointer('contracts_Organizations', organization.id));
  teamQuery.equalTo('Name', 'All Users');
  let team = await teamQuery.first({ useMasterKey: true });
  if (!team) {
    team = new Parse.Object('contracts_Teams');
    team.set('Name', 'All Users');
    team.set('OrganizationId', pointer('contracts_Organizations', organization.id));
    team.set('IsActive', true);
    team = await team.save(null, { useMasterKey: true });
  }

  extendedUser.set('OrganizationId', pointer('contracts_Organizations', organization.id));
  extendedUser.set('TeamIds', [pointer('contracts_Teams', team.id)]);
  extendedUser.set('UserRole', ADMIN_ROLE);
  return extendedUser.save(null, { useMasterKey: true });
}

async function createSession(user) {
  const port = process.env.PORT || 8085;
  const mountPath = process.env.PARSE_MOUNT || '/app';
  const response = await axios.post(
    `http://127.0.0.1:${port}${mountPath}/loginAs`,
    null,
    {
      headers: {
        'X-Parse-Application-Id': serverAppId,
        'X-Parse-Master-Key': process.env.MASTER_KEY,
      },
      params: { userId: user.id },
    }
  );
  return response.data.sessionToken;
}

export default async function bootstrapLocalAdministrator(request) {
  if (await findCompleteAdministrator()) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'An administrator already exists.');
  }

  const lock = await acquireBootstrapLock();
  try {
    if (await findCompleteAdministrator()) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'An administrator already exists.');
    }

    const userDetails = request.params.userDetails || {};
    const user = await resolveOrCreateUser(userDetails);
    const tenant = await resolveOrCreateTenant(user, userDetails);
    const extendedUser = await resolveOrCreateExtendedUser(user, tenant, userDetails);
    await ensureOrganizationAndTeam(user, tenant, extendedUser, userDetails);
    const sessionToken = await createSession(user);

    await lock.locks.updateOne(
      { _id: LOCK_ID },
      { $set: { status: 'completed', completedAt: new Date() }, $unset: { expiresAt: '' } }
    );
    return { message: 'Administrator bootstrap completed.', sessionToken };
  } catch (error) {
    await lock.locks.updateOne(
      { _id: LOCK_ID },
      { $set: { status: 'failed', failedAt: new Date() }, $unset: { expiresAt: '' } }
    );
    throw error;
  } finally {
    await lock.client.close();
  }
}
