# Audit: Remaining Areas — Shell/PWA, Files & Server Actions, Messages, Calendar, History, Mobile API, Misc

**Date:** 2026-07-13
**Scope:** everything not covered by the three prior audits ([task series/login/nav](audit-2026-07-task-series-login-nav.md), [chores](audit-2026-07-chores.md), [finance](audit-2026-07-finance-allowance.md)): service worker & PWA, S3/file server actions, messaging backend, calendar & CalDAV sync, history system, content queue, mobile API surface, docs/test hygiene.
**Method:** static review; targeted reads rather than exhaustive (Calendar.tsx alone is ~4,600 lines — see §4).

---

## Implementation progress

- **2026-07-14 — Completed: member/parent authorization for file operations (§1, fix plan 1).** Every file server action now requires both the activated-device credential and a server-verified Instant family-member token. Generic upload/finalization is member-gated; bucket listing, object deletion, avatar mutation, file-list refresh, and PIN hashing are parent-only. The `/files` page loads its listing on the client only after `ParentGate` establishes the active principal, and the multipart avatar fallback sends the same token and rejects non-parents before parsing the request or touching S3. Uploads now use sanitized basenames, an explicit safe content-type allowlist, and an exact signed `Content-Type` condition. Verification: 34 focused action/component/auth/route tests pass, including invalid, unlinked, deleted-member, and kid-token cases; `tsc --noEmit` passes.
- **2026-07-14 — Completed and deployed: family-member row/field permission isolation (§6, fix plan 4/8/11).** A kid principal can update the safe preference allowlist only on the family-member row named by its authenticated `$user.familyMemberId`; shared kid principals cannot update any member row. `pinHash` is now visible only to parents or that same authenticated member, so siblings' hashes are no longer readable. The CEL uses the list-safe `data.id in auth.ref(...)` form so principals without a linked member do not throw. Permissions were pushed to the configured Instant app. The live matrix now creates isolated anonymous/shared-kid/member-kid/parent clients, verifies empty anonymous reads, sibling hash redaction, own safe updates, and sibling update rejection, and cleans up mutations. Verification: 5 local contract tests, `tsc --noEmit`, and the live hosted permission matrix all pass.
- **2026-07-13 — Completed: production time-machine gate (§3).** The pre-hydration `Date` patch and the debug widget now share `isTimeMachineEnabled`: development/test remain enabled, production emits neither unless `NEXT_PUBLIC_ENABLE_TIME_MACHINE=true` is explicitly configured. The widget also skips initialization while disabled. Verification: 8 bootstrap/widget tests cover the production default, explicit opt-in, and existing controls; `tsc --noEmit` passes.
- **2026-07-13 — Completed: safe service-worker caching (§2).** Runtime caching is now limited to `/_next/static/` and the explicit app-shell assets; `/files/*` and arbitrary same-origin extension matches are never intercepted. Both navigation and static strategies cache only successful, same-origin, non-redirected basic responses. Cache version `family-organizer-v2` flushes previously poisoned entries on activation. Verification: 5 cache-policy tests cover signed-file exclusion, error/redirect/CORS rejection, and the valid static path; `tsc --noEmit` passes.
- **2026-07-13 — Completed: repository TypeScript baseline restored (§8).** Fixed the web/React-Native ambient `FormData` collision at the avatar-upload route boundary and typed browser idle/animation timers with `window.setTimeout` return values instead of `NodeJS.Timeout`. `npx tsc --noEmit` now passes. The focused `AuthProvider` DOM suite passes all 4 tests under the bundled Node 24 runtime; system Node 25's incomplete experimental `localStorage` emitted an environment-only failure before the same suite ran cleanly on the supported runtime.
- **2026-07-13 — Completed related device-auth WIP.** The cross-cutting web cookie and server request checks now validate an access-key-derived token, LAN/public-suffix hosts no longer receive invalid `Domain` attributes, and an explicit `DEVICE_AUTH_COOKIE_DOMAIN` option covers sibling-subdomain deployments. All 70 focused auth/file/mobile assertions pass. This closes the uncommitted-state caveat in §7; it does not replace the member-level authorization still required for the file actions in §1.1.

---

## Executive summary

