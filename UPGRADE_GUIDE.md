# Upgrade Guide

Use this process when pulling new OpenSign upstream changes.

1. Create an upgrade branch from the current main branch.
2. Fetch upstream OpenSign.
3. Merge or rebase upstream into the upgrade branch.
4. Resolve conflicts by preserving upstream behavior first.
5. Re-apply only the documented custom hooks if needed.
6. Run custom tests with `npm --prefix custom test`.
7. Run frontend and backend tests affected by upstream changes.
8. Update `CUSTOMIZATIONS.md` and `CHANGELOG.md`.

## Conflict Hotspots

- `apps/OpenSignServer/cloud/customRoute/customApp.js`
- `apps/OpenSign/vite.config.js`
- `apps/OpenSign/src/index.jsx`
- `apps/OpenSign/src/constant/appinfo.js`
- `apps/OpenSign/src/components/Title.jsx`
- `apps/OpenSign/src/components/Footer.jsx`
- `apps/OpenSign/src/pages/Login.jsx`

If upstream introduces official plugin hooks for any of these areas, migrate
the custom layer to those hooks and remove the direct edits.
