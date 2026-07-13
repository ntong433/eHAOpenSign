

export async function isAdministrator(user) {
  if (!user) return false;

  console.log("=== AUTH DEBUG ===");
  console.log("request.user =", user);
  console.log("user id =", user.id);
  console.log("username =", user.get("username"));
  console.log("email =", user.get("email"));
  
  // 1. Check contracts_Users administrator mapping.
  const callerQuery = new Parse.Query('contracts_Users');
  callerQuery.equalTo('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  callerQuery.notEqualTo('IsDisabled', true);
  const callerExtUser = await callerQuery.first({ useMasterKey: true });
  
  if (callerExtUser) {
    const callerRole = callerExtUser.get('UserRole');
    if (callerRole === 'contracts_Admin' || callerRole === 'contracts_OrgAdmin') {
      console.log("Admin resolved via contracts_Users");
      return true;
    }
  }

  // 2. Check AdminUsers Class (Fallback/Custom)
  try {
    const AdminUsers = Parse.Object.extend('AdminUsers');
    const adminQuery = new Parse.Query(AdminUsers);
    adminQuery.equalTo('userId', user.id);
    adminQuery.equalTo('active', true);
    const adminRec = await adminQuery.first({ useMasterKey: true });
    if (adminRec) {
      console.log("Admin resolved via AdminUsers class");
      return true;
    }
  } catch (err) {
    // Class might not exist, ignore
  }

  // 3. Check Parse.Role (Native Parse Roles)
  try {
    const roleQuery = new Parse.Query(Parse.Role);
    roleQuery.equalTo('users', user);
    roleQuery.containedIn('name', ['Administrator', 'Admin', 'SuperAdmin', 'admin']);
    const roleRec = await roleQuery.first({ useMasterKey: true });
    if (roleRec) {
      console.log("Admin resolved via Parse.Role:", roleRec.get('name'));
      return true;
    }
  } catch (err) {
    // Ignore error
  }

  console.log("User is NOT an administrator.");
  return false;
}
