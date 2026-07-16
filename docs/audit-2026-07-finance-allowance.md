# Audit: Finance / Allowance System

**Date:** 2026-07-12
**Scope:** `lib/currency-utils.ts` (all money mutations), `app/allowance-distribution/page.tsx`, `components/allowance/*`, allowance math in `lib/chore-utils.ts` (`calculatePeriodDetails`, `getAllowancePeriodForDate`), finance entities/permissions in `instant.schema.ts` / `instant.perms.ts`.
**Method:** Static code-path tracing, focused unit/contract tests, TypeScript validation, and hosted Instant schema/permission smoke tests.

---

## Implementation progress

- **2026-07-16 — Completed: allowance-period calculation is explicitly synchronous (§6).** `calculatePeriodDetails` no longer advertises a Promise, accepts an unused database handle, or forces the distribution loop to yield between purely local calculations. Its callers now consume the typed `CalculatedPeriod` result directly; recurrence expansion remains the separate performance concern documented in the chores audit. Verification: the focused chore date-logic suite, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-16 — Substantially completed and deployed: web/native money mutations now cross an authenticated server boundary (§1.1, §3; fix plan 9).** Browser and iPhone envelope creation, deposits, withdrawals, same-owner transfers, person transfers, and archival now call `/api/finance/mutations` with the active Instant family-member token. The server re-reads active envelopes, enforces actor/source ownership and transfer/archive invariants, serializes overlapping envelope operations inside the process, and submits the already-tested balance + append-only ledger + history transaction through the admin SDK. Native finance no longer emits undeclared scalar relationship attributes or writes balances directly; kid deletion now follows the parent-only archival rule. Hosted permissions deny kid envelope creation/linking/deletion and any kid `balances` update while retaining owner-scoped metadata edits. Verification: 56 focused route/service/lock/client/mobile/permission tests, the hosted 3-test permission matrix, changed-file mobile lint, `tsc --noEmit`, the full 828-test suite, and a successful production Webpack build. The remaining structural limit is cross-process concurrency (including an allowance payout racing a mutation handled by another server instance); ledger reconciliation detects and repairs that cache drift, but fully eliminating it requires ledger-derived balances or a distributed lock/version check.
- **2026-07-15 — Completed and deployed: legacy scalar envelope balances are removed (§5).** A hosted read found 18 envelope rows and zero non-null legacy `amount`/`currency` values, so no backfill was necessary. Both attributes are deleted from the hosted and checked-in schema, and dashboard normalization now accepts only the canonical multi-currency `balances` map. Verification: 17 focused dashboard/schema-contract tests, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-15 — Completed and deployed: envelope deletion is ledger-preserving archival (§5; fix plan 6).** The delete workflow migrates every non-zero balance, writes and links both sides of each transfer, then clears/default-unsets and timestamps the source envelope instead of deleting it. All active finance, chore-balance, family-list, payout, and dashboard queries filter the indexed `archivedAt` marker; transaction history deliberately retains archived rows and their immutable links. Kids cannot set `archivedAt`, while parents can archive. Verification: 97 cross-surface tests and `tsc --noEmit` pass; the schema/index and permissions are deployed; the full 3-test hosted permission/cascade matrix passes.
- **2026-07-15 — Completed: count-limited allowance periods no longer expand the full rule (§2).** The terminal-period branch now checks `rule.options.count === 1` directly instead of materializing every recurrence through `rule.all()`. Large finite counts therefore retain bounded period lookup behavior. Verification: all 24 chore date-logic tests, including a prototype spy proving `all()` is never called, plus `tsc --noEmit` pass.
- **2026-07-15 — Completed: processed periods disappear without a stale-query flash (§6; fix plan 11).** Successful single-period, bulk, and skip actions add only the confirmed period IDs to a local suppression set. That state change reruns the existing calculation immediately, while `excludeProcessedPeriods` prevents an older live-query snapshot from reintroducing committed rows; the normal Instant subscription remains responsible for durable state. Duplicate/no-op payout responses suppress nothing. Verification: 2 focused state regressions plus all 8 atomic-payout tests, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-15 — Completed: has-one link shapes are normalized in allowance math (§2).** A shared `resolveOneLink` helper now accepts either Instant's object or one-item-array representation. `calculatePeriodDetails` uses it before matching completion chores, so object-shaped results no longer silently omit completed weight or fixed rewards. Existing task-bin and finance member-link normalization now use the same primitive. Verification: all 51 focused link/chore/task-bin/currency tests, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-15 — Completed: envelope deletion preserves debt (§5; fix plan 6 partial).** Deletion now migrates every non-zero currency balance to the selected target envelope, including negative balances. A debt produces the inverse outgoing entry on the deleted envelope and a negative incoming entry on the retained envelope, so the net position and replayable ledger both remain intact. Zero balances remain omitted. Verification: all 30 focused currency mutation/audit tests, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-15 — Completed: transaction relationships use Instant links only (§5; fix plan 5).** Money mutations no longer write the undeclared scalar attributes `envelope`, `sourceEnvelope`, or `destinationEnvelope`. Ledger rows carry only declared entity attributes, while envelope membership and transfer direction continue through the schema-backed `transactions`, `outgoingTransfers`, and `incomingTransfers` links used by queries and reconciliation. Verification: all 49 focused currency utility tests, `tsc --noEmit`, and `git diff --check` pass.
- **2026-07-15 — Completed and deployed: minimum finance permission hardening (§3; fix plan 7).** Envelope deletion is parent-only. Exchange-rate link/create/update/delete/unlink and calculated-period link/create/update/delete/unlink are parent-only while family principals retain read access. The server exchange-rate route writes through admin, so this does not regress client refreshes. Verification: 14 permission/schema contract tests, `tsc --noEmit`, and the full 3-test hosted matrix pass; the live matrix explicitly exercises kid denials and parent success. Envelope create/update remain family-principal operations because current kid transfers mutate both source and recipient envelopes; moving those mutations server-side remains the durable closure.
- **2026-07-15 — Completed in code and hosted schema: exchange-rate access is server-only (§4; fix plan 8 partial).** The committed fallback credential is removed. Authenticated family clients now call `/api/exchange-rates`; the server reads a two-hour Instant cache, coalesces concurrent stale refreshes, calls OpenExchangeRates with `OPEN_EXCHANGE_RATES_APP_ID`, and admin-upserts deterministic unique `pairKey` rows. Clients no longer write fetched or derived rates. Missing configuration returns a clear 503. The hosted schema has the unique indexed optional `exchangeRates.pairKey`. Verification: 4 service tests, 3 route tests, 19 currency-core tests, 13 schema/permission contract tests, and `tsc --noEmit` pass. External follow-up: revoke/rotate the previously committed provider key and configure its replacement in server runtime secrets.
- **2026-07-15 — Completed: ledger reconciliation now runs in live finance flows (§1.2; fix plan 4).** `MemberAllowanceDetail` audits every newly loaded or changed envelope signature and reports repairs; atomic distribution reconciles the member's supplied envelopes before its fresh balance/idempotency query. Currency keys are normalized during replay. The guard is intentionally conservative: a nonzero legacy envelope with no ledger rows is preserved and reported as unverifiable instead of being zeroed. Verification: 24 currency-mutation tests, 8 atomic-payout tests, and `tsc --noEmit` pass.
- **2026-07-15 — Completed: new fixed rewards pay out in every earned currency (§1.4; fix plan 2).** Each period now passes its non-primary `fixedRewardsEarned` amounts into the atomic payout boundary. That boundary updates every currency bucket in one envelope write and creates one deterministic, unique, immutable ledger/history pair per period/currency before marking completions awarded in the same transaction. Foreign-only periods are actionable in both single-period and bulk controls, and success messages enumerate the currencies actually moved. A partial retry pays only a missing currency leg. Verification: all 7 focused atomic-payout tests and `tsc --noEmit` pass.
- **2026-07-15 — Completed and deployed: allowance payouts are atomic and idempotent (§1.3; fix plan 1).** Distribution now re-reads the member's latest envelope state, assigns one deterministic immutable transaction ID and unique `distributionKey` per member/period/currency, and submits the balance update, ledger rows, finance history, default-envelope creation/linking, and every `allowanceAwarded` completion update in one Instant transaction. Single-period and bulk actions use the same path; bulk retries skip only previously committed periods. A concurrent duplicate collides on deterministic IDs/unique keys, so Instant rejects the entire second transaction without a second balance write. The hosted schema now has the unique indexed optional `allowanceTransactions.distributionKey`. Verification: 5 focused payout tests, 12 permission/schema contract tests, `tsc --noEmit`, and the 3-test hosted permission/cascade matrix pass; the live matrix explicitly proved duplicate-key rejection.
- **2026-07-14 — Completed and deployed upstream: kids cannot tamper with payout state (§3; fix plan 7 partial).** `choreCompletions.allowanceAwarded` and `dateDue` are no longer kid-updatable. A member kid may update only completion-state fields on a row linked to that same member, cannot create/link a sibling completion, and the shared kid principal cannot create a completion row. Parent payout writes remain supported. Verification: the permission contract, `tsc --noEmit`, and the hosted identity/field matrix pass.
- **2026-07-14 — Completed upstream: duplicate up-for-grabs claims no longer double-pay (§2; fix plan 3).** All claim entry points now use one UUIDv5 completion ID per `(choreId, dateDue)`, causing concurrent Instant transactions to converge. Allowance preprocessing also canonicalizes legacy duplicate rows by earliest completion, excludes losing rows from every member's calculation, and expands the winner's `completionsToMark` to mark the entire duplicate group awarded. XP follows the same canonical winner. Verification: 37 focused shared-core/chore-utils/ChoresTracker tests pass; `tsc --noEmit` passes.

