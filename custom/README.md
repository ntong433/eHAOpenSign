# Enterprise Custom Layer

This directory is the upgrade-safe home for enterprise customizations.

Goals:

- Keep organization-specific behavior outside upstream OpenSign files.
- Add features through adapters, routers, hooks, services, and configuration.
- Keep unavoidable upstream edits small and documented.

Current extension points:

- `custom/api` exposes enterprise Express routes mounted by OpenSign's existing
  custom route app.
- `custom/branding` exposes browser-side branding helpers.
- `custom/services` contains shared service helpers for configuration and audit.
- `custom/modules` contains domain modules that can be enabled over time.

Run custom tests with:

```sh
npm --prefix custom test
```
