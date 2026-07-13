import axios from 'axios';
import https from 'https';
// Removed node-fetch to use native fetch for IPv4/IPv6 Happy Eyeballs support

/**
 * Perform a full or delta sync of the Entra ID directory.
 */
export async function syncEntraDirectory(options = {}) {
  const { syncType = 'manual', adminEmail = 'System' } = options;
  const startTime = Date.now();
  let usersAdded = 0;
  let usersUpdated = 0;
  let usersDisabled = 0;
  let usersProcessed = 0;
  let nextDeltaToken = null;
  let errorMessage = null;
  let status = 'success';

  console.log("=== DIRECTORY SYNC ===");
  console.log(`Administrator: ${adminEmail}`);

  try {
    const config = getSyncConfig();
    const { tenantId, clientId, clientSecret } = config;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("Missing Entra ID configuration for synchronization.");
    }

    // 1. Get Application Access Token
    console.log("Loading Graph token...");
    const accessToken = await getAppAccessToken(tenantId, clientId, clientSecret);
    console.log("SUCCESS");

    // 2. Determine if we have a deltaToken from a previous sync
    const lastSync = await getLastSuccessfulSync();
    let deltaToken = lastSync ? lastSync.get('deltaToken') : null;

    // 3. Fetch users (Delta query)
    let hasMorePages = true;
    let url = deltaToken 
      ? deltaToken
      : `https://graph.microsoft.com/v1.0/users/delta?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,officeLocation,companyName,mobilePhone,businessPhones,accountEnabled,employeeId`;

    while (hasMorePages) {
      try {
        console.log("Calling Graph...");
        const response = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          timeout: 10000,
          httpsAgent: new https.Agent({ family: 4 })
        });
        console.log("SUCCESS");

        const data = response.data;
        const users = data.value || [];
        console.log(`Retrieved: ${users.length} users`);
        usersProcessed += users.length;
        
        console.log("Updating Parse...");

        // 4. Process each user
        for (const graphUser of users) {
          const action = await processGraphUser(graphUser);
          if (action === 'added') usersAdded++;
          if (action === 'updated') usersUpdated++;
          if (action === 'disabled') usersDisabled++;
        }

        if (data['@odata.nextLink']) {
          url = data['@odata.nextLink'];
        } else if (data['@odata.deltaLink']) {
          nextDeltaToken = data['@odata.deltaLink'];
          hasMorePages = false;
        } else {
          hasMorePages = false;
        }
      } catch (err) {
        if (err.response && err.response.status === 410) {
          console.warn("Delta token expired, falling back to full sync.");
          deltaToken = null;
          url = `https://graph.microsoft.com/v1.0/users/delta?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,officeLocation,companyName,mobilePhone,businessPhones,accountEnabled,employeeId`;
          continue; // retry
        }
        throw new Error(`Graph API error: ${err.message}`);
      }
    }

  } catch (err) {
    status = 'failed';
    errorMessage = err.message;
    console.error("Directory sync failed:", err);
  } finally {
    const durationMs = Date.now() - startTime;
    await logSyncResult({
      syncType,
      status,
      usersProcessed,
      usersAdded,
      usersUpdated,
      usersDisabled,
      durationMs,
      deltaToken: nextDeltaToken,
      errorMessage
    });
    
    console.log(`Inserted: ${usersAdded}`);
    console.log(`Updated: ${usersUpdated}`);
    console.log(`Failed: ${status === 'failed' ? 1 : 0}`);
    console.log("Synchronization Complete");
  }

  return {
    status,
    usersProcessed,
    usersAdded,
    usersUpdated,
    usersDisabled,
    durationMs: Date.now() - startTime,
    errorMessage
  };
}

async function getAppAccessToken(tenantId, clientId, clientSecret) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'client_credentials');

  try {
    const response = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
      httpsAgent: new https.Agent({ family: 4 })
    });
    return response.data.access_token;
  } catch (err) {
    throw new Error(`Could not get application token: ${err.message}`);
  }
}

async function getLastSuccessfulSync() {
  const DirectorySyncLog = Parse.Object.extend('DirectorySyncLog');
  const query = new Parse.Query(DirectorySyncLog);
  query.equalTo('status', 'success');
  query.exists('deltaToken');
  query.descending('createdAt');
  return await query.first({ useMasterKey: true });
}

