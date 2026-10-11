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

### 12 October 2026 — Critical findings resolved

Updated Next.js from 16.0.6 to 16.4.0; the direct XML parser from 5.4.2 to 5.11.2; the three direct AWS S3 SDK packages from 3.940.0 to 3.1149.0; MinIO from 8.0.6 to 8.0.7; and Vitest plus V8 coverage from 4.0.18 to 4.1.11. AWS and MinIO now resolve the patched 5.11.2 XML parser as well. Next's required PostCSS dependency resolves to 8.5.23, and the TypeScript module resolution setting now explicitly uses `bundler`, as required by the updated Next build.

The PDF renderer still pins `canvas@2.11.2`. A scoped `canvas` → `@mapbox/node-pre-gyp@^2.0.3` override upgrades its installation helper rather than forcing tar 7 into a caller written for tar 6. The helper's [2.0 changelog](https://github.com/mapbox/node-pre-gyp/blob/master/CHANGELOG.md) declares Node 18+ support, tar 7, and the replacement of the obsolete logging chain. A `tar@^7.5.22` override keeps both this helper and Expo's existing tar 7 caller on the patched release. The inherited `shell-quote` resolves to 1.12.0. Remove the helper override when the PDF stack no longer depends on the old canvas package. The broad PDF and Expo migrations remain open.

The final whole-monorepo `npm audit --json` reported **0 critical, 41 high, 23 moderate and 2 low** package findings. The remaining advisories are not waived; reviewing their dependency paths and reachable code is the next Scope 0 item. Deprecated lockfile entries now consist of `glob@7`, `inflight`, `rimraf@3` and `react-beautiful-dnd`. The patched Next build also warns about React 18 support and the `middleware` convention; their migrations are now tracked in the roadmap.

Validation passed: a clean `npm ci` of the final lockfile; `tsc --noEmit`; 144 test files / 1,074 tests passing with five pre-existing skips, both locally and in the Docker builder on Node 20.20.2; and a seven-test CalDAV client run with the updated V8 coverage provider. Local Node 25 enables a native Web Storage implementation that conflicts with the DOM test environment, so the successful local command was `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=4`. The Docker suite passed without that workaround using `npm test -- --maxWorkers=2`.

The install-helper compatibility check invoked canvas's `node-pre-gyp install --fallback-to-build --update-binary` command against a local archive fixture, verified tar extraction and `find()` binary-path resolution, and passed with helper 2.0.3 / tar 7.5.22. This checks installer API compatibility, not native canvas rendering. A production Docker build from tracked source and the final changed files passed, using a dummy public Instant app ID and no local credentials. Its container passed health, unauthorized device blocking, activation-cookie and authenticated countdown-page checks; the calendar worker sent the expected authenticated cron request to a local stub. No live backend, device, or deployment was changed.