---

## Executive summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High (Substantially fixed)** | Web/native interactive mutations now re-read and serialize through the server; cross-process or payout-vs-mutation races still require ledger-derived balances or distributed concurrency control |
| 2 | **Completed 2026-07-15** | New fixed rewards now pay out atomically in every earned currency |
| 3 | **Completed 2026-07-15** | Payout, history, and award marking now commit atomically with per-period idempotency |
| 4 | **Completed for kid principals 2026-07-16** | Kids can edit only owner-scoped envelope metadata; money/create/archive operations use the authenticated server boundary |
| 5 | **Completed 2026-07-15** | Ledger reconciliation now audits finance detail loads and pre-distribution state |
| 6 | **Completed in code 2026-07-15** | Provider access and caching are server-only; external key rotation/configuration remains |
| 7 | **Medium (Partially fixed)** | Debt preservation, relationship/schema hygiene, and ledger-preserving archival are fixed; float money math remains |

The theme: the **ledger** (`allowanceTransactions`, append-only, well-audited) and the **balances** (a mutable JSON blob on each envelope) are maintained in parallel with nothing enforcing that they agree.

---

## 1. The balance/ledger split — **High**

### 1.1 Read-modify-write races lose money — **Substantially fixed 2026-07-16**

Originally every money operation followed the same shape — read `envelope.balances` from client-cached props, compute a new object, and write the *entire* object back:

