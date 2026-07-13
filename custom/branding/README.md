# Branding

Branding values are loaded from `config/branding.json` on the server and from
runtime or build-time variables in the browser.

Browser override options:

- `window.RUNTIME_ENV.BRANDING`
- `window.RUNTIME_ENV.ENTERPRISE_BRANDING`
- `REACT_APP_ENTERPRISE_BRANDING_JSON`
- Individual `REACT_APP_ENTERPRISE_*` variables

Keep binary assets in `custom/assets` or an external asset store and reference
them by URL.
