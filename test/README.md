# Testing Guide

This repo now uses a layered test strategy:

- `Vitest` for unit, integration, contract, and DOM/component tests
- `Playwright` for end-to-end browser smoke tests

## Test layout

- `test/unit/**` : pure logic/helpers
- `test/integration/**` : route handlers, middleware, API handlers, file-system interactions
- `test/contracts/**` : policy/permission/schema coverage checks (regression guards)
- `test/dom/**` : React component behavior tests (jsdom)
- `e2e/**` : real browser flows (Playwright)

## Naming conventions

- `*.node.test.ts` / `*.node.test.tsx`
  - Runs in Node environment (default)
- `*.dom.test.ts` / `*.dom.test.tsx`
  - Add `// @vitest-environment jsdom` at the top of the file

## Scripts

- `npm test` : run Vitest suites
- `npm run test:watch` : Vitest watch mode
- `npm run test:coverage` : Vitest with coverage
- `npm run test:e2e` : Playwright E2E tests
- `npm run test:e2e:install` : install Chromium for Playwright
- `npm run test:perms:live` : hosted Instant permissions smoke matrix (anonymous/kid/parent). Mutates and cleans up small temp rows.
- `npm run test:all` : Vitest + Playwright

## What to test for new features

For most new features, add tests in this order:

1. Unit test for new logic/helpers
2. Integration test for server route/action behavior and auth checks
3. Contract test if the feature changes Instant schema/perms/security assumptions
4. E2E test only for key user-visible flows

## Security-focused additions (important in this app)

When changing auth, permissions, or file handling, add at least:

- Unauthorized request test
- Authorized request test
- One malformed-input test
- One regression test for the intended security property (for example, audit stamp required)

## Hosted Instant perms smoke test

`npm run test:perms:live` is a real hosted-app check that validates the current pushed `instant.perms.ts`
behavior using:

- anonymous client (should be denied)
- kid principal token (shared kid principal)
- parent principal token

It is env-gated and safe by default (`RUN_LIVE_INSTANT_PERMS=1` is set by the script). It creates and
deletes a small number of temporary records for validation.
