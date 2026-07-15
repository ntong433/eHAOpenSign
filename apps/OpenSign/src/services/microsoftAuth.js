import { PublicClientApplication } from '@azure/msal-browser';

let msalInstance = null;
let msalInitializationPromise = null;
let redirectResponsePromise = null;

function isStaleAuthorizationError(error) {
  const message = `${error?.errorCode || ''} ${error?.message || ''}`;
  return (
    message.includes('invalid_grant') ||
    message.includes('AADSTS70008') ||
    message.includes('authorization code')
  );
}

async function resetStaleMicrosoftTransaction() {
  if (msalInstance) {
    await msalInstance.clearCache().catch(() => undefined);
  }

  msalInstance = null;
  msalInitializationPromise = null;
  redirectResponsePromise = null;

  if (
    window.location.pathname.includes('/auth/microsoft/callback') ||
    window.location.search ||
    window.location.hash
  ) {
    window.history.replaceState({}, document.title, '/');
  }
}

export async function initializeMsal() {
  if (msalInitializationPromise) return msalInitializationPromise;

  msalInitializationPromise = (async () => {
    console.log("=== MSAL TRACE: Initializing MSAL ===");
    const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
    const tenantId = import.meta.env.VITE_MICROSOFT_TENANT_ID;
    const redirectUri = import.meta.env.VITE_MICROSOFT_REDIRECT_URI;

    if (!clientId || !tenantId) {
      console.error("Missing Microsoft Entra ID configuration in environment variables.");
    }

    const msalConfig = {
      auth: {
        clientId: clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: redirectUri,
        navigateToLoginRequestUrl: false
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    };

    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // MSAL requires redirect state to be processed before any new interactive
    // request. Running this on initialization also clears an abandoned redirect
    // marker when a callback was interrupted or landed on the wrong route.
    redirectResponsePromise = msalInstance.handleRedirectPromise();
    try {
      await redirectResponsePromise;
    } catch (error) {
      // Do not retain a rejected initialization promise. Otherwise every later
      // click retries the same expired/redeemed authorization response.
      msalInitializationPromise = null;
      throw error;
    }

    console.log("=== MSAL TRACE: MSAL Initialized ===");
    return msalInstance;
  })();

  return msalInitializationPromise;
}

export async function loginWithMicrosoftRedirect() {
  console.log("=== MSAL TRACE: MSAL Instance Initialized ===");
  const loginRequest = {
    scopes: ["user.read", "email", "profile"],
    prompt: "select_account",
  };

  console.log("=== MSAL TRACE: loginRedirect() Called ===");
  try {
    const msal = await initializeMsal();
    await msal.loginRedirect(loginRequest);
  } catch (error) {
    if (isStaleAuthorizationError(error)) {
      console.warn("Discarding stale Microsoft authorization response and restarting login.");
      await resetStaleMicrosoftTransaction();
      const msal = await initializeMsal();
      await msal.loginRedirect(loginRequest);
      return;
    }
    console.error("Microsoft redirect login failed:", error);
    throw error;
  }
}

export async function checkRedirectCallback() {
  console.log("=== MSAL TRACE: handleRedirectPromise started ===");
  try {
    await initializeMsal();
    const response = await redirectResponsePromise;
    console.log("=== MSAL TRACE: handleRedirectPromise completed ===");
    if (response) {
      console.log("=== MSAL TRACE: AuthenticationResult received ===");
      console.log("=== MSAL TRACE: Access token acquired ===", response.accessToken ? "Yes" : "No");
      return {
        idToken: response.idToken,
        accessToken: response.accessToken,
        account: response.account,
      };
    }
  } catch (error) {
    console.error("Redirect callback error:", error);
    throw error;
  }
  return null;
}