| # | Area | Severity | Finding |
|---|------|----------|---------|
| 1 | Files | **Completed 2026-07-14** | File actions now verify an active member token; bucket enumeration/deletion and other administrative operations require a parent |
| 2 | PWA | **Completed 2026-07-13** | Runtime cache narrowed; failed, redirected, cross-origin, and `/files/*` responses are excluded |
| 3 | Shell | **Completed 2026-07-13** | Production no longer emits or initializes the time machine without an explicit public env opt-in |
| 4 | Calendar | **Medium** | 4,600-line component; middleware exempts `/api/calendar-sync/*` from device auth — each route must self-enforce (verify) |
| 5 | History | **Medium** | Append-only, undeletable, written on every toggle — unbounded growth with no retention plan |
| 6 | Docs/hygiene | **Low (Confirmed)** | CLAUDE.md documents endpoints that no longer exist; `lib/db.js` + `lib/db.ts` coexist; assorted dead files |

---

## 1. File storage & server actions (`app/actions.ts`)

### 1.1 Bucket-wide delete behind device-cookie auth only — **Completed 2026-07-14**

Every server action in [actions.ts](app/actions.ts) — including `deleteS3Objects(keys[])` ([actions.ts:216](app/actions.ts:216)) and bucket-wide `getFiles()` ([actions.ts:99](app/actions.ts:99)) — authenticates with `requireDeviceAuth()` alone: possession of the device cookie. Every activated kitchen tablet and kid device has that cookie. Server actions are plain POST endpoints, so anyone on an activated device can enumerate and permanently delete **every object in the bucket** (profile photos, task evidence, message attachments) without selecting a family member, let alone being a parent. The Files page UI is parent-gated; the action — the actual boundary — is not.

**Completed:** the client now passes its cached Instant refresh token into each server action, and the server verifies it with the Admin SDK before resolving the linked, still-active family-member row. Upload and attachment finalization require any authenticated family member; listing, deletion, avatar changes, refresh, and PIN hashing require a parent. Device authentication remains a second, independent requirement. `/files` no longer performs an unauthenticated server render of the bucket: it is parent-gated, then loads through the verified action. The avatar API route applies the same parent check before parsing multipart data or constructing an S3 client.

### 1.2 Smaller file findings

- **Completed 2026-07-14:** upload keys use a sanitized basename, so client-supplied path separators and unsupported characters no longer create surprising key prefixes.
- **Completed 2026-07-14:** uploads use a safe content-type allowlist (images except SVG, audio, video, PDF, plain text, and common office documents) and the presigned policy requires an exact matching `Content-Type`; active content such as `text/html` is rejected.
- `hashPin` is still called when parents create or edit family members, so it was not removed. It is now parent-only at the server boundary; a future migration can consolidate hashing without reopening the unauthenticated surface.
- The deletion-side integration is missing: task/update/response-field attachment deletions never call `deleteS3Objects` (flagged in the task-series audit 2.3) — once 1.1 is fixed, wire the cleanup through the same authorized path.

## 2. Service worker (`public/sw.js`) — **Medium, Confirmed**

Two compounding problems in the fetch handler:

1. **Responses are cached without checking `resp.ok`** ([sw.js:84](public/sw.js:84), [sw.js:93](public/sw.js:93)). A transient 500/403 on a JS chunk or image is cached and then served cache-first forever (the background revalidation also blindly `put`s whatever it gets).
2. **`isStaticAsset` matches by file extension anywhere on the origin** ([sw.js:36-42](public/sw.js:36)) — including `/files/photo.png`, which is not a static asset but a 307 redirect to a *time-limited* signed S3 URL ([app/files/[filename]/route.ts:22](app/files/[filename]/route.ts:22)). The followed-redirect response gets cached; once the signature would have expired, the cached body is what keeps serving — or, if the fetch raced expiry, a cached S3 `AccessDenied` serves forever. This is a credible source of "photos randomly break until I clear the app".

**Completed 2026-07-13:** responses are cached only when successful, basic, and non-redirected; the static matcher is limited to `/_next/static/` plus explicit app-shell assets, so `/files/` is never intercepted. `CACHE_VERSION` was bumped to `family-organizer-v2` to remove existing bad entries. The policy is covered by focused unit tests.

