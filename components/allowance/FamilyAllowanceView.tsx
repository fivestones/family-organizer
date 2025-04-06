// components/allowance/FamilyAllowanceView.tsx
'use client'; // Needed for hooks like useState, useEffect, useQuery

import React, { useState, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react'; // Import InstantDB hooks

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

    // Fetch all family members for the list
    // Adjust query as needed (e.g., add sorting)
    const { isLoading: isLoadingMembers, error: errorMembers, data: membersData } = db.useQuery({
        familyMembers: {}
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


    if (isLoadingMembers) {
        return <div className="p-4">Loading family members...</div>;
    }

    if (errorMembers) {
        console.error("Error fetching family members:", errorMembers);
        return <div className="p-4 text-red-600">Could not load family members.</div>;
    }

    const familyMembers = membersData?.familyMembers || [];

    return (
        // Using CSS Grid for layout (adjust columns/gap as needed)
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">

            {/* Column 1: Family Member List */}
            <div className="md:col-span-1 border rounded-lg p-4 bg-card">
                <FamilyMembersList
                    familyMembers={familyMembers}
                    selectedMember={selectedMemberId}
                    // Use the state setter directly as the prop expected by your component
                    setSelectedMember={setSelectedMemberId}
                    // Pass down the add/delete handlers
                    addFamilyMember={handleAddFamilyMember}
                    deleteFamilyMember={handleDeleteFamilyMember}
                    db={db} // Pass the db instance
                 />
            </div>

            {/* Column 2: Member Allowance Details (Conditional) */}
            <div className="md:col-span-2">
                {/*
                    Render MemberAllowanceDetail only if a specific member ID is selected.
                    Handle the 'All' case if your FamilyMembersList uses it.
                */}
                {(selectedMemberId && selectedMemberId !== 'All') ? (
                    <MemberAllowanceDetail memberId={selectedMemberId} />
                ) : (
                    <div className="p-4 border rounded-lg bg-muted text-muted-foreground h-full flex items-center justify-center min-h-[200px]">
                        <p>Select a family member to view their allowance details.</p>
                    </div>
                )}
            </div>

        </div>
    );
}