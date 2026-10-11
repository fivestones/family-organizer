# Dependency maintenance

Requested on 12 October 2026 after Docker's `npm ci` reported deprecated dependencies. [Scope 0 in the roadmap](../roadmap.md#scope-0--dependency-maintenance) owns the work order and completion status.

## Acceptance checks

Critical updates must leave no critical findings in a fresh whole-monorepo `npm audit --json`, including optional, mobile and development dependencies. Prefer compatible parent updates; use a narrowly scoped override only after checking the parent's API compatibility. Do not apply `npm audit fix --force` or suppress warnings to claim a fix. Preserve npm's committed lockfile and reproducible `npm ci` installs.

Run `tsc --noEmit` explicitly (the Next configuration currently skips build type errors), the existing unit/integration suites, and a production build. When overriding a transitive dependency across a major version, verify the actual caller as well as the application tests. Record versions, audit results, checks and any limits below. Commit each completed piece of work.

The remaining cleanup must keep the web app, calendar worker, attachments and mobile app functional. Docker workspace filtering needs a clean install and image build; PDF changes need a matching worker and a browser preview/highlighting check; Expo changes need its compatible React/React Native versions plus lint, typechecks and bundling. Device-only verification stays explicitly open.

## Initial findings

The current Docker dependencies stage installs every npm workspace, including mobile. React Native and Expo tooling bring older `glob`, `inflight` and `rimraf` versions. `pdfjs-dist@4.4.168`, also pinned by `react-pdf-highlighter@8.0.0-rc.0`, optionally installs `canvas@2.11.2`; its `@mapbox/node-pre-gyp` chain brings `gauge`, `are-we-there-yet`, `npmlog`, `rimraf` and `tar@6`. `react-beautiful-dnd` remains a direct dependency although current drag-and-drop imports use Pragmatic Drag and Drop.

The initial whole-monorepo npm audit flagged six package entries as critical: `next`, `fast-xml-parser`, `tar`, `shell-quote`, `vitest` and `@vitest/coverage-v8`. XML parser copies exist in the root app, AWS SDK and MinIO. Audit counts include inherited findings and do not establish that each advisory is reachable in production. High, moderate and low findings remain a separate roadmap item.

## Implementation log

No dependency changes yet.
