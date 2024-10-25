'use client'

import React, { useState } from 'react';
import { init } from '@instantdb/react';
import FamilyMembersList from '@/components/FamilyMembersList';
import AllowanceTracker from '@/components/AllowanceTracker';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

export default function AllowancePage() {
  const [selectedMember, setSelectedMember] = useState<string>('All');

  const { isLoading, error, data } = db.useQuery({
    familyMembers: {
      assignedChores: {},
      choreAssignments: {},
      completedChores: {},
    },
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const { familyMembers } = data;

  return (
    <div className="flex h-screen">
      <div className="w-1/4 bg-gray-100 p-4">
        <FamilyMembersList
          familyMembers={familyMembers}
          selectedMember={selectedMember}
          setSelectedMember={setSelectedMember}
          addFamilyMember={async (name, email, photoFile) => {
            // Implementation will be added later
            console.log('Adding family member:', { name, email, photoFile });
          }}
          deleteFamilyMember={async (memberId) => {
            // Implementation will be added later
            console.log('Deleting family member:', memberId);
          }}
          db={db}
        />
      </div>
      <div className="w-3/4 p-4">
        <h2 className="text-xl font-bold mb-4">
          {selectedMember === 'All' 
            ? 'All Allowances' 
            : `${familyMembers.find(m => m.id === selectedMember)?.name}'s Allowances`}
        </h2>
        {selectedMember !== 'All' && (
          <AllowanceTracker 
            familyMember={familyMembers.find(m => m.id === selectedMember)}
          />
        )}
      </div>
    </div>
  );
}