## 3. Time machine ships to production — **Medium, Confirmed**

The inline `<head>` script in [layout.tsx:81-115](app/layout.tsx:81) patches `window.Date` from `localStorage.debug_time_offset` **unconditionally** — only the *widget* hides in production ([DebugTimeWidget.tsx:44](components/debug/DebugTimeWidget.tsx:44)). Any kid who learns one devtools line (`localStorage.debug_time_offset = '86400000'`) time-travels the whole client: tomorrow's chores become completable today, allowance periods shift, countdown timers warp. Since completions store client-derived `dateDue`/`dateCompleted`, the forgery is durable.

**Completed 2026-07-13:** the inline bootstrap and widget share one `isTimeMachineEnabled` policy. Development and tests stay enabled; production emits neither the script nor widget unless `NEXT_PUBLIC_ENABLE_TIME_MACHINE=true` is deliberately set. Existing E2E helpers continue to run against development servers.

## 4. Calendar & CalDAV sync

- **`components/Calendar.tsx` is ~4,600 lines** — day/week/year views, infinite scroll bookkeeping, drag-and-drop, search, Nepali calendar, and theme broadcasting in one file. It works, but it's where future regressions will hide. Extract per-view modules next time it's touched; don't do a big-bang rewrite.
- **Kid drag-and-drop vs. parent-only perms — verify.** `calendarItems` writes are parent-only ([instant.perms.ts:663-681](instant.perms.ts:663)), while `DraggableCalendarEvent` drags whenever `draggableEnabled` is passed. If the calendar page doesn't gate that prop on `isParentMode`, a kid's drag optimistically moves the event, then the write is rejected and it snaps back (or worse, appears moved until reload). Confirm callers pass the parent flag; add it if not.
- **Middleware exempts `/api/calendar-sync/*` from device auth** (`API_ROUTE_AUTH_PREFIXES` in [middleware.ts](middleware.ts)) so those routes are reachable from the open internet and must each enforce their own auth via `lib/calendar-sync-auth.ts`. That file is currently being modified in the uncommitted device-auth work — after that lands, add an integration test asserting every `/api/calendar-sync/*` route 401s without credentials (the middleware test suite covers the exemption itself, not the routes' own checks).
- CalDAV account credentials: `calendarSyncAccounts` rows are `view: isFamilyPrincipal` — if the entity stores the Apple app-specific password (even encrypted), kids can read it. Verify what's stored; if secrets live there, move them to env/server-side storage or field-restrict.

## 5. History system

- `historyEvents` are written by **every** chore toggle, task update, finance mutation, and series edit, with `delete: false` and `update: false` ([instant.perms.ts:464-482](instant.perms.ts:464)). Good immutability, but: unbounded growth forever, no retention or rollup, and the `/history` page plus any query joining `historyEvents` slows in proportion. Decide a policy now (e.g., roll up events older than 12 months into monthly summaries via an admin script, or at least add `limit` + cursor pagination everywhere it's queried).
- `historyEvents.create: isFamilyPrincipal` means kids can write arbitrary history entries (attribution spoofing). Acceptable for a family, but note it's the audit log for finance too — if the ledger-authoritative work happens (finance audit §1), consider `source: 'system'` events being server-written only.
- History attachments duplicate task-update attachment rows (same file registered in two entities). Works, but doubles the S3-orphan problem when deletion arrives.

## 6. Messages, content, settings — mostly healthy

- **Messaging is the best-architected subsystem in the app:** all writes go through server routes with real token verification (`requireRequestFamilyMember`), CEL views are membership-scoped with proper `data.ref` traversals, reactions/acks/attachments are locked down. Two nits: `jsonRouteError` derives HTTP status by substring-matching error messages ([message-route.ts:29-40](lib/message-route.ts:29)) — brittle; and there's no message retention policy (same growth story as history).
- Content queue routes and perms (parent-write, family-view) look consistent; nothing alarming on read.
- **Completed 2026-07-14 — family-member safe updates are row-scoped.** The kid branch now requires `data.id in auth.ref('$user.familyMemberId')` in addition to the existing modified-field allowlist. Shared kid principals have an empty member-id list and cannot update roster rows; a member-scoped kid can update only its own preferences.
- **Completed 2026-07-14 — `pinHash` is self-or-parent only.** The former `isParent || data.role != 'parent'` rule was replaced with the same list-safe member identity check and deployed. Sibling hashes are redacted in the live hosted matrix. The unsalted hashing weakness remains a separate login-audit §5.4 item.

## 7. Mobile API surface

- Device sessions store `deviceId` + metadata only — no bearer tokens in the DB ([instant.schema.ts:279-290](instant.schema.ts:279)); tokens are HMAC-signed and verified statelessly in `device-auth-server.ts`. Sound design. The related web-device cookie refactor and `getParentDomain` LAN-IP guard were completed on 2026-07-13 (see login audit §5.4).
- `/api/mobile/*` is on the middleware public allowlist, so — same as calendar-sync — each route must self-enforce. The route implementations consistently call the device-auth context helpers; the integration test suite (`test/integration/app/api/mobile/*`) covers them. Good.
- `shortcutTokens` perms are all-`false` (server-only) — correct for iOS Shortcuts secrets.

## 8. Hygiene & docs

- **CLAUDE.md drift:** it documents `POST /api/upload` and `pages/api/upload.ts`/`delete-image` — the `pages/` directory no longer exists; uploads now flow through server actions (`app/actions.ts`) and `app/api/avatar-variants`. Anyone (or any agent) following the doc will look for files that aren't there. Update the architecture section.
- **Duplicate DB entrypoints:** both `lib/db.js` and `lib/db.ts` exist. Whichever is stale, delete it — imports of `@/lib/db` resolving ambiguously across tooling is a classic source of "works in vitest, breaks in Next".
- Dead weight to sweep with the already-flagged items: `lib/calendar-tags.js` (lone `.js` in a TS lib), the legacy `todos` entity + its permissive rules, `useInstantPrincipalSwitching.ts` (login audit), `isChoreAssignedForPersonOnDate`/`getChoreAssignmentGrid` (chores audit).
- Nav coverage: `/files` (like `/my-tasks`) is reachable only by typing the URL — MainNav has no entry. Intentional? If Files is parent-only-by-obscurity today, note that 1.1 removes the obscurity.
- Test posture: device-auth, middleware, countdown engine, recurrence, and mobile API routes have real suites (the uncommitted branch updates them consistently — good discipline). The gaps line up exactly with the highest-severity audit findings: **no tests for the money mutation paths** (`currency-utils`), none for `getTasksForDate` block-splitting edge cases, and no permission-regression tests asserting what a *kid principal* can and cannot write (`test/contracts` guards schema shape, not rule behavior). The live-perms smoke test (`npm run test:perms:live`) is the right harness to extend with kid-vs-parent write matrices.

---

## 9. Fix plan

**Phase 0 — real exposure:**
1. ~~Auth on file server actions (1.1) — parent-gate `deleteS3Objects`, member-gate the rest.~~ **Completed 2026-07-14.**
2. ~~Service worker: `resp.ok` checks + exclude `/files/` + version bump (§2).~~ **Completed 2026-07-13.**
3. ~~Gate the production time machine (§3).~~ **Completed 2026-07-13.**
4. ~~`pinHash` field rule → self-or-parent (§6).~~ **Completed and deployed 2026-07-14.**

**Phase 1 — verify-and-close:**
5. Confirm every `/api/calendar-sync/*` route self-enforces auth; add the 401 integration test (§4).
6. Check what `calendarSyncAccounts` stores; relocate secrets if present (§4).
7. Kid drag-and-drop gating on the calendar (§4).
8. ~~Kid-safe `familyMembers` update: restrict to own row (§6).~~ **Completed and deployed 2026-07-14.**

**Phase 2 — hygiene:**
9. CLAUDE.md architecture refresh; delete `lib/db.js` (or `.ts` — whichever is dead), `calendar-tags.js`, `todos`, and the dead helpers list (§8).
10. History/messages retention decision + pagination (§5).

**Phase 3 — testing:**
11. Kid-principal permission matrix in the live-perms suite (**family-member row/field cases completed 2026-07-14**); money-path unit tests; block-splitting table tests (§8) — continue expanding the matrix as the remaining permission fixes land.
