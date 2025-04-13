// components/allowance/FamilyAllowanceView.tsx
'use client'; // Needed for hooks like useState, useEffect, useQuery

import React, { useState, useMemo, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react'; // Import InstantDB hooks [cite: 67]

// Import the child components
import FamilyMembersList from '@/components/FamilyMembersList'; // Your existing component
import MemberAllowanceDetail from '@/components/allowance/MemberAllowanceDetail'; // The new detail component

// **** Import types ****
import { UnitDefinition, Envelope } from '@/lib/currency-utils';


// It's generally better to initialize db once, perhaps in a central file
// If initializing here, ensure Schema type is imported
const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || "http://kepler.local:8888",
  websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || "ws://kepler.local:8888/runtime/session",
});

export default function FamilyAllowanceView() {
    // State to track which member's details are being shown
    // Initialize with null or potentially 'All' depending on FamilyMembersList's default behavior
    const [selectedMemberId, setSelectedMemberId] = useState<string | null | 'All'>(null);

    // **** UPDATED QUERY: Fetch members, ALL envelopes, and unit definitions ****
    const { isLoading: isLoadingAppData, error: errorAppData, data: appData } = db.useQuery({
        familyMembers: {
            // Fetch all fields for members by default
             allowanceEnvelopes: {} // Fetch linked envelopes for calculation later
        },
        // Fetch all envelopes separately to easily get all balances
        allowanceEnvelopes: {},
        unitDefinitions: {}
    });

    // --- Derived Data ---
    const familyMembers = useMemo(() => appData?.familyMembers || [], [appData?.familyMembers]);
    const allEnvelopes: Envelope[] = useMemo(() => appData?.allowanceEnvelopes || [], [appData?.allowanceEnvelopes]);
    const unitDefinitions: UnitDefinition[] = useMemo(() => appData?.unitDefinitions || [], [appData?.unitDefinitions]);

    // **** NEW: Compute all monetary currencies in use ****
    const allMonetaryCurrenciesInUse = useMemo(() => {
        const codesInBalances = new Set<string>();
        allEnvelopes.forEach(env => {
            if (env.balances) {
                Object.keys(env.balances).forEach(code => codesInBalances.add(code.toUpperCase()));
            }
        });

        const codesInDefs = new Set<string>(
            unitDefinitions.map(def => def.code.toUpperCase())
        );

        const allCodes = new Set([...codesInBalances, ...codesInDefs]);
        const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));

        const monetaryCodes = Array.from(allCodes).filter(code => {
            const definition = unitDefMap.get(code);
            // It's monetary if definition exists and says so,
            // OR if no definition exists but it looks like a standard 3-letter code (heuristic)
            return definition?.isMonetary ?? (code.length === 3);
        });

        // Add common defaults if they aren't present, only if they are defined as monetary
        //  const defaultsToAdd = ["USD", "EUR", "GBP", "CAD", "AUD", "NPR"]; // Add others as needed
        //  defaultsToAdd.forEach(defaultCode => {
        //      if (!monetaryCodes.includes(defaultCode)) {
        //          const definition = unitDefMap.get(defaultCode);
        //          const isMonetary = definition?.isMonetary ?? (defaultCode.length === 3); // Check if it's monetary
        //          if (isMonetary) {
        //             monetaryCodes.push(defaultCode);
        //          }
        //      }
        //  });


        return monetaryCodes.sort(); // Sort alphabetically
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


    if (isLoadingAppData) { // [cite: 82]
        return <div className="p-4">Loading family members...</div>; // [cite: 82]
    }

    if (errorAppData) { // [cite: 83]
        console.error("Error fetching family members:", errorAppData); // [cite: 84]
        return <div className="p-4 text-red-600">Could not load family members.</div>; // [cite: 84]
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