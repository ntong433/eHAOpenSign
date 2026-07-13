// Removed node-fetch to use native fetch for IPv4/IPv6 Happy Eyeballs support

import axios from 'axios';
import https from 'https';

export async function fetchGraphProfile(accessToken) {
  console.log("=== GRAPH REQUEST ===");
  
  if (!accessToken || accessToken === '[object Object]') {
    throw new Error("Invalid access token provided.");
  }

  console.log("Access token present:", Boolean(accessToken));

  // Step 5 - Validate the Access Token
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      console.log("--- DECODED TOKEN CLAIMS ---");
      console.log("aud:", payload.aud);
      console.log("iss:", payload.iss);
      console.log("tid:", payload.tid);
      console.log("exp:", payload.exp);
      console.log("----------------------------");
      
      const allowedAudiences = ['https://graph.microsoft.com', 'https://graph.microsoft.com/', '00000003-0000-0000-c000-000000000000'];
      if (!allowedAudiences.includes(payload.aud)) {
        throw new Error(`Token audience is invalid. Expected Microsoft Graph, got: ${payload.aud}`);
      }
    }
  } catch(e) {
    if (e.message.includes('audience is invalid')) throw e;
    console.log("Failed to decode token claims:", e.message);
  }

  const fields = 'displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones,companyName,employeeId';
  const url = `https://graph.microsoft.com/v1.0/me?$select=${fields}`;
  
  console.log("Graph URL:", url);
  const headers = { 'Authorization': `Bearer ${accessToken}` };
  console.log("Headers:", Object.keys(headers));

  // Step 6 - Confirm Authorization Header
  if (!headers['Authorization'] || headers['Authorization'].includes('undefined') || headers['Authorization'].includes('null')) {
    throw new Error("Authorization header is malformed. Missing Bearer token.");
  }

  let graphResponse;
  
  // Use custom HTTPS agent forcing IPv4 to prevent Node.js 20 ETIMEDOUT bugs
  const httpsAgent = new https.Agent({ family: 4 });

  try {
    graphResponse = await axios.get(url, {
      headers: headers,
      timeout: 10000, // 10 seconds timeout
      httpsAgent: httpsAgent
    });
  } catch (error) {
    console.error("========== GRAPH ERROR ==========");
    console.error("error.message:", error.message);
    console.error("error.code:", error.code);
    console.error("error.name:", error.name);
    console.error("error.stack:", error.stack);
    
    if (error.response) {
      console.error("error.response.status:", error.response.status);
      console.error("error.response.statusText:", error.response.statusText);
      console.error("error.response.data:", error.response.data);
      console.error("error.response.headers:", error.response.headers);
    }
    
    if (error.config) {
      console.error("error.config.url:", error.config.url);
      console.error("error.config.method:", error.config.method);
    }

    if (error.errors) {
      console.error("error.errors:", error.errors);
    }
    console.error("=================================");

    const structuredError = new Error("Microsoft Graph request failed");
    structuredError.details = {
      success: false,
      step: "Microsoft Graph",
      url: error.config?.url || url,
      status: error.response?.status || 500,
      axiosCode: error.code,
      networkError: error.message,
      message: "Microsoft Graph request failed",
      response: error.response?.data || null,
      stack: error.stack
    };
    throw structuredError;
  }

  const graphUser = graphResponse.data;

  let manager = null;
  try {
    const managerResponse = await axios.get('https://graph.microsoft.com/v1.0/me/manager?$select=displayName,mail', {
      headers: headers,
      timeout: 10000,
      httpsAgent: httpsAgent
    });
    manager = managerResponse.data;
  } catch (e) {
    // Ignore manager fetch errors
  }

  graphUser.managerNode = manager;
  console.log("=== MSAL TRACE: Graph profile loaded ===");
  return graphUser;
}
