export const AUTH_PROVIDER_TYPES = {
  LOCAL_ADMINISTRATOR: 'localAdministrator',
  MICROSOFT_ENTRA_ID: 'microsoftEntraId'
};

export function isAuthProviderEnabled(authConfig, provider) {
  return Boolean(authConfig?.providers?.[provider]?.enabled);
}
