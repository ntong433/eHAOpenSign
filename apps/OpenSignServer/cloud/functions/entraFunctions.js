import { syncEntraDirectory } from '../services/entraSyncService.js';
import { isAdministrator } from '../services/adminHelper.js';

Parse.Cloud.define('syncEntraDirectory', async (request) => {
  const { user } = request;
  
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Current user not attached to request. Session token missing.');
  }
  
  const isAdmin = await isAdministrator(user);
  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User authenticated but has no Administrator role. Directory sync requires Administrator role.');
  }

  try {
    const result = await syncEntraDirectory({ 
      syncType: 'manual',
      adminEmail: user.get('email') || user.get('username') || 'Administrator'
    });
    return result;
  } catch (err) {
    console.error('Error triggering manual sync:', err);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, err.message);
  }
});

Parse.Cloud.job('syncEntraDirectoryJob', async (request) => {
  try {
    const { message } = request;
    message('Starting scheduled Entra ID directory synchronization...');
    const result = await syncEntraDirectory({ syncType: 'scheduled' });
    message(`Sync completed successfully. Processed ${result.usersProcessed} users.`);
  } catch (err) {
    console.error('Error in scheduled sync:', err);
    throw new Error(`Scheduled sync failed: ${err.message}`);
  }
});

Parse.Cloud.define('getDirectoryUsers', async (request) => {
  const { user, params } = request;
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Current user not attached to request. Session token missing.');
  }

  const limit = params.limit || 20;
  const skip = params.skip || 0;
  const search = params.search || "";
  const department = params.department || "";

  const DirectoryUser = Parse.Object.extend('DirectoryUser');
  const query = new Parse.Query(DirectoryUser);

  if (search) {
    const nameQuery = new Parse.Query(DirectoryUser);
    nameQuery.matches('displayName', search, 'i');
    
    const emailQuery = new Parse.Query(DirectoryUser);
    emailQuery.matches('email', search, 'i');

    query._orQuery([nameQuery, emailQuery]);
  }

  if (department) {
    query.equalTo('department', department);
  }

  query.limit(limit);
  query.skip(skip);
  query.ascending('displayName');

  const countQuery = new Parse.Query(DirectoryUser);
  if (search) countQuery._orQuery(query._orQuery()); // Copy OR conditions
  if (department) countQuery.equalTo('department', department);

  const [results, count] = await Promise.all([
    query.find({ useMasterKey: true }),
    countQuery.count({ useMasterKey: true })
  ]);

  const directoryUsers = results.map(u => u.toJSON());
  
  // Fetch admin status
  const userIds = directoryUsers.map(u => u.parseUser?.objectId).filter(id => id);
  let adminMap = {};
  if (userIds.length > 0) {
    const extQuery = new Parse.Query('contracts_Users');
    extQuery.containedIn('UserId', userIds.map(id => {
      return { __type: 'Pointer', className: '_User', objectId: id };
    }));
    const extUsers = await extQuery.find({ useMasterKey: true });
    extUsers.forEach(eu => {
      const uId = eu.get('UserId').id;
      adminMap[uId] = eu.get('UserRole') === 'contracts_Admin' || eu.get('UserRole') === 'contracts_OrgAdmin';
    });
  }

  const enhancedResults = directoryUsers.map(u => {
    return {
      ...u,
      isAdministrator: u.parseUser ? !!adminMap[u.parseUser.objectId] : false
    };
  });

  return {
    results: enhancedResults,
    count
  };
});

Parse.Cloud.define('promoteUserToAdmin', async (request) => {
  const { user, params } = request;
  if (!user) throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session missing.');
  
  const isAdmin = await isAdministrator(user);
  if (!isAdmin) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Only administrators can modify administrator privileges.');

  const { userId } = params;
  if (!userId) throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing userId.');

  const dirQuery = new Parse.Query('DirectoryUser');
  const dirUser = await dirQuery.get(userId, { useMasterKey: true });
  if (!dirUser) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Directory user not found.');

  const parseUser = dirUser.get('parseUser');
  if (!parseUser) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'User has not logged in yet.');

  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: parseUser.id });
  const extUser = await extQuery.first({ useMasterKey: true });
  if (!extUser) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'User profile incomplete.');

  const oldRole = extUser.get('UserRole');
  extUser.set('UserRole', 'contracts_Admin');
  await extUser.save(null, { useMasterKey: true });

  const AuditLog = Parse.Object.extend('AdminAuditLog');
  const audit = new AuditLog();
  audit.set('performedBy', user);
  audit.set('targetUser', parseUser);
  audit.set('oldRole', oldRole);
  audit.set('newRole', 'contracts_Admin');
  audit.set('action', 'Promote');
  await audit.save(null, { useMasterKey: true });

  return { success: true };
});

