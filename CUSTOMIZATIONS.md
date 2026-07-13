# Customizations

This fork uses an isolated enterprise custom layer instead of scattering
organization-specific code through upstream OpenSign.

## Added Files

- `config/*.json`: non-secret organization, branding, feature, auth, workflow,
  database, and permission configuration.
- `custom/api`: enterprise Express routes with consistent responses and audit
  middleware.
- `custom/branding`: browser branding helpers.
- `custom/services`: shared configuration and audit services.
- `custom/modules`: initial HR, workflow, notification, audit, organization,
  legal, integration, and permission module boundaries.
- `custom/tests`: Node tests for the custom layer.

## Upstream Files Touched

- `apps/OpenSignServer/cloud/customRoute/customApp.js`: mounts the enterprise
  router under `/enterprise`.
- `apps/OpenSign/vite.config.js`: exposes the root `custom` directory as the
  `@custom` alias.
- `apps/OpenSign/src/index.jsx`: applies enterprise branding variables at
  startup.
- `apps/OpenSign/src/constant/appinfo.js`: reads configurable logo, favicon,
  app name, and metadata defaults.
- `apps/OpenSign/src/components/Title.jsx`: uses configurable product name and
  favicon for the document title and manifest.
- `apps/OpenSign/src/components/Footer.jsx`: uses configurable product name and
  release notes URL.
- `apps/OpenSign/src/pages/Login.jsx`: uses configurable product name for login
  error messaging.
- `.env.example`: documents enterprise branding and Microsoft Entra variables.

## Upgrade Considerations

Keep future features inside `custom` first. If an upstream file must change,
add the smallest possible import or adapter and document it here.
