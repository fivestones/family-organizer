export type FamilyRole = 'parent' | 'child';

/** A member's photo at each size it was resized to, by pixel width. */
export interface MemberPhotoUrls {
    '64'?: string;
    '320'?: string;
    '1200'?: string;
}

/** One person in the family. */
export interface FamilyMember {
    id: string;
    name: string;
    role: FamilyRole;
    email: string | null;
    color: string | null;
    photoUrls: MemberPhotoUrls | null;
    /** The member's place in the family's own ordering. A roster is always returned in this order. */
    sortOrder: number;
    /** Whether a PIN is set. The PIN's hash itself never leaves the server. */
    hasPin: boolean;

    // Allowance
    allowanceAmount: number | null;
    allowanceCurrency: string | null;
    /** An RFC 5545 recurrence rule for when the allowance is paid. */
    allowanceRrule: string | null;
    /** ISO 8601. */
    allowanceStartDate: string | null;
    allowancePayoutDelayDays: number | null;
    allowanceConfig: Record<string, unknown> | null;

    // The member's own preferences
    lastDisplayCurrency: string | null;
    viewShowChoreDescriptions: boolean | null;
    viewShowTaskDetails: boolean | null;
    messageQuietHoursEnabled: boolean | null;
    /** `HH:mm`. */
    messageQuietHoursStart: string | null;
    /** `HH:mm`. */
    messageQuietHoursEnd: string | null;
    messageDigestMode: string | null;
    messageDigestWindowMinutes: number | null;
}
