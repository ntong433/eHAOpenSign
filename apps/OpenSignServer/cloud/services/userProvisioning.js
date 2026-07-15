import crypto from 'node:crypto';
import { processGraphUser } from './entraSyncService.js';

export async function provisionUser(graphUser) {
  const oid = graphUser.id;
  const upn = graphUser.userPrincipalName?.toLowerCase();
  const email = (graphUser.mail || graphUser.userPrincipalName)?.toLowerCase();

  if (!email && !upn && !oid) {
    throw new Error('Missing identity claims in Microsoft profile.');
  }

  // 1. Try to find by oid in DirectoryUser
  let user = null;
  const dirUserQuery = new Parse.Query('DirectoryUser');
  dirUserQuery.equalTo('microsoftObjectId', oid);
  dirUserQuery.include('parseUser');
  const dirUser = await dirUserQuery.first({ useMasterKey: true });
  if (dirUser && dirUser.get('parseUser')) {
    user = dirUser.get('parseUser');
  }

  // 2. Try to find by UPN
  if (!user && upn) {
    const upnQuery = new Parse.Query(Parse.User);
    upnQuery.equalTo('UPN', upn);
    user = await upnQuery.first({ useMasterKey: true });
  }

  // 3. Try to find by Email or Username
  if (!user && email) {
    const emailQuery = new Parse.Query(Parse.User);
    emailQuery.equalTo('username', email);
    user = await emailQuery.first({ useMasterKey: true });
    
    if (!user) {
      const altEmailQuery = new Parse.Query(Parse.User);
      altEmailQuery.equalTo('email', email);
      user = await altEmailQuery.first({ useMasterKey: true });
    }
  }

  console.log("=== MSAL TRACE: Existing Parse user found ===", user ? "Yes" : "No");

  const userDataToUpdate = {
    Name: graphUser.displayName || "",
    Email: email,
    UPN: graphUser.userPrincipalName || "",
    JobTitle: graphUser.jobTitle || "",
    Department: graphUser.department || "",
    OfficeLocation: graphUser.officeLocation || "",
    Manager: graphUser.managerNode?.displayName || "",
    MobilePhone: graphUser.mobilePhone || "",
    BusinessPhones: graphUser.businessPhones && graphUser.businessPhones.length > 0 ? graphUser.businessPhones.join(", ") : "",
    Company: graphUser.companyName || "",
    EmployeeID: graphUser.employeeId || "",
  };

  if (user) {
    Object.keys(userDataToUpdate).forEach(key => {
      if (userDataToUpdate[key] !== undefined && userDataToUpdate[key] !== null) {
        user.set(key, userDataToUpdate[key]);
      }
    });
    await user.save(null, { useMasterKey: true });
    console.log("=== MSAL TRACE: User profile updated ===");
  } else {
    user = new Parse.User();
    user.set('username', email);
    user.set('email', email);
    user.set('password', crypto.randomBytes(16).toString('hex'));
    user.set('normalizedEmail', email);
    
    Object.keys(userDataToUpdate).forEach(key => {
      if (userDataToUpdate[key] !== undefined && userDataToUpdate[key] !== null) {
        user.set(key, userDataToUpdate[key]);
      }
    });
    
    await user.signUp(null, { useMasterKey: true });
    console.log("=== MSAL TRACE: User provisioned ===");
  }

  // Ensure extended user (contracts_Users) exists
  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  let extUser = await extQuery.first({ useMasterKey: true });

  if (!extUser) {
    // Create Tenant
    const partnerCls = Parse.Object.extend('partners_Tenant');
    const partnerQuery = new partnerCls();
    partnerQuery.set('UserId', {
      __type: 'Pointer',
      className: '_User',
      objectId: user.id,
    });
    partnerQuery.set('TenantName', graphUser.companyName || 'LHI Nigeria');
    partnerQuery.set('EmailAddress', email);
    partnerQuery.set('IsActive', true);
    partnerQuery.set('CreatedBy', {
      __type: 'Pointer',
      className: '_User',
      objectId: user.id,
    });
    const tenantRes = await partnerQuery.save(null, { useMasterKey: true });

    // Create Extended User
    const extCls = Parse.Object.extend('contracts_Users');
    extUser = new extCls();
    extUser.set('UserId', {
      __type: 'Pointer',
      className: '_User',
      objectId: user.id,
    });
    extUser.set('UserRole', 'contracts_User');
    extUser.set('Email', email);
    extUser.set('Name', graphUser.displayName || '');
    extUser.set('TenantId', {
      __type: 'Pointer',
      className: 'partners_Tenant',
      objectId: tenantRes.id,
    });
    extUser.set('Company', graphUser.companyName || 'LHI Nigeria');
    extUser.set('JobTitle', graphUser.jobTitle || 'Employee');
    
    await extUser.save(null, { useMasterKey: true });
  } else {
    // Update existing extUser — always ensure UserRole is set
    extUser.set('Name', graphUser.displayName || '');
    extUser.set('Company', graphUser.companyName || 'LHI Nigeria');
    extUser.set('JobTitle', graphUser.jobTitle || 'Employee');
    extUser.set('Email', email);
    // Preserve existing role or default to contracts_User so menu lookup succeeds
    if (!extUser.get('UserRole')) {
      extUser.set('UserRole', 'contracts_User');
    }
    await extUser.save(null, { useMasterKey: true });
  }
  
  // Re-run processGraphUser now that Parse.User exists, so it links them.
  await processGraphUser(graphUser);

  return user;
}