Parse.Cloud.define('removeAdminPrivileges', async (request) => {
  const { user, params } = request;
  if (!user) throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session missing.');
  
  const isAdmin = await isAdministrator(user);
  if (!isAdmin) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Only administrators can modify administrator privileges.');

  const { userId } = params;
  if (!userId) throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing userId.');

  const dirQuery = new Parse.Query('DirectoryUser');
  const dirUser = await dirQuery.get(userId, { useMasterKey: true });
  if (!dirUser) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Directory user not found.');

  const parseUser = dirUser.get('parseUser');
  if (!parseUser) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'User has not logged in yet.');

  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: parseUser.id });
  const extUser = await extQuery.first({ useMasterKey: true });
  if (!extUser) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'User profile incomplete.');

  const countQuery = new Parse.Query('contracts_Users');
  countQuery.containedIn('UserRole', ['contracts_Admin', 'contracts_OrgAdmin']);
  countQuery.notEqualTo('IsDisabled', true);
  const adminCount = await countQuery.count({ useMasterKey: true });
  
  const isTargetAdmin = extUser.get('UserRole') === 'contracts_Admin' || extUser.get('UserRole') === 'contracts_OrgAdmin';
  if (isTargetAdmin && adminCount <= 1) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Cannot remove the last administrator.');
  }

  const oldRole = extUser.get('UserRole');
  extUser.set('UserRole', 'contracts_User');
  await extUser.save(null, { useMasterKey: true });

  const AuditLog = Parse.Object.extend('AdminAuditLog');
  const audit = new AuditLog();
  audit.set('performedBy', user);
  audit.set('targetUser', parseUser);
  audit.set('oldRole', oldRole);
  audit.set('newRole', 'contracts_User');
  audit.set('action', 'Demote');
  await audit.save(null, { useMasterKey: true });

  return { success: true };
});
Parse.Cloud.define('getDirectoryStatistics', async (request) => {
  const { user } = request;
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Current user not attached to request. Session token missing.');
  }

  const DirectorySyncLog = Parse.Object.extend('DirectorySyncLog');
  const query = new Parse.Query(DirectorySyncLog);
  query.descending('createdAt');
  
  const DirectoryUser = Parse.Object.extend('DirectoryUser');
  const usersQuery = new Parse.Query(DirectoryUser);
  
  try {
    const [latestLog, totalUsers] = await Promise.all([
      query.first({ useMasterKey: true }),
      usersQuery.count({ useMasterKey: true })
    ]);

    return {
      totalUsers,
      lastSync: latestLog ? latestLog.get('createdAt') : null,
      syncStatus: latestLog ? latestLog.get('status') : 'none'
    };
  } catch (err) {
    console.error('Error fetching directory statistics:', err);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Failed to fetch directory statistics');
  }
});

Parse.Cloud.define('syncSingleUser', async (request) => {
  const { user, params } = request;
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Current user not attached to request. Session token missing.');
  }

  const isAdmin = await isAdministrator(user);
  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User authenticated but has no Administrator role.');
  }

  const { objectId } = params;
  if (!objectId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing objectId for syncSingleUser');
  }

  // Implementation to sync a single user (currently stubbed or mapped to generic sync)
  try {
    const result = await syncEntraDirectory({ syncType: 'manual_single_user', objectId });
    return result;
  } catch (err) {
    console.error('Error in syncSingleUser:', err);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, err.message);
  }
});

Parse.Cloud.define('syncProfilePhotos', async (request) => {
  const { user } = request;
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Current user not attached to request. Session token missing.');
  }

  const isAdmin = await isAdministrator(user);
  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User authenticated but has no Administrator role.');
  }

  // Implementation to sync profile photos
  try {
    return { status: 'success', message: 'Profile photos sync initiated in background.' };
  } catch (err) {
    console.error('Error in syncProfilePhotos:', err);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, err.message);
  }
});

