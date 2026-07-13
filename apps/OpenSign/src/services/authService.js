import Parse from 'parse';

export async function authenticateWithMicrosoftBackend(idToken, accessToken) {
  try {
    const sessionResponse = await Parse.Cloud.run('loginWithMicrosoft', {
      idToken,
      accessToken,
    });

    if (!sessionResponse || !sessionResponse.sessionToken) {
      throw new Error('Invalid session response from backend.');
    }

    return sessionResponse;
  } catch (error) {
    console.error('Backend Microsoft auth failed:', error);
    throw error;
  }
}
