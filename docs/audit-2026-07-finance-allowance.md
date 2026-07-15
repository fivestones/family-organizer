# Audit: Finance / Allowance System

**Date:** 2026-07-12
**Scope:** `lib/currency-utils.ts` (all money mutations), `app/allowance-distribution/page.tsx`, `components/allowance/*`, allowance math in `lib/chore-utils.ts` (`calculatePeriodDetails`, `getAllowancePeriodForDate`), finance entities/permissions in `instant.schema.ts` / `instant.perms.ts`.
**Method:** Static code-path tracing, focused unit/contract tests, TypeScript validation, and hosted Instant schema/permission smoke tests.

---

## Implementation progress

- **2026-07-15 — Completed: new fixed rewards pay out in every earned currency (§1.4; fix plan 2).** Each period now passes its non-primary `fixedRewardsEarned` amounts into the atomic payout boundary. That boundary updates every currency bucket in one envelope write and creates one deterministic, unique, immutable ledger/history pair per period/currency before marking completions awarded in the same transaction. Foreign-only periods are actionable in both single-period and bulk controls, and success messages enumerate the currencies actually moved. A partial retry pays only a missing currency leg. Verification: all 7 focused atomic-payout tests and `tsc --noEmit` pass.
- **2026-07-15 — Completed and deployed: allowance payouts are atomic and idempotent (§1.3; fix plan 1).** Distribution now re-reads the member's latest envelope state, assigns one deterministic immutable transaction ID and unique `distributionKey` per member/period/currency, and submits the balance update, ledger rows, finance history, default-envelope creation/linking, and every `allowanceAwarded` completion update in one Instant transaction. Single-period and bulk actions use the same path; bulk retries skip only previously committed periods. A concurrent duplicate collides on deterministic IDs/unique keys, so Instant rejects the entire second transaction without a second balance write. The hosted schema now has the unique indexed optional `allowanceTransactions.distributionKey`. Verification: 5 focused payout tests, 12 permission/schema contract tests, `tsc --noEmit`, and the 3-test hosted permission/cascade matrix pass; the live matrix explicitly proved duplicate-key rejection.
- **2026-07-14 — Completed and deployed upstream: kids cannot tamper with payout state (§3; fix plan 7 partial).** `choreCompletions.allowanceAwarded` and `dateDue` are no longer kid-updatable. A member kid may update only completion-state fields on a row linked to that same member, cannot create/link a sibling completion, and the shared kid principal cannot create a completion row. Parent payout writes remain supported. Verification: the permission contract, `tsc --noEmit`, and the hosted identity/field matrix pass.
- **2026-07-14 — Completed upstream: duplicate up-for-grabs claims no longer double-pay (§2; fix plan 3).** All claim entry points now use one UUIDv5 completion ID per `(choreId, dateDue)`, causing concurrent Instant transactions to converge. Allowance preprocessing also canonicalizes legacy duplicate rows by earliest completion, excludes losing rows from every member's calculation, and expands the winner's `completionsToMark` to mark the entire duplicate group awarded. XP follows the same canonical winner. Verification: 37 focused shared-core/chore-utils/ChoresTracker tests pass; `tsc --noEmit` passes.

---

## Executive summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High (Confirmed)** | Every balance mutation is a client-side read-modify-write of the whole `balances` JSON — concurrent operations lose money silently |
| 2 | **Completed 2026-07-15** | New fixed rewards now pay out atomically in every earned currency |
| 3 | **Completed 2026-07-15** | Payout, history, and award marking now commit atomically with per-period idempotency |
| 4 | **High (Confirmed)** | Permissions let any kid principal edit any envelope's `balances` JSON directly (and exchange rates, and calculated periods) |
| 5 | **Medium (Confirmed)** | `reconcileEnvelope` — the one tool that could catch ledger/balance drift — exists but is never called |
| 6 | **Medium (Confirmed)** | An OpenExchangeRates API key is hardcoded as a fallback in the client bundle |
| 7 | **Medium** | Deleting an envelope silently discards negative balances; transactions write undeclared attributes; float money math throughout |

The theme: the **ledger** (`allowanceTransactions`, append-only, well-audited) and the **balances** (a mutable JSON blob on each envelope) are maintained in parallel with nothing enforcing that they agree.

---

## 1. The balance/ledger split — **High**

### 1.1 Read-modify-write races lose money — **Confirmed**

