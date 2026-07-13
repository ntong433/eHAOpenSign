import { validateMicrosoftToken, getAuthConfig } from '../services/tokenValidator.js';
import { fetchGraphProfile } from '../services/microsoftGraph.js';
import { provisionUser } from '../services/userProvisioning.js';
import { createSessionForUser } from '../services/sessionService.js';

export async function loginWithMicrosoft(request) {
  let currentStep = "Initialization";
  try {
    console.log("STEP 1 - Request received");
    const { idToken, accessToken, profile, tenantId, clientId } = request.params;
    console.log("Received Microsoft login request:", {
      hasIdToken: Boolean(idToken),
      hasAccessToken: Boolean(accessToken),
      tenantId,
      clientId,
      profileEmail: profile?.email || profile?.userPrincipalName || profile?.username || null,
    });
    
    if (!idToken || !accessToken) {
      throw new Error("Missing required parameters: accessToken and idToken are required.");
    }
    
    console.log("STEP 2 - Access token received");

    currentStep = "Configuration loading";
    const config = getAuthConfig();
    const msConfig = config?.providers?.microsoftEntraId;
    if (!msConfig || !msConfig.enabled) {
      throw new Error("Microsoft authentication is disabled.");
    }

    currentStep = "Token validation";
    console.log("STEP 3 - Token validated");
    await validateMicrosoftToken(idToken);

    currentStep = "Microsoft Graph loading";
    console.log("STEP 4 - Microsoft Graph profile loaded");
    const graphUser = await fetchGraphProfile(accessToken);

    currentStep = "Parse user lookup";
    console.log("STEP 5 - Parse user lookup");
    const user = await provisionUser(graphUser);

    currentStep = "Admin lookup";
    console.log("STEP 6 - Admin lookup");
    // Admin lookup can happen after user provisioning if needed, currently not blocking login.

    currentStep = "Parse session creation";
    console.log("STEP 7 - Parse session creation");
    const sessionResponse = await createSessionForUser(user);
    
    console.log("STEP 8 - Returning response");
    return sessionResponse;

  } catch(error) {
    console.error(`LOGIN WITH MICROSOFT FAILED at step: ${currentStep}`);
    console.error(error);
    console.error(error.stack);
    
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, JSON.stringify({
      success: false,
      step: currentStep,
      message: "Microsoft authentication pipeline failed",
      details: error.message,
      stack: error.stack
    }));
  }
}
