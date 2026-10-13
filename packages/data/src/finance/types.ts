/**
 * Money is changed by asking the server (docs/powersync-migration.md, "Money is written only by the server"). These
 * are the things that can be asked, and what comes back. A device reads envelopes, balances and the ledger from its
 * own database like anything else; it writes none of them but an envelope's name, description and goal.
 */

/** One period of an allowance being paid out. Its dates are days, or instants whose UTC day is meant. */
export interface AllowancePayoutPeriod {
    id: string;
    periodStartDate: Date | string;
    periodEndDate: Date | string;
    /** In the payout's own currency. Negative when the period ends owing. */
    amount: number;
    /** Fixed rewards earned in other currencies. */
    additionalAmountsByCurrency?: Record<string, number>;
    /** The chore completions this period pays for, marked as paid with it. */
    completionsToMark: string[];
    description?: string;
}

export type FinanceRequest =
    /** A member's first envelope. Answers with the one they have, if they have one. */
    | { operation: 'create-initial'; familyMemberId: string }
    | {
          operation: 'create-envelope';
          familyMemberId: string;
          name: string;
          description?: string;
          isDefault: boolean;
          goalAmount?: number | null;
          goalCurrency?: string | null;
      }
    | { operation: 'deposit'; envelopeId: string; amount: number; currency: string; description?: string }
    | { operation: 'withdraw'; envelopeId: string; amount: number; currency: string; description?: string }
    /** Between two envelopes of one member. */
    | { operation: 'transfer'; sourceEnvelopeId: string; destinationEnvelopeId: string; amount: number; currency: string }
    /** To an envelope of anyone's. */
    | { operation: 'transfer-person'; sourceEnvelopeId: string; destinationEnvelopeId: string; amount: number; currency: string; description?: string }
    /** Everything in the envelope moves to another of the same member's, and the envelope is put away. */
    | { operation: 'archive'; envelopeId: string; transferToEnvelopeId: string; newDefaultEnvelopeId?: string | null }
    | { operation: 'allowance-payout'; memberId: string; primaryCurrency: string; periods: AllowancePayoutPeriod[] }
    /** Replays each of a member's ledgers and puts right a balance that disagrees with it. */
    | { operation: 'reconcile'; familyMemberId: string };

export interface AllowancePayoutResult {
    /** The periods paid by this request. */
    processedPeriodIds: string[];
    /** The periods that had already been paid, and were left alone. */
    skippedPeriodIds: string[];
    amountsByCurrency: Record<string, number>;
    envelopeId: string | null;
}

export interface ReconcileResult {
    /** Envelopes whose balance was rewritten from their ledger. */
    fixedEnvelopeIds: string[];
    /** Envelopes that hold something and have no ledger to check it against. They are left as they are. */
    unverifiableEnvelopeIds: string[];
}

/** An envelope's id from the two operations that make one; nothing from those that only move money. */
export type FinanceResult = string | null | AllowancePayoutResult | ReconcileResult;