Every money operation follows the same shape — read `envelope.balances` from client-cached props, compute a new object, write the *entire* object back:

- `depositToSpecificEnvelope` ([currency-utils.ts:612-675](lib/currency-utils.ts:612))
- `transferFunds` ([currency-utils.ts:685-785](lib/currency-utils.ts:685))
- `withdrawFromEnvelope`, `transferFundsToPerson` ([currency-utils.ts:1085-1205](lib/currency-utils.ts:1085))
- `deleteEnvelope`'s fund migration ([currency-utils.ts:795-911](lib/currency-utils.ts:795))

There is no optimistic-concurrency check and InstantDB `update` on a `json` column replaces the whole value. Two operations on the same envelope in flight at once — parent runs allowance distribution on the laptop while the kid moves money into a savings envelope on the tablet, or one device is briefly offline and syncs later — and the second write clobbers the first. The ledger records both transactions, so the envelope balance no longer equals the sum of its ledger, and **nothing ever notices** (see 1.2).

**Fix (in preference order):**
1. **Make the ledger authoritative.** Balances become derived state: after writing a transaction row, recompute the envelope's balances from its transactions (or maintain them as a cache that `reconcileEnvelope` refreshes). Transactions are append-only with `update: false` perms already — they're the trustworthy half.
2. Failing that, serialize money mutations through a server route (admin SDK) that re-reads balances inside the request.
3. At minimum, wire up automatic reconciliation (1.2) so drift is detected and repaired instead of compounding.

### 1.2 The reconciliation tool is dead code — **Confirmed**

`reconcileEnvelope` ([currency-utils.ts:258-295](lib/currency-utils.ts:258)) replays an envelope's ledger and repairs `balances` on mismatch — exactly the right safety net — and **no code path calls it**. Wire it to run (a) when opening a member's finance page per envelope, and (b) before allowance distribution executes. Note its replay assumes every balance change has a ledger row, which is true for all current mutation paths — one more reason to close the direct-`balances`-edit hole (section 3).

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
- **Link-shape fragility:** `completion.chore?.[0]?.id` ([chore-utils.ts:547](lib/chore-utils.ts:547)) assumes array-shaped links; other files handle both shapes. One shared `resolveOne` helper would remove a whole class of "works in this query, breaks in that one" bugs.
- `getAllowancePeriodForDate`'s `count`-terminated branch calls `rule.all()` ([chore-utils.ts:409](lib/chore-utils.ts:409)) — fine for small counts, unbounded in principle. Low priority.

---

## 3. Permissions — **High (Confirmed)**

From [instant.perms.ts:388-406](instant.perms.ts:388) and friends, all under a kid principal:

| Entity | Rule | Consequence |
|---|---|---|
| `allowanceEnvelopes` | create/update/delete `isFamilyPrincipal` | A kid can edit the `balances` JSON directly — self-crediting with no ledger trace — or delete a sibling's envelope |
| `exchangeRates` | create/update/delete `isFamilyPrincipal` | Kids can rewrite rates used in combined-balance and goal-progress displays |
| `calculatedAllowancePeriods` | all `isFamilyPrincipal` | Distribution bookkeeping is editable by kids |
| `allowanceTransactions` | create requires `createdBy == auth.id`, update `false`, delete `isParent` | The ledger itself is well protected — good |
| `choreCompletions.allowanceAwarded` | **Completed 2026-07-14:** kid updates are ownership-scoped and limited to completion-state fields | Kids cannot set or re-arm payout state; parent distribution can still mark rows awarded |