export async function processGraphUser(graphUser) {
  const DirectoryUser = Parse.Object.extend('DirectoryUser');
  const queries = [];
  
  if (graphUser.id) {
    const q = new Parse.Query(DirectoryUser);
    q.equalTo('microsoftObjectId', graphUser.id);
    queries.push(q);
  }
  
  const upn = (graphUser.userPrincipalName || "").toLowerCase();
  if (upn) {
    const q = new Parse.Query(DirectoryUser);
    q.equalTo('userPrincipalName', upn);
    queries.push(q);
  }
  
  const mail = (graphUser.mail || upn).toLowerCase();
  if (mail) {
    const q = new Parse.Query(DirectoryUser);
    q.equalTo('email', mail);
    queries.push(q);
  }
  
  const query = Parse.Query.or(...queries);
  let dirUser = await query.first({ useMasterKey: true });

  let action = 'none';

  // Check if deleted
  if (graphUser['@removed']) {
    if (dirUser) {
      dirUser.set('accountEnabled', false);
      dirUser.set('lastSynchronized', new Date());
      await dirUser.save(null, { useMasterKey: true });
      return 'disabled';
    }
    return 'none';
  }

  if (!dirUser) {
    dirUser = new DirectoryUser();
    dirUser.set('microsoftObjectId', graphUser.id);
    action = 'added';
  } else {
    action = 'updated';
    dirUser.set('microsoftObjectId', graphUser.id);
  }

  dirUser.set('displayName', graphUser.displayName || "");
  dirUser.set('givenName', graphUser.givenName || "");
  dirUser.set('surname', graphUser.surname || "");
  dirUser.set('email', (graphUser.mail || graphUser.userPrincipalName || "").toLowerCase());
  dirUser.set('userPrincipalName', (graphUser.userPrincipalName || "").toLowerCase());
  dirUser.set('department', graphUser.department || "");
  dirUser.set('jobTitle', graphUser.jobTitle || "");
  dirUser.set('officeLocation', graphUser.officeLocation || "");
  dirUser.set('company', graphUser.companyName || "");
  dirUser.set('mobilePhone', graphUser.mobilePhone || "");
  dirUser.set('businessPhones', graphUser.businessPhones || []);
  dirUser.set('accountEnabled', graphUser.accountEnabled !== false);
  dirUser.set('employeeId', graphUser.employeeId || "");
  
  // Note: manager and photoUrl require separate Graph API calls per user or `$expand=manager` in the query
  // For now, if they are returned in the delta query, we map them.
  if (graphUser.manager) {
    dirUser.set('manager', graphUser.manager.displayName || "");
  }
  if (graphUser.photoUrl) {
    dirUser.set('photoUrl', graphUser.photoUrl || "");
  }
  
  dirUser.set('lastSynchronized', new Date());

  await dirUser.save(null, { useMasterKey: true });

  // Update linked Parse.User if it exists
  const email = dirUser.get('email');
  if (email) {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('username', email);
    const parseUser = await userQuery.first({ useMasterKey: true });
    if (parseUser) {
      parseUser.set('Name', dirUser.get('displayName'));
      parseUser.set('JobTitle', dirUser.get('jobTitle'));
      parseUser.set('Department', dirUser.get('department'));
      parseUser.set('OfficeLocation', dirUser.get('officeLocation'));
      parseUser.set('Company', dirUser.get('company'));
      parseUser.set('MobilePhone', dirUser.get('mobilePhone'));
      
      const bPhones = dirUser.get('businessPhones');
      parseUser.set('BusinessPhones', bPhones && bPhones.length > 0 ? bPhones.join(', ') : "");
      
      await parseUser.save(null, { useMasterKey: true });
      
      // Keep pointer to parseUser
      if (!dirUser.get('parseUser') || dirUser.get('parseUser').id !== parseUser.id) {
          dirUser.set('parseUser', parseUser);
          await dirUser.save(null, { useMasterKey: true });
      }
    }
  }

  return action;
}

async function logSyncResult(data) {
  const DirectorySyncLog = Parse.Object.extend('DirectorySyncLog');
  const log = new DirectorySyncLog();
  log.set('syncType', data.syncType);
  log.set('status', data.status);
  log.set('usersProcessed', data.usersProcessed);
  log.set('usersAdded', data.usersAdded);
  log.set('usersUpdated', data.usersUpdated);
  log.set('usersDisabled', data.usersDisabled);
  log.set('durationMs', data.durationMs);
  
  if (data.deltaToken) log.set('deltaToken', data.deltaToken);
  if (data.errorMessage) log.set('errorMessage', data.errorMessage);
  
  await log.save(null, { useMasterKey: true });
}

function getSyncConfig() {
  return {
    tenantId: process.env.MICROSOFT_TENANT_ID || process.env.MICROSOFT_ENTRA_TENANT_ID,
    clientId: process.env.MICROSOFT_CLIENT_ID || process.env.MICROSOFT_ENTRA_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET, // Requires a secret for App-only auth
  };
}