- `depositToSpecificEnvelope` ([currency-utils.ts:612-675](lib/currency-utils.ts:612))
- `transferFunds` ([currency-utils.ts:685-785](lib/currency-utils.ts:685))
- `withdrawFromEnvelope`, `transferFundsToPerson` ([currency-utils.ts:1085-1205](lib/currency-utils.ts:1085))
- `deleteEnvelope`'s fund migration ([currency-utils.ts:795-911](lib/currency-utils.ts:795))

InstantDB `update` on a `json` column replaces the whole value, so two stale client writes could clobber each other even though the ledger recorded both.

**Implemented:** production web helpers and the native Finance screen now send all interactive money changes to the authenticated `/api/finance/mutations` route. The route resolves the active family-member principal before parsing the mutation, re-queries every involved active envelope, verifies that a kid owns the source/member, separates same-owner from person transfers, restricts archival to parents and same-owner targets, and executes the balance, ledger, link, and history writes through the admin SDK. A keyed process lock serializes operations whose envelope/member keys overlap while allowing unrelated members to proceed independently. Web fake DBs retain a direct builder path for deterministic unit tests; the real browser DB is explicitly marked for server routing. Native requests use the same active-member token and no longer call `db.transact` for finance.

Permissions close the direct kid bypass: envelope create/link/unlink/delete are parent/admin-only, and an owner kid may update only `name`, `description`, `goalAmount`, `goalCurrency`, or `isDefault`—never `balances` or `archivedAt`. The hosted matrix proves safe owner metadata succeeds while balance forgery and creation are denied.

