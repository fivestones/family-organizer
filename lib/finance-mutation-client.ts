import { getCachedMemberToken } from '@/lib/instant-principal-storage';

export type FinanceMutationRequest =
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
    | { operation: 'transfer'; sourceEnvelopeId: string; destinationEnvelopeId: string; amount: number; currency: string }
    | {
          operation: 'transfer-person';
          sourceEnvelopeId: string;
          destinationEnvelopeId: string;
          amount: number;
          currency: string;
          description?: string;
      }
    | {
          operation: 'archive';
          envelopeId: string;
          transferToEnvelopeId: string;
          newDefaultEnvelopeId?: string | null;
      };

export async function requestFinanceMutation<TResult = null>(request: FinanceMutationRequest): Promise<TResult> {
    const token = getCachedMemberToken();
    if (!token) throw new Error('Family member auth is required for finance changes.');

    const response = await fetch('/api/finance/mutations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'content-type': 'application/json',
            'x-instant-auth-token': token,
        },
        body: JSON.stringify(request),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Finance change failed.');
    }
    return payload?.result as TResult;
}
