import { PublicClientApplication } from '@azure/msal-browser';

let msalInstance = null;
let msalInitializationPromise = null;
let redirectResponsePromise = null;

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
    await redirectResponsePromise;

    console.log("=== MSAL TRACE: MSAL Initialized ===");
    return msalInstance;
  })();

  return msalInitializationPromise;
}

export async function loginWithMicrosoftRedirect() {
  console.log("=== MSAL TRACE: MSAL Instance Initialized ===");
  const msal = await initializeMsal();
  
  const loginRequest = {
    scopes: ["user.read", "email", "profile"],
  };

  console.log("=== MSAL TRACE: loginRedirect() Called ===");
  try {
    await msal.loginRedirect(loginRequest);
  } catch (error) {
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