**Remaining limit:** the lock is process-local. Two server instances—or the still-client-initiated atomic allowance payout racing a server mutation—can both read the same balance cache before either commits. The append-only ledger remains complete and the wired reconciliation path detects/repairs the cache, so the operation is no longer silently lost, but complete prevention still requires ledger-derived balances, a distributed lock, or an enforceable balance version/compare-and-swap primitive.

**Remaining structural options (in preference order):**
1. **Make the ledger authoritative.** Balances become derived state: after writing a transaction row, recompute the envelope's balances from its transactions (or maintain them as a cache that `reconcileEnvelope` refreshes). Transactions are append-only with `update: false` perms already — they're the trustworthy half.
2. Add distributed serialization/version checking around the completed server route if the deployment runs multiple mutation workers.
3. Keep automatic reconciliation (1.2) as the safety net for historical, offline, or cross-process drift.

### 1.2 The reconciliation tool is dead code — **Completed 2026-07-15**

`reconcileEnvelope` replayed an envelope's ledger and repaired `balances` on mismatch, but no code path called it. It also treated “no ledger rows” as an authoritative zero balance, which made automatic use unsafe for legacy data.

**Implemented:** `reconcileEnvelopes` now runs from `MemberAllowanceDetail` whenever an envelope ID/balance signature changes, and `executeAtomicAllowancePayout` runs it against the member envelopes before fetching the latest payout state. Replay normalizes currency casing and repairs only differences above the existing `0.001` tolerance. A nonzero balance with no ledger rows returns `reason: 'no-transactions'`, is preserved, and is surfaced as unverifiable in diagnostics; it is never silently zeroed. Detail-view repairs produce one user toast, and signature tracking prevents an update/render loop. This is a working drift safety net, while §1.1 remains the durable concurrency problem to solve.

### 1.3 Non-atomic payout → double pay — **Completed 2026-07-15**

Both payout paths previously ran two awaited steps: `executeAllowanceTransaction(...)` then `markCompletionsAwarded(...)`. If the deposit landed and marking failed (tab closed, network drop, permission hiccup), every completion in the period remained unawarded and the next distribution could pay it again.

**Implemented:** [allowance-payout.ts](../lib/allowance-payout.ts) is now the shared single-period/bulk distribution boundary. It re-queries the current envelope and existing deterministic period rows immediately before building one `db.transact` containing the balance update, one immutable ledger row per pending period, the envelope/ledger links, finance history, optional default-envelope creation, and deduplicated `allowanceAwarded: true` writes. `allowanceTransactions.distributionKey` is unique and indexed, while the transaction/history/default-envelope IDs are UUIDv5 values derived from stable period identity. A normal retry skips rows already present; two concurrent clients build the same IDs and key, so only one entire transaction can commit. This closes the payout/mark failure window. It deliberately does **not** claim to solve the broader stale-JSON balance race in §1.1 for unrelated simultaneous money operations.

### 1.4 Foreign-currency fixed rewards are never paid — **Completed for new payouts 2026-07-15**

