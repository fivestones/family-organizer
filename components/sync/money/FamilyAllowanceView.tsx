'use client';

import React, { useMemo, useState } from 'react';
import FamilyMembersList from '@/components/sync/family/FamilyMembersList';
import { useEnvelopes, useFamilyMembers, useUnitDefinitions } from '@/lib/data';
import { monetaryCurrencies, totalBalances } from '@/lib/money';
import MemberAllowanceDetail from './MemberAllowanceDetail';

/** The family's money: everyone with what they hold in all, and one member's envelopes beside them. */
export default function FamilyAllowanceView() {
    const [selectedMemberId, setSelectedMemberId] = useState<string | null | 'All'>(null);
    const members = useFamilyMembers();
    const envelopes = useEnvelopes();
    const { data: unitDefinitions } = useUnitDefinitions();

    const allMonetaryCurrenciesInUse = useMemo(() => monetaryCurrencies(envelopes.data, unitDefinitions), [envelopes.data, unitDefinitions]);
    // What each member holds across their envelopes, for the list.
    const membersBalances = useMemo(() => {
        const balances: Record<string, Record<string, number>> = {};
        for (const member of members.data) balances[member.id] = totalBalances(envelopes.data.filter((envelope) => envelope.familyMemberId === member.id));
        return balances;
    }, [members.data, envelopes.data]);
    const allFamilyMembers = useMemo(() => members.data.map((member) => ({ id: member.id, name: member.name })), [members.data]);

    if (members.isLoading || envelopes.isLoading) return <div className="p-4">Loading family members...</div>;
    if (members.error || envelopes.error) return <div className="p-4 text-red-600">Could not load family members.</div>;

    return (
        <div className="p-4" data-testid="money-page">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 md:flex-row md:items-start">
                <div className="rounded-lg border bg-card p-4 md:w-[clamp(260px,24vw,360px)] md:flex-shrink-0">
                    <FamilyMembersList selectedMember={selectedMemberId} setSelectedMember={setSelectedMemberId} showBalances membersBalances={membersBalances} unitDefinitions={unitDefinitions} />
                </div>

                <div className="min-w-0 flex-1">
                    {selectedMemberId && selectedMemberId !== 'All' ? (
                        <MemberAllowanceDetail key={selectedMemberId} memberId={selectedMemberId} allFamilyMembers={allFamilyMembers} allMonetaryCurrenciesInUse={allMonetaryCurrenciesInUse} unitDefinitions={unitDefinitions} />
                    ) : (
                        <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border bg-muted p-4 text-muted-foreground">
                            <p>Select a family member to view their allowance details.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
