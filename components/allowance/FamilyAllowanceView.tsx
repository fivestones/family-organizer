// components/allowance/FamilyAllowanceView.tsx
'use client'; // Needed for hooks like useState, useEffect, useQuery

import React, { useState, useMemo, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react'; // Import InstantDB hooks

// Import the child components
import FamilyMembersList from '@/components/FamilyMembersList'; // Your existing component
import MemberAllowanceDetail from '@/components/allowance/MemberAllowanceDetail'; // The new detail component

// **** Import types ****
import { UnitDefinition, Envelope, computeMonetaryCurrencies } from '@/lib/currency-utils';

// It's generally better to initialize db once, perhaps in a central file
// If initializing here, ensure Schema type is imported
const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || "http://localhost:8888",
  websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || "ws://localhost:8888/runtime/session",
});

// Define FamilyMember type based on query
interface FamilyMember {
    id: string;
    name: string;
    email?: string | null;
    photoUrls?: {
        '64'?: string;
        '320'?: string;
        '1200'?: string;
    } | null;
    // Define link structure based on query
    allowanceEnvelopes?: Envelope[]; // Optional based on query structure
}


export default function FamilyAllowanceView() {
    // State to track which member's details are being shown
    // Initialize with null or potentially 'All' depending on FamilyMembersList's default behavior
    const [selectedMemberId, setSelectedMemberId] = useState<string | null | 'All'>(null);

    // **** UPDATED QUERY: Fetch members, ALL envelopes, and unit definitions ****
    const { isLoading: isLoadingAppData, error: errorAppData, data: appData } = db.useQuery({
        familyMembers: {
            // Fetch all fields for members by default
            // We NEED allowanceEnvelopes linked here to calculate balances per member
             allowanceEnvelopes: {} // Fetch linked envelopes for calculation later
        },
        // Fetch all envelopes separately to easily get all balances if needed elsewhere (or remove if redundant)
        allowanceEnvelopes: {},// Keep this for calculating allMonetaryCurrenciesInUse
        unitDefinitions: {}
    });

    // --- Derived Data ---
    const familyMembers: FamilyMember[] = useMemo(() => appData?.familyMembers || [], [appData?.familyMembers]); // Add type annotation
    const allEnvelopes: Envelope[] = useMemo(() => appData?.allowanceEnvelopes || [], [appData?.allowanceEnvelopes]);
    const unitDefinitions: UnitDefinition[] = useMemo(() => appData?.unitDefinitions || [], [appData?.unitDefinitions]);

    // **** NEW: Compute total balances per member ****
    const membersBalances = useMemo(() => {
        const balances: { [memberId: string]: { [currency: string]: number } } = {};
        // Use appData.familyMembers which directly links envelopes to members
        (appData?.familyMembers || []).forEach(member => {
            const memberId = member.id;
            balances[memberId] = {}; // Initialize balance object for member
            (member.allowanceEnvelopes || []).forEach(envelope => {
                if (envelope.balances) {
                    Object.entries(envelope.balances).forEach(([currency, amount]) => {
                        const upperCaseCurrency = currency.toUpperCase();
                        balances[memberId][upperCaseCurrency] = (balances[memberId][upperCaseCurrency] || 0) + amount;
                    });
                }
            });
        });
        return balances;
    }, [appData?.familyMembers]); // Depend on the queried data structure

    // +++ Use the new utility function +++
    const allMonetaryCurrenciesInUse = useMemo(() => {
        return computeMonetaryCurrencies(allEnvelopes, unitDefinitions);
    }, [allEnvelopes, unitDefinitions]);


    // --- Placeholder functions for adding/deleting members ---
    // You should replace these with your actual implementation,
    // possibly imported from a utility file or defined here if simple.
    const handleAddFamilyMember = async (name: string, email: string | null, photoFile: File | null) => {
        console.log("Adding member (placeholder):", name, email, photoFile);
        // Your actual logic using db.transact and potentially file upload API
        // Example structure:
        // const memberId = id();
        // const updates: any = { name, email: email || '' };
        // if (photoFile) { /* Upload logic -> get photoUrls */ updates.photoUrls = {/* ... */}; }
        // await db.transact(tx.familyMembers[memberId].update(updates));
        alert("Add functionality not fully implemented in this example.");
    };

    const handleDeleteFamilyMember = async (memberId: string) => {
        console.log("Deleting member (placeholder):", memberId);
        // Your actual logic using db.transact
        // Example: await db.transact(tx.familyMembers[memberId].delete());
        // Remember to handle associated data cleanup if necessary (e.g., delete photos)
        if (selectedMemberId === memberId) {
            setSelectedMemberId(null); // Deselect if the deleted member was selected
        }
        alert("Delete functionality not fully implemented in this example.");
    };
    // --- End Placeholder functions ---


    if (isLoadingAppData) {
        return <div className="p-4">Loading family members...</div>;
    }

    if (errorAppData) {
        console.error("Error fetching family members:", errorAppData);
        return <div className="p-4 text-red-600">Could not load family members.</div>;
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">

            {/* Column 1: Family Member List */}
            <div className="md:col-span-1 border rounded-lg p-4 bg-card">
                <FamilyMembersList
                    familyMembers={familyMembers}
                    selectedMember={selectedMemberId}
                    setSelectedMember={setSelectedMemberId}
                    addFamilyMember={handleAddFamilyMember}
                    deleteFamilyMember={handleDeleteFamilyMember}
                    db={db}
                    // **** NEW: Pass balance data ****
                    showBalances={true} // Enable balance display
                    membersBalances={membersBalances}
                    unitDefinitions={unitDefinitions}
                 />
            </div>

            {/* Column 2: Member Allowance Details (Conditional) */}
            <div className="md:col-span-2">
                {(selectedMemberId && selectedMemberId !== 'All') ? (
                    <MemberAllowanceDetail
                        memberId={selectedMemberId}
                        // Pass only the members needed for transfer recipient list
                        allFamilyMembers={familyMembers.map(m => ({ id: m.id, name: m.name }))}
                        // **** Pass the computed list and definitions ****
                        allMonetaryCurrenciesInUse={allMonetaryCurrenciesInUse}
                        unitDefinitions={unitDefinitions}
                        db={db} // Pass db instance
                    />
                ) : (
                    // Placeholder when no family member is selected
                    <div className="p-4 border rounded-lg bg-muted text-muted-foreground h-full flex items-center justify-center min-h-[200px]">
                        <p>Select a family member to view their allowance details.</p>
                    </div>
                )}
            </div>

        </div>
    );
}