# Architecture

## Goal

The enterprise layer extends OpenSign while preserving upstream compatibility.
OpenSign remains the signing engine; enterprise modules wrap and extend it.

## Boundaries

- Upstream OpenSign code stays responsible for current document creation,
  signing, Parse Server setup, and existing UI routes.
- `custom` owns enterprise branding, authentication adapters, workflows,
  organization models, HR templates, notifications, audit, permissions, and
  integrations.
- `config` owns deployment-specific behavior and brand values.

## Backend Extension

OpenSign already mounts `cloud/customRoute/customApp.js`. The enterprise layer
uses that hook to mount `custom/api` at `/enterprise`.

Every enterprise endpoint should:

- validate input,
- authorize the caller,
- return `{ success, data, meta }` or `{ success, error }`,
- record an audit event,
- avoid direct dependence on upstream internals unless wrapped by a service.

## Frontend Extension

Vite resolves `@custom` to the root `custom` directory. UI customizations should
use this alias and wrap upstream components where possible.

Branding currently initializes through `custom/branding/frontend.js`. Future UI
work should move repeated brand reads into custom hooks and avoid hardcoded
organization values.

## Data Strategy

Custom Parse classes use names from `config/database.json`. This keeps the class
prefix configurable and avoids unnecessary upstream table changes.

## Module Roadmap

1. Branding and configuration.
2. Microsoft Entra ID authentication and Graph synchronization.
3. Organization directory and RBAC.
4. HR templates and placeholder engine.
5. Workflow engine.
6. Enterprise dashboard, notifications, audit expansion, and integrations.
