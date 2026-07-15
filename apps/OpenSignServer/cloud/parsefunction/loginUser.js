const normalizeIdentity = value =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export default async function loginUser(request) {
  const identity = normalizeIdentity(request.params.email || request.params.username);
  const password = request.params.password;

  if (identity && typeof password === 'string' && password.length > 0) {
    let identityFound = false;
    try {
      const usernameQuery = new Parse.Query(Parse.User);
      usernameQuery.equalTo('username', identity);
      const emailQuery = new Parse.Query(Parse.User);
      emailQuery.equalTo('email', identity);
      const matchedUser = await Parse.Query.or(usernameQuery, emailQuery).first({
        useMasterKey: true,
      });
      identityFound = Boolean(matchedUser);
      const username = matchedUser?.get('username') || identity;

      // Password bytes are passed through exactly as submitted.
      const user = await Parse.User.logIn(username, password);
      if (user) {
        const _user = user?.toJSON();
        return {
          ..._user,
        };
      } else {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'user not found.');
      }
    } catch (err) {
      console.warn('Local login failed', { code: err?.code, identityFound });
      throw err;
    }
  } else {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'username/password is missing.');
  }
}
