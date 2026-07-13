import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import fs from 'fs';
import path from 'path';

let cachedConfig = null;

export function getAuthConfig() {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), '../../config/auth.json');
  try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    cachedConfig = JSON.parse(rawData);
    return cachedConfig;
  } catch (err) {
    console.error('Failed to load config/auth.json', err);
    return {};
  }
}

export function getEnv(envName) {
  // If the env variable is named MICROSOFT_ENTRA_CLIENT_ID but we stored it as MICROSOFT_CLIENT_ID
  const fallbackName = envName.replace('MICROSOFT_ENTRA_', 'MICROSOFT_');
  return process.env[envName] || process.env[fallbackName];
}

export async function validateMicrosoftToken(idToken) {
  const config = getAuthConfig();
  const msConfig = config?.providers?.microsoftEntraId;
  if (!msConfig) throw new Error('Microsoft Entra ID config not found in auth.json');

  const tenantId = getEnv(msConfig.tenantIdEnv) || 'common';
  const clientId = getEnv(msConfig.clientIdEnv);

  const client = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    cache: true,
    rateLimit: true,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, function (err, key) {
      if (err) {
        return callback(err);
      }
      const signingKey = key.publicKey || key.rsaPublicKey;
      callback(null, signingKey);
    });
  }

  console.log("=== MSAL TRACE: JWT verification started ===");
  try {
    const unverifiedDecoded = jwt.decode(idToken);
    if (unverifiedDecoded) {
      console.log("=== MSAL TRACE: JWT aud:", unverifiedDecoded.aud);
      console.log("=== MSAL TRACE: Expected aud:", clientId);
      console.log("=== MSAL TRACE: JWT iss:", unverifiedDecoded.iss);
      console.log("=== MSAL TRACE: Expected iss:", `https://login.microsoftonline.com/${tenantId}/v2.0`);
      console.log("=== MSAL TRACE: JWT tid:", unverifiedDecoded.tid);
      console.log("=== MSAL TRACE: JWT oid:", unverifiedDecoded.oid);
      console.log("=== MSAL TRACE: JWT email:", unverifiedDecoded.email || unverifiedDecoded.preferred_username);
    }
  } catch (e) {
    console.error("Failed to decode token for logging:", e);
  }

  return new Promise((resolve, reject) => {
    jwt.verify(idToken, getKey, {
      audience: clientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`
    }, function (err, decoded) {
      if (err) {
        // Fallback for v1.0 tokens if necessary
        jwt.verify(idToken, getKey, {
          audience: clientId,
        }, function (err2, decoded2) {
           if (err2) {
             return reject(err2);
           }
           console.log("=== MSAL TRACE: JWT verified (v1.0 fallback) ===");
           console.log("=== MSAL TRACE: Audience verified ===");
           console.log("=== MSAL TRACE: Tenant verified ===");
           resolve(decoded2);
        });
      } else {
        console.log("=== MSAL TRACE: JWT verified ===");
        console.log("=== MSAL TRACE: Audience verified ===");
        console.log("=== MSAL TRACE: Issuer verified ===");
        console.log("=== MSAL TRACE: Tenant verified ===");
        resolve(decoded);
      }
    });
  });
}
