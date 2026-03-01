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
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSelection() {
      if (!deviceSessionToken) {
        if (!cancelled) {
          setCurrentUserId(null);
          setCurrentUser(null);
          setIsRestoringSelection(false);
        }
        return;
      }

      setIsRestoringSelection(true);
      const storedId = await getCurrentFamilyMemberId();
      if (cancelled) return;

      setCurrentUserId(storedId || null);
      setIsRestoringSelection(false);
    }

    void restoreSelection();

    return () => {
      cancelled = true;
    };
  }, [deviceSessionToken]);

  const familyQuery = db.useQuery(
    deviceSessionToken && instantReady && auth.user
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
          },
        }
      : null
  );

  const familyMembers = useMemo(() => (familyQuery.data?.familyMembers || []).map(mapMember), [familyQuery.data?.familyMembers]);

  useEffect(() => {
    if (!currentUserId) {
      setCurrentUser(null);
      return;
    }

    if (familyQuery.isLoading) return;

    const found = familyMembers.find((member) => member.id === currentUserId);
    if (found) {
      setCurrentUser(found);
      return;
    }

    if (familyMembers.length > 0) {
      void clearCurrentFamilyMemberId();
      setCurrentUserId(null);
      setCurrentUser(null);
    }
  }, [currentUserId, familyMembers, familyQuery.isLoading]);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role !== 'parent') return;
    if (principalType === 'parent') return;

    void clearCurrentFamilyMemberId();
    setCurrentUserId(null);
    setCurrentUser(null);
  }, [currentUser, principalType]);

  const login = useCallback(async (member) => {
    await setCurrentFamilyMemberId(member.id);
    setCurrentUserId(member.id);
    setCurrentUser(mapMember(member));
  }, []);

  const clearFamilySessionState = useCallback(async () => {
    await clearCurrentFamilyMemberId();
    setCurrentUserId(null);
    setCurrentUser(null);
  }, []);

  const lock = useCallback(async () => {
    const wasParent = currentUser?.role === 'parent' || principalType === 'parent';
    await clearFamilySessionState();

    if (wasParent) {
      await ensureKidPrincipal({ clearParentSession: true });
    }
  }, [clearFamilySessionState, currentUser?.role, ensureKidPrincipal, principalType]);

  const value = useMemo(
    () => ({
      currentUser,
      currentUserId,
      isAuthenticated: !!currentUser,
      isRestoringSelection,
      familyMembers,
      familyMembersLoading: familyQuery.isLoading,
      familyMembersError: familyQuery.error,
      login,
      lock,
      clearFamilySessionState,
    }),
    [
      currentUser,
      currentUserId,
      isRestoringSelection,
      familyMembers,
      familyQuery.isLoading,
      familyQuery.error,
      login,
      lock,
      clearFamilySessionState,
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
