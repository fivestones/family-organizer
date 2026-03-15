import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db } from '../lib/instant-db';
import { useDeviceSession } from './DeviceSessionProvider';
import { useInstantPrincipal } from './InstantPrincipalProvider';
import { clearCurrentFamilyMemberId, getCurrentFamilyMemberId, setCurrentFamilyMemberId } from '../lib/session-prefs';

export const FamilyAuthContext = createContext(null);

function mapMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    photoUrls: member.photoUrls,
    pinHash: member.pinHash,
    viewShowChoreDescriptions: member.viewShowChoreDescriptions,
    viewShowTaskDetails: member.viewShowTaskDetails,
  };
}

export function FamilyAuthProvider({ children }) {
  const { deviceSessionToken } = useDeviceSession();
  const { auth, instantReady, principalType, ensureKidPrincipal } = useInstantPrincipal();
  const [isRestoringSelection, setIsRestoringSelection] = useState(true);
  const [lastSelectedMemberId, setLastSelectedMemberId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSelection() {
      if (!deviceSessionToken) {
        if (!cancelled) {
          setLastSelectedMemberId(null);
          setIsRestoringSelection(false);
        }
        return;
      }

      const storedId = await getCurrentFamilyMemberId();
      if (!cancelled) {
        setLastSelectedMemberId(storedId || null);
        setIsRestoringSelection(false);
      }
    }

    setIsRestoringSelection(true);
    void restoreSelection();

    return () => {
      cancelled = true;
    };
  }, [deviceSessionToken]);

  const familyQuery = db.useQuery(
    {
      familyMembers: {
        $: { order: { order: 'asc' } },
      },
    },
    {
      enabled: Boolean(deviceSessionToken && instantReady && auth.user),
    }
  );

  const familyMembers = useMemo(() => (familyQuery.data?.familyMembers || []).map(mapMember), [familyQuery.data?.familyMembers]);
  const currentFamilyMemberId =
    auth.user && typeof auth.user.familyMemberId === 'string' ? String(auth.user.familyMemberId) : null;
  const currentUser = useMemo(
    () => familyMembers.find((member) => member.id === currentFamilyMemberId) || null,
    [currentFamilyMemberId, familyMembers]
  );

  useEffect(() => {
    if (currentFamilyMemberId) {
      void setCurrentFamilyMemberId(currentFamilyMemberId);
      setLastSelectedMemberId(currentFamilyMemberId);
      return;
    }

    if (!auth.user) {
      setLastSelectedMemberId(null);
    }
  }, [auth.user, currentFamilyMemberId]);

  const login = useCallback(async (member) => {
    if (!member?.id) return;
    await setCurrentFamilyMemberId(member.id);
    setLastSelectedMemberId(member.id);
  }, []);

  const clearFamilySessionState = useCallback(async () => {
    await clearCurrentFamilyMemberId();
    setLastSelectedMemberId(null);
  }, []);

  const lock = useCallback(async () => {
    await clearFamilySessionState();
    await ensureKidPrincipal({ clearParentSession: true });
  }, [clearFamilySessionState, ensureKidPrincipal]);

  const value = useMemo(
    () => ({
      currentUser,
      currentUserId: currentFamilyMemberId,
      lastSelectedMemberId,
      isAuthenticated: !!currentUser,
      isRestoringSelection,
      familyMembers,
      familyMembersLoading: familyQuery.isLoading,
      familyMembersError: familyQuery.error,
      login,
      lock,
      clearFamilySessionState,
      principalType,
    }),
    [
      clearFamilySessionState,
      currentFamilyMemberId,
      currentUser,
      familyMembers,
      familyQuery.error,
      familyQuery.isLoading,
      isRestoringSelection,
      lastSelectedMemberId,
      login,
      lock,
      principalType,
    ]
  );

  return <FamilyAuthContext.Provider value={value}>{children}</FamilyAuthContext.Provider>;
}

export function useFamilyAuth() {
  const value = useContext(FamilyAuthContext);
  if (!value) {
    throw new Error('useFamilyAuth must be used inside FamilyAuthProvider');
  }
  return value;
}