`calculatePeriodDetails` accumulated `fixedRewardsEarned` per currency, but both payout handlers deposited only the member's primary allowance currency. The completions backing those rewards were still flagged `allowanceAwarded: true`, so (for example) a 500-NPR fixed reward could disappear when a member's allowance currency was USD.

**Implemented for all future distribution actions:** each period carries primary and additional currency amounts to `executeAtomicAllowancePayout`. The helper folds pending currency legs into one balance update, then writes a deterministic ledger row and finance history event for each period/currency in the same transaction as completion award marks. Single-period and bulk buttons stay enabled when the primary amount is zero but another earned currency is non-zero, and their result toast lists every currency moved. Retry detection is per currency, so a primary row already present does not suppress a missing foreign leg.

**Historical-data boundary:** this prevents new loss, but it does not automatically credit foreign rewards that the old code already marked awarded. Those rows need a guarded recovery report/backfill that proves no matching ledger credit exists before creating money. That is tracked as a separate follow-up rather than silently inferring credits during normal payout.

---

## 2. Allowance-period math (`lib/chore-utils.ts`)

- **Total vs. completed weight can disagree with rotation edits.** `totalWeight` counts *scheduled occurrences* for the member in the period ([chore-utils.ts:527-537](lib/chore-utils.ts:527)) while `completedWeight` counts completion rows. Retroactive schedule edits change the former but not the latter (see chores audit 1.3), so percentages drift after edits — snapshot-at-completion fixes both.
- **Completed 2026-07-14 — duplicate up-for-grabs completions no longer double-pay.** Deterministic claim IDs prevent new duplicates, and payout preprocessing selects the earliest legacy completion as the sole winner while marking the full duplicate group awarded.
- **Link-shape fragility — Completed 2026-07-15.** The shared `resolveOneLink` primitive normalizes object, one-item-array, empty, and missing Instant has-one values. Allowance-period matching and legacy up-for-grabs deduplication both use it, and an object-shaped completion regression proves the earned weight is included.
- **Count-terminated rule expansion — Completed 2026-07-15.** `getAllowancePeriodForDate` checks the declared `COUNT` value directly for the one-occurrence special case and no longer calls `rule.all()`, keeping lookup work bounded even for large finite recurrence counts.

---

## 3. Permissions — **High (Confirmed)**

From [instant.perms.ts:388-406](instant.perms.ts:388) and friends, all under a kid principal:

| Entity | Rule | Consequence |
|---|---|---|
| `allowanceEnvelopes` | **Completed for kid principals 2026-07-16:** parent/admin-only create/link/unlink/delete; owner-kid update allowlist excludes `balances` and `archivedAt` | Kids use the server for creation/transfers and cannot forge balances or archive envelopes directly |
| `exchangeRates` | **Completed 2026-07-15:** writes and links are parent-only; refresh uses server admin | Kids cannot rewrite rates used in combined-balance and goal-progress displays |
| `calculatedAllowancePeriods` | **Completed 2026-07-15:** writes and links are parent-only | Distribution bookkeeping is no longer kid-editable |
| `allowanceTransactions` | create requires `createdBy == auth.id`, update `false`, delete `isParent` | The ledger itself is well protected — good |
| `choreCompletions.allowanceAwarded` | **Completed 2026-07-14:** kid updates are ownership-scoped and limited to completion-state fields | Kids cannot set or re-arm payout state; parent distribution can still mark rows awarded |

Kids legitimately need self-service envelope creation and transfers, and CEL cannot validate arithmetic. Those workflows now use the authenticated server boundary:

1. **Ledger-authoritative model (1.1)** shrinks the blast radius: if balances are derived and reconciled, a forged balance write is detected and reverted; the append-only ledger with `auditMatchesPrincipal` stays the source of truth.
2. **Completed 2026-07-16:** kid-initiated create/transfer operations and all web/native interactive money changes use one admin route that validates source ownership and fresh sufficient funds, then writes ledger + balances together.
3. **Completed and deployed:** envelope create/link/unlink/delete are parent/admin-only, owner-kid updates are metadata-only, exchange-rate and calculated-period writes/links are parent-only, and payout state is not kid-writable.