Kids do legitimately need to deposit/withdraw/transfer (each touches two envelopes' balances), and CEL can't validate arithmetic — so `update: isParent` alone would break the product. Realistic options:

1. **Ledger-authoritative model (1.1)** shrinks the blast radius: if balances are derived and reconciled, a forged balance write is detected and reverted; the append-only ledger with `auditMatchesPrincipal` stays the source of truth.
2. Move kid-initiated money ops to a small server route (admin SDK validates: own envelopes only, sufficient funds, writes ledger + balances atomically). Then envelope `update`/`delete` can become `isParent`.
3. At minimum now: `delete: isParent` on envelopes and `create/update/delete: isParent` on `exchangeRates` (writes can move server-side, see 4.2). The `allowanceAwarded` kid-write closure was completed and deployed on 2026-07-14.

This is a family app — the "attacker" is a bored twelve-year-old — but that is precisely the audience that discovers the InstantDB devtools.

---

## 4. Secrets and external calls

### 4.1 Hardcoded API key — **Medium, Confirmed**

[currency-utils.ts:176](lib/currency-utils.ts:176): `process.env.NEXT_PUBLIC_OPEN_EXCHANGE_RATES_APP_ID || 'a6175466a16c4ce3b3cdbf9fbb50cb7e'` — the fallback key is committed to the repo and, being `NEXT_PUBLIC`, ships in the client bundle either way. Rotate the key at openexchangerates.org, remove the fallback, and (4.2) stop needing it client-side at all.

### 4.2 Client-side rate fetching

`fetchExternalExchangeRates` runs from the browser ([currency-utils.ts:1215](lib/currency-utils.ts:1215)) and every family device that opens the finance page can independently burn quota + needs `exchangeRates` write permission (see §3). Move to a small server route or a scheduled job that refreshes the `exchangeRates` table; clients become read-only consumers. The 2-hour cache logic already fits this shape.

---

## 5. Data-model hygiene

- **Undeclared attributes on transactions — verify.** Mutations write `envelope`, `sourceEnvelope`, `destinationEnvelope` as *fields* inside `.update()` ([currency-utils.ts:664-665](lib/currency-utils.ts:664), [759-761](lib/currency-utils.ts:759)) while the real relationships are made via `.link()`. None of those three are declared on the `allowanceTransactions` entity ([instant.schema.ts:37-46](instant.schema.ts:37)). They're either schemaless shadow attributes or silently ignored; `reconcileEnvelope`'s `where: { envelope: envelopeId }` works via the link, not the field. Declare them (as indexed strings) or stop writing them — as-is, it's ambiguous which one queries hit.
- **Negative balances vanish on envelope deletion.** `deleteEnvelope` migrates only `amount > 0` per currency ([currency-utils.ts:826-828](lib/currency-utils.ts:826)); a negative balance (debt) is erased with no ledger record. Migrate all non-zero balances.
- **Deleted envelopes strand their ledger.** The delete removes the envelope row; its transactions keep pointing at a dead ID. `TransactionHistoryView` and reconciliation must tolerate that today. Consider an `archivedAt` soft-delete for envelopes instead — the UI hides them, the ledger stays coherent.
- **Legacy `i.any()` fields** on envelopes (`amount`, `currency` — [instant.schema.ts:28-30](instant.schema.ts:28)) predate the `balances` JSON. Migrate/remove.
- **Float money math throughout.** Balances, rewards, and the reconcile epsilon (`0.001`) all ride IEEE doubles; repeated allowance percentages (`(percentage/100) * amount`) plus `toFixed(2)` round-trips will drift by cents over years. Standard fix: integer minor units per currency (`unitDefinitions.decimalPlaces` already exists to drive this). Big migration — schedule it consciously or accept and document cent-level drift.

---

## 6. Distribution page specifics

- The post-payout refresh is commented out due to a suspected race ([allowance-distribution/page.tsx:526](app/allowance-distribution/page.tsx:526), [610](app/allowance-distribution/page.tsx:610)) — after paying, stale "amount due" remains until manual reload. The atomic-payout fix (1.3) plus deriving the view from live queries (instead of the imperative `processAllowanceData` snapshot) removes the race properly.
- `calculatePeriodDetails` is `async` but performs no awaits — drop the `async` or the pretense; it currently runs sequentially per member per period with rrule expansion inside (`getChoreOccurrencesForMemberInPeriod` × chores × occurrences — same O(history) rotation cost flagged in the chores audit 5.1).
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
4. Wire `reconcileEnvelope` into finance-page load + pre-distribution (1.2).
5. Declare or drop the undeclared transaction attributes (§5).
6. Migrate negative balances on envelope delete; consider soft-delete (§5).

**Phase 2 — permissions & secrets:**
7. Envelope `delete: isParent`; `exchangeRates` writes parent/server-only; ~~`allowanceAwarded` kid-write closure~~ **completed and deployed 2026-07-14** (§3).
8. Rotate the OpenExchangeRates key; move rate fetching server-side (§4).

**Phase 3 — structural:**
9. Ledger-authoritative balances (or server-mediated money ops) — the durable fix for §1 and §3 together.
10. Integer minor-unit migration decision (§5).
11. Distribution page: live-query-derived state, drop the imperative snapshot (§6).
