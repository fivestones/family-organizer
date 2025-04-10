// components/allowance/FamilyAllowanceView.tsx
'use client'; // Needed for hooks like useState, useEffect, useQuery

import React, { useState, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react'; // Import InstantDB hooks [cite: 67]

// Import the child components
import FamilyMembersList from '@/components/FamilyMembersList'; // Your existing component
import MemberAllowanceDetail from '@/components/allowance/MemberAllowanceDetail'; // The new detail component

// It's generally better to initialize db once, perhaps in a central file
// If initializing here, ensure Schema type is imported
const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

export default function FamilyAllowanceView() {
    // State to track which member's details are being shown
    // Initialize with null or potentially 'All' depending on FamilyMembersList's default behavior
    const [selectedMemberId, setSelectedMemberId] = useState<string | null | 'All'>(null);

    // Fetch all family members
    // Do we need to sort
    const { isLoading: isLoadingMembers, error: errorMembers, data: membersData } = db.useQuery({ // [cite: 71]
        familyMembers: {} // Fetch all members - adjust if you need sorting/filtering
    });

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


    if (isLoadingMembers) { // [cite: 82]
        return <div className="p-4">Loading family members...</div>; // [cite: 82]
    }

    if (errorMembers) { // [cite: 83]
        console.error("Error fetching family members:", errorMembers); // [cite: 84]
        return <div className="p-4 text-red-600">Could not load family members.</div>; // [cite: 84]
    }

    const familyMembers = membersData?.familyMembers || [];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4"> {/* [cite: 85] */}

            {/* Column 1: Family Member List */}
            <div className="md:col-span-1 border rounded-lg p-4 bg-card"> {/* [cite: 86] */}
                <FamilyMembersList
                    familyMembers={familyMembers} // [cite: 86]
                    selectedMember={selectedMemberId} // [cite: 87]
                    setSelectedMember={setSelectedMemberId} // [cite: 87]
                    addFamilyMember={handleAddFamilyMember} // [cite: 87]
                    deleteFamilyMember={handleDeleteFamilyMember} // [cite: 87]
                    db={db} // [cite: 87]
                 />
            </div>

            {/* Column 2: Member Allowance Details (Conditional) */}
            <div className="md:col-span-2"> {/* [cite: 88] */}
                {(selectedMemberId && selectedMemberId !== 'All') ? ( // [cite: 89]
                    <MemberAllowanceDetail
                        memberId={selectedMemberId} // [cite: 90]
                        // **** NEW: Pass all family members down ****
                        allFamilyMembers={familyMembers}
                    />
                ) : (
                    // Placeholder when no member is selected
                    <div className="p-4 border rounded-lg bg-muted text-muted-foreground h-full flex items-center justify-center min-h-[200px]"> {/* [cite: 90] */}
                        <p>Select a family member to view their allowance details.</p> {/* [cite: 90] */}
                    </div>
                )}
            </div>

        </div>
    );
}