The native app uses the same route, so the hosted rule does not silently disable kid-to-kid transfers. Native delete is now parent-gated and uses ledger-preserving archival rather than permanent deletion.

This is a family app — the "attacker" is a bored twelve-year-old — but that is precisely the audience that discovers the InstantDB devtools.

---

## 4. Secrets and external calls

### 4.1 Hardcoded API key — **Completed in code 2026-07-15**

The client previously selected a `NEXT_PUBLIC` value or a committed fallback and called the provider directly, exposing the credential in source and browser traffic.

**Implemented:** no provider credential remains in client code or as a source fallback. The provider client exists only in [exchange-rates-server.ts](../lib/exchange-rates-server.ts) and reads `OPEN_EXCHANGE_RATES_APP_ID`; [.env.example](../.env.example) documents the server variable. A missing key produces an explicit 503 rather than silently using compromised material. **Operator action still required:** source changes cannot revoke an external credential, so the previously committed key must be rotated at OpenExchangeRates and the replacement installed in the server runtime.

### 4.2 Client-side rate fetching — **Completed 2026-07-15**

`fetchExternalExchangeRates` previously ran from the browser, so every family device could independently burn quota and needed `exchangeRates` write permission.

**Implemented:** the browser function now calls the authenticated `/api/exchange-rates` family route with its member token. The route uses the admin SDK to serve a fresh two-hour Instant cache or fetch/upsert provider rates. Stable UUIDv5 row IDs plus unique indexed `pairKey` values prevent duplicate currency pairs, and a process-level single-flight promise prevents simultaneous stale requests from multiplying upstream calls. Calculated cross-rates are derived locally without writing cache rows. This makes clients read-only consumers and enables the permission closure in §3.

---

## 5. Data-model hygiene

- **Undeclared transaction attributes — Completed 2026-07-15.** All writes of scalar `envelope`, `sourceEnvelope`, and `destinationEnvelope` fields have been removed from allowance transaction payloads. Mutations retain the real schema relationships: ordinary ledger membership uses the envelope's `transactions` link, transfer debits use `outgoingTransfers`, and transfer credits use `incomingTransfers`. Relationship filters such as reconciliation's `where: { envelope: envelopeId }` therefore have one unambiguous source of truth.
- **Negative balances on envelope deletion — Completed 2026-07-15.** `deleteEnvelope` now migrates all non-zero balances. For a `-2` debt it adds `-2` to the retained envelope, records a `+2` transfer-out that clears the deleted envelope, and records a `-2` transfer-in on the retained envelope. The two-envelope total and ledger replay therefore remain unchanged.
- **Deleted envelopes strand their ledger — Completed and deployed 2026-07-15.** The user-facing delete action now archives: it migrates balances, links outgoing rows to the source, clears the archived balance cache, unsets default, and writes `archivedAt` in the same transaction. Active-envelope consumers use the indexed null filter plus defensive local filtering, while `TransactionHistoryView` intentionally queries the complete member envelope graph so historical labels and links survive. The permission rule reserves archive-field create/update changes for parents.
- **Legacy `i.any()` envelope fields — Completed and deployed 2026-07-15.** A hosted audit returned 18 envelopes and no row with a non-null legacy `amount` or `currency`, so the attributes were safe to delete without synthesizing balances. The dashboard's compatibility fallback is also removed; `balances` is the sole representation.
- **Float money math throughout.** Balances, rewards, and the reconcile epsilon (`0.001`) all ride IEEE doubles; repeated allowance percentages (`(percentage/100) * amount`) plus `toFixed(2)` round-trips will drift by cents over years. Standard fix: integer minor units per currency (`unitDefinitions.decimalPlaces` already exists to drive this). Big migration — schedule it consciously or accept and document cent-level drift.

