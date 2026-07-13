# Audit: Finance / Allowance System

**Date:** 2026-07-12
**Scope:** `lib/currency-utils.ts` (all money mutations), `app/allowance-distribution/page.tsx`, `components/allowance/*`, allowance math in `lib/chore-utils.ts` (`calculatePeriodDetails`, `getAllowancePeriodForDate`), finance entities/permissions in `instant.schema.ts` / `instant.perms.ts`.
**Method:** Static code-path tracing.

---

## Implementation progress

- **2026-07-14 — Completed upstream: duplicate up-for-grabs claims no longer double-pay (§2; fix plan 3).** All claim entry points now use one UUIDv5 completion ID per `(choreId, dateDue)`, causing concurrent Instant transactions to converge. Allowance preprocessing also canonicalizes legacy duplicate rows by earliest completion, excludes losing rows from every member's calculation, and expands the winner's `completionsToMark` to mark the entire duplicate group awarded. XP follows the same canonical winner. Verification: 37 focused shared-core/chore-utils/ChoresTracker tests pass; `tsc --noEmit` passes.

---

## Executive summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High (Confirmed)** | Every balance mutation is a client-side read-modify-write of the whole `balances` JSON — concurrent operations lose money silently |
| 2 | **High (Confirmed)** | Fixed rewards earned in a non-primary currency are never paid out, but their completions are marked awarded — the money is permanently lost |
| 3 | **High (Confirmed)** | Payout is two separate transactions (deposit, then mark-awarded) — a failure in between double-pays on retry |
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

### 1.3 Non-atomic payout → double pay — **Confirmed**

Both payout paths run two awaited steps: `executeAllowanceTransaction(...)` then `markCompletionsAwarded(...)` ([allowance-distribution/page.tsx:516-517](app/allowance-distribution/page.tsx:516) and [602-603](app/allowance-distribution/page.tsx:602)). If the deposit lands and the marking fails (tab closed, network drop, permission hiccup), every completion in the period remains unawarded — the next distribution recalculates and pays the same period again.

**Fix:** build one combined `db.transact` (deposit + balance update + all `allowanceAwarded: true` updates + history event). For idempotency, stamp the period identity (`memberId-periodStart`) on the transaction row and skip execution if a transaction for that period already exists.

### 1.4 Foreign-currency fixed rewards are never paid — **Confirmed**

`calculatePeriodDetails` accumulates `fixedRewardsEarned` per currency ([chore-utils.ts:563-567](lib/chore-utils.ts:563)), but both payout handlers deposit **only the member's primary allowance currency**, with the code admitting it: *"Fixed rewards in other currencies are ignored for this primary currency transaction"* ([allowance-distribution/page.tsx:506-507](app/allowance-distribution/page.tsx:506)). The completions backing those rewards are still in `completionsToMark`, so they get flagged `allowanceAwarded: true` — a kid who did a chore with a 500-NPR fixed reward while their allowance currency is USD **silently never receives it**, and the period can never be re-run.

**Fix:** in the payout transact, loop `period.fixedRewardsEarned` and issue one deposit per currency (envelopes already support multi-currency balances). Until then, at least exclude those completions from `completionsToMark`.

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
| `choreCompletions.allowanceAwarded` | update `isFamilyPrincipal` | Kids can re-arm paid completions for re-payment (chores audit 2.1) |

Kids do legitimately need to deposit/withdraw/transfer (each touches two envelopes' balances), and CEL can't validate arithmetic — so `update: isParent` alone would break the product. Realistic options:

1. **Ledger-authoritative model (1.1)** shrinks the blast radius: if balances are derived and reconciled, a forged balance write is detected and reverted; the append-only ledger with `auditMatchesPrincipal` stays the source of truth.
2. Move kid-initiated money ops to a small server route (admin SDK validates: own envelopes only, sufficient funds, writes ledger + balances atomically). Then envelope `update`/`delete` can become `isParent`.
3. At minimum now: `delete: isParent` on envelopes, `create/update/delete: isParent` on `exchangeRates` (writes can move server-side, see 4.2), and the `allowanceAwarded` field rule.

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
1. Atomic payout: single transact for deposit + balance + `allowanceAwarded` marks, with per-period idempotency (1.3).
2. Pay `fixedRewardsEarned` per currency in that same transact (1.4).
3. ~~Deterministic up-for-grabs completion IDs (chores audit 1.1 — double-pay source).~~ **Completed 2026-07-14, including legacy payout deduplication.**

**Phase 1 — trust the ledger:**
4. Wire `reconcileEnvelope` into finance-page load + pre-distribution (1.2).
5. Declare or drop the undeclared transaction attributes (§5).
6. Migrate negative balances on envelope delete; consider soft-delete (§5).

**Phase 2 — permissions & secrets:**
7. Envelope `delete: isParent`; `exchangeRates` writes parent/server-only; `allowanceAwarded` field rule (§3).
8. Rotate the OpenExchangeRates key; move rate fetching server-side (§4).

**Phase 3 — structural:**
9. Ledger-authoritative balances (or server-mediated money ops) — the durable fix for §1 and §3 together.
10. Integer minor-unit migration decision (§5).
11. Distribution page: live-query-derived state, drop the imperative snapshot (§6).
