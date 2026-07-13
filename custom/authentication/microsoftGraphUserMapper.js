export function mapMicrosoftGraphUser(graphUser = {}, manager = null) {
  return {
    displayName: graphUser.displayName || '',
    email: graphUser.mail || graphUser.userPrincipalName || '',
    jobTitle: graphUser.jobTitle || '',
    department: graphUser.department || '',
    office: graphUser.officeLocation || '',
    manager: manager
      ? {
          id: manager.id || '',
          displayName: manager.displayName || '',
          email: manager.mail || manager.userPrincipalName || ''
        }
      : null,
    employeeId: graphUser.employeeId || '',
    userPrincipalName: graphUser.userPrincipalName || '',
    mobileNumber: graphUser.mobilePhone || '',
    businessPhones: graphUser.businessPhones || [],
    companyName: graphUser.companyName || ''
  };
}