---

## 6. Distribution page specifics

- **Post-payout stale state — Completed 2026-07-15.** The page still derives calculations from the live Instant query, but it now records successfully committed period IDs locally. Recalculation excludes those IDs even if the subscription has not delivered its next snapshot yet, so paid or skipped periods disappear immediately without invoking the old imperative refresh race. An idempotent no-op response does not suppress a period.
- **Completed 2026-07-16 — synchronous calculation contract.** `calculatePeriodDetails` now exposes its actual pure synchronous behavior and no longer accepts the unused DB handle or incurs an `await` per member/period. Recurrence expansion inside `getChoreOccurrencesForMemberInPeriod` remains the O(history) optimization tracked in the chores audit 5.1.
- Editable period amounts parse with `parseFloat` and no bounds; a typo like `4500` instead of `45.00` deposits happily. Consider a confirm threshold ("this is 10× the calculated amount — proceed?").

## 7. Envelope UX findings (`components/allowance/*`, `MemberAllowanceDetail.tsx`)

- `MemberAllowanceDetail` (1,192 lines) mixes recurring-allowance settings, envelope CRUD, transfers, goals, and rate fetching in one component; the transfer forms each re-implement balance validation that `transferFunds` also enforces. Consolidation candidate, not a defect.
- Transfers are same-currency only (`transferFundsToPerson` has no conversion) — reasonable, but the UI should say so when the destination member has no envelope holding that currency (today the money lands as a new currency bucket in their default envelope, which surprises people).
- `findOrDefaultEnvelope` auto-creates an "Savings" envelope mid-payout if a member has none ([currency-utils.ts:1426](lib/currency-utils.ts:1426)) — sensible, but it happens inside the payout path with its own transact (another non-atomicity seam folded away by the 1.3 fix).

---

## 8. Fix plan

**Phase 0 — stop losing money:**
1. ~~Atomic payout: single transact for deposit + balance + `allowanceAwarded` marks, with per-period idempotency (1.3).~~ **Completed and hosted schema deployed 2026-07-15.**
2. ~~Pay `fixedRewardsEarned` per currency in that same transact (1.4).~~ **Completed for new payouts 2026-07-15; historical recovery remains explicitly tracked in §1.4.**
3. ~~Deterministic up-for-grabs completion IDs (chores audit 1.1 — double-pay source).~~ **Completed 2026-07-14, including legacy payout deduplication.**

**Phase 1 — trust the ledger:**
4. ~~Wire `reconcileEnvelope` into finance-page load + pre-distribution (1.2).~~ **Completed 2026-07-15, including ledgerless-legacy preservation.**
5. ~~Declare or drop the undeclared transaction attributes (§5).~~ **Completed 2026-07-15; schema-backed Instant links are now the only relationship representation.**
6. ~~Migrate all non-zero balances and preserve ledger continuity with soft-delete (§5).~~ **Completed and deployed 2026-07-15.**

**Phase 2 — permissions & secrets:**
7. ~~Envelope `delete: isParent`; `exchangeRates` writes parent/server-only; calculated periods parent-only; `allowanceAwarded` kid-write closure (§3).~~ **Completed and deployed (completion state 2026-07-14; remaining minimum finance rules 2026-07-15).** Direct envelope updates move to Phase 3's server-mediated boundary.
8. **Server move completed 2026-07-15.** The source fallback is removed and clients are read-only; external credential revocation/rotation plus server-secret configuration remains an operator action (§4).

**Phase 3 — structural:**
9. **Server-mediated web/native interactive money ops completed and hosted permissions deployed 2026-07-16.** Ledger-derived balances or distributed concurrency control remains the final cross-process closure for §1.1.
10. Integer minor-unit migration decision (§5).
11. ~~Distribution page: eliminate the post-action stale snapshot (§6).~~ **Completed 2026-07-15 with confirmed-ID suppression layered over the existing live query.** A larger calculation extraction remains optional refactoring, not a correctness blocker.
