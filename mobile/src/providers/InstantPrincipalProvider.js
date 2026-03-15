import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { db } from '../lib/instant-db';
import { getMemberInstantToken } from '../lib/api-client';
import {
  clearPrincipalTokens,
  getActiveMemberPrincipalToken,
  setActiveMemberPrincipalToken,
  setParentPrincipalToken,
} from '../lib/device-session-store';
import { deriveDeviceAuthIssueFromError } from '../lib/device-auth-issue';
import { useDeviceSession } from './DeviceSessionProvider';
import {
  DEFAULT_PARENT_SHARED_DEVICE,
  clearCurrentFamilyMemberId,
  clearParentLastActivityAt,
  clearParentSharedDeviceMode,
  clearPreferredPrincipal,
  clearPrincipalPrefs,
  getParentLastActivityAt,
  getParentSharedDeviceIdleTimeoutMs,
  getParentSharedDeviceMode,
  getParentUnlocked,
  setCurrentFamilyMemberId,
  setParentLastActivityAt,
  setParentSharedDeviceMode,
  setParentUnlocked,
  setPreferredPrincipal,
} from '../lib/session-prefs';

export const InstantPrincipalContext = createContext(null);

async function safeSignOutInstant() {
  try {
    if (typeof db.auth?.signOut === 'function') {
      await db.auth.signOut();
    }
  } catch {
    // Best-effort only.
  }
}

export function InstantPrincipalProvider({ children }) {
  const { deviceSessionToken, clearDeviceSession } = useDeviceSession();
  const auth = db.useAuth();
  const connectionStatus = db.useConnectionStatus();
  const [bootstrapStatus, setBootstrapStatus] = useState('waiting_for_device');
  const [bootstrapError, setBootstrapError] = useState(null);
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [principalType, setPrincipalType] = useState('unknown');
  const [isSwitchingPrincipal, setIsSwitchingPrincipal] = useState(false);
  const [parentUnlocked, setParentUnlockedState] = useState(false);
  const [isParentSessionSharedDevice, setIsParentSessionSharedDevice] = useState(DEFAULT_PARENT_SHARED_DEVICE);
  const [hasCachedParentPrincipal, setHasCachedParentPrincipal] = useState(false);
  const [isPrefsLoaded, setIsPrefsLoaded] = useState(false);
  const bootstrappedRef = useRef(false);
  const idleTimerRef = useRef(null);
  const lastParentActivityMsRef = useRef(Date.now());
  const lastParentPersistMsRef = useRef(0);
  const parentSharedDeviceIdleTimeoutMs = getParentSharedDeviceIdleTimeoutMs();

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const syncPrincipalFromUser = useCallback((user) => {
    if (!user) {
      setPrincipalType('unknown');
      setParentUnlockedState(false);
      setHasCachedParentPrincipal(false);
      return;
    }

    const nextPrincipalType = user.type === 'parent' ? 'parent' : 'kid';
    setPrincipalType(nextPrincipalType);
    if (nextPrincipalType === 'parent') {
      setParentUnlockedState(true);
      setHasCachedParentPrincipal(true);
    } else {
      setParentUnlockedState(false);
      setHasCachedParentPrincipal(false);
    }
  }, []);

  const clearPrincipalState = useCallback(async () => {
    clearIdleTimer();
    bootstrappedRef.current = false;
    setBootstrapError(null);
    setBootstrapStatus(deviceSessionToken ? 'ready' : 'waiting_for_device');
    setPrincipalType('unknown');
    setParentUnlockedState(false);
    setHasCachedParentPrincipal(false);
    setIsParentSessionSharedDevice(DEFAULT_PARENT_SHARED_DEVICE);
    await clearPrincipalTokens();
    await clearCurrentFamilyMemberId();
    await clearPrincipalPrefs();
    await clearPreferredPrincipal();
    await clearParentSharedDeviceMode();
    await safeSignOutInstant();
  }, [clearIdleTimer, deviceSessionToken]);

  const resetForUnauthorizedDevice = useCallback(async (error = null) => {
    await clearPrincipalState();
    await clearDeviceSession({ issue: deriveDeviceAuthIssueFromError(error, 'instant_principal') });
  }, [clearDeviceSession, clearPrincipalState]);

  const signInFamilyMember = useCallback(async ({ familyMemberId, pin, sharedDevice } = {}) => {
    if (!deviceSessionToken) {
      throw new Error('Device activation is required');
    }
    if (!familyMemberId) {
      throw new Error('familyMemberId is required');
    }

    setIsSwitchingPrincipal(true);
    setBootstrapStatus('signing_in');
    try {
      const response = await getMemberInstantToken({ familyMemberId, pin });
      await db.auth.signInWithToken(response.token);
      await setActiveMemberPrincipalToken(response.token);
      await setCurrentFamilyMemberId(familyMemberId);

      const nextPrincipalType = response.principalType === 'parent' ? 'parent' : 'kid';
      const nextSharedMode =
        typeof sharedDevice === 'boolean' ? sharedDevice : await getParentSharedDeviceMode();
      await setParentSharedDeviceMode(nextSharedMode);
      setIsParentSessionSharedDevice(nextSharedMode);
      await setPreferredPrincipal(nextPrincipalType);

      if (nextPrincipalType === 'parent') {
        await setParentPrincipalToken(response.token);
        await setParentUnlocked(true);
        setParentUnlockedState(true);
        setHasCachedParentPrincipal(true);
        lastParentActivityMsRef.current = Date.now();
        await setParentLastActivityAt(lastParentActivityMsRef.current);
      } else {
        await setParentPrincipalToken(null);
        await setParentUnlocked(false);
        setParentUnlockedState(false);
        setHasCachedParentPrincipal(false);
        await clearParentLastActivityAt();
      }

      setPrincipalType(nextPrincipalType);
      bootstrappedRef.current = true;
      setBootstrapError(null);
      setBootstrapStatus('ready');
    } catch (error) {
      if (error?.status === 401) {
        await resetForUnauthorizedDevice(error);
      }
      setBootstrapError(error);
      setBootstrapStatus('error');
      throw error;
    } finally {
      setIsSwitchingPrincipal(false);
    }
  }, [deviceSessionToken, resetForUnauthorizedDevice]);

  const ensureKidPrincipal = useCallback(async (opts = {}) => {
    setIsSwitchingPrincipal(true);
    try {
      await clearPrincipalState();
      if (opts.clearParentSession) {
        await clearParentSharedDeviceMode();
        setIsParentSessionSharedDevice(DEFAULT_PARENT_SHARED_DEVICE);
      }
    } finally {
      setIsSwitchingPrincipal(false);
    }
  }, [clearPrincipalState]);

  const elevateParentPrincipal = useCallback(async ({ familyMemberId, pin, sharedDevice }) => {
    await signInFamilyMember({ familyMemberId, pin, sharedDevice });
  }, [signInFamilyMember]);

  const demoteParentPrincipal = useCallback(async () => {
    await ensureKidPrincipal({ clearParentSession: true });
  }, [ensureKidPrincipal]);

  const retryBootstrap = useCallback(() => {
    bootstrappedRef.current = false;
    setBootstrapError(null);
    setBootstrapVersion((value) => value + 1);
  }, []);

  const recordParentActivity = useCallback(() => {
    if (principalType !== 'parent' || !parentUnlocked || !isParentSessionSharedDevice) return;

    const now = Date.now();
    lastParentActivityMsRef.current = now;
    if (now - lastParentPersistMsRef.current >= 5000) {
      lastParentPersistMsRef.current = now;
      void setParentLastActivityAt(now);
    }

    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      void ensureKidPrincipal({ clearParentSession: true }).catch((error) => {
        setBootstrapError(error);
        setBootstrapStatus('error');
      });
    }, parentSharedDeviceIdleTimeoutMs);
  }, [clearIdleTimer, ensureKidPrincipal, isParentSessionSharedDevice, parentSharedDeviceIdleTimeoutMs, parentUnlocked, principalType]);

  useEffect(() => {
    let cancelled = false;

    async function syncPrefs() {
      if (!deviceSessionToken) {
        if (!cancelled) {
          setIsPrefsLoaded(true);
        }
        return;
      }

      const [storedParentUnlocked, storedSharedMode, storedLastActivity, storedToken] = await Promise.all([
        getParentUnlocked(),
        getParentSharedDeviceMode(),
        getParentLastActivityAt(),
        getActiveMemberPrincipalToken(),
      ]);

      if (cancelled) return;

      setParentUnlockedState(storedParentUnlocked);
      setIsParentSessionSharedDevice(storedSharedMode);
      setHasCachedParentPrincipal(Boolean(storedParentUnlocked && storedToken));
      if (storedLastActivity) {
        lastParentActivityMsRef.current = storedLastActivity;
      }
      setIsPrefsLoaded(true);
    }

    setIsPrefsLoaded(false);
    void syncPrefs();

    return () => {
      cancelled = true;
    };
  }, [deviceSessionToken]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapPrincipal() {
      if (!deviceSessionToken) {
        clearIdleTimer();
        bootstrappedRef.current = false;
        setBootstrapStatus('waiting_for_device');
        setBootstrapError(null);
        setPrincipalType('unknown');
        return;
      }

      if (!isPrefsLoaded || auth.isLoading) {
        return;
      }

      if (auth.user) {
        syncPrincipalFromUser(auth.user);
        setBootstrapStatus('ready');
        setBootstrapError(null);
        bootstrappedRef.current = true;
        return;
      }

      if (bootstrappedRef.current) {
        setBootstrapStatus('ready');
        return;
      }

      bootstrappedRef.current = true;
      setBootstrapStatus('signing_in');
      setBootstrapError(null);

      const cachedToken = await getActiveMemberPrincipalToken();
      if (!cachedToken) {
        if (!cancelled) {
          setBootstrapStatus('ready');
        }
        return;
      }

      try {
        await db.auth.signInWithToken(cachedToken);
        if (!cancelled) {
          setBootstrapStatus('ready');
        }
      } catch (error) {
        console.warn('Cached member session restore failed; clearing active member token.', error);
        await setActiveMemberPrincipalToken(null);
        if (!cancelled) {
          setBootstrapError(null);
          setBootstrapStatus('ready');
          setPrincipalType('unknown');
          setHasCachedParentPrincipal(false);
          setParentUnlockedState(false);
        }
      }
    }

    void bootstrapPrincipal();
    return () => {
      cancelled = true;
    };
  }, [
    auth.isLoading,
    auth.user,
    bootstrapVersion,
    clearIdleTimer,
    deviceSessionToken,
    isPrefsLoaded,
    syncPrincipalFromUser,
  ]);

  useEffect(() => {
    if (principalType !== 'parent' || !parentUnlocked || !isParentSessionSharedDevice) {
      clearIdleTimer();
      return;
    }

    recordParentActivity();
    return clearIdleTimer;
  }, [clearIdleTimer, isParentSessionSharedDevice, parentUnlocked, principalType, recordParentActivity]);

  useEffect(() => {
    if (principalType !== 'parent' || !parentUnlocked || !isParentSessionSharedDevice) return undefined;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        recordParentActivity();
      }
    });

    return () => subscription.remove();
  }, [isParentSessionSharedDevice, parentUnlocked, principalType, recordParentActivity]);

  const instantReady = bootstrapStatus === 'ready' && !auth.isLoading;

  const value = useMemo(() => ({
    auth,
    bootstrapStatus,
    bootstrapError,
    principalType,
    isSwitchingPrincipal,
    parentUnlocked,
    isParentSessionSharedDevice,
    hasCachedParentPrincipal,
    instantReady,
    connectionStatus,
    db,
    ensureKidPrincipal,
    elevateParentPrincipal,
    demoteParentPrincipal,
    signInFamilyMember,
    recordParentActivity,
    clearPrincipalState,
    retryBootstrap,
    canUseCachedParentPrincipal: parentUnlocked && hasCachedParentPrincipal,
  }), [
    auth,
    bootstrapError,
    bootstrapStatus,
    clearPrincipalState,
    connectionStatus,
    demoteParentPrincipal,
    elevateParentPrincipal,
    ensureKidPrincipal,
    hasCachedParentPrincipal,
    instantReady,
    isParentSessionSharedDevice,
    isSwitchingPrincipal,
    parentUnlocked,
    principalType,
    recordParentActivity,
    retryBootstrap,
    signInFamilyMember,
  ]);

  return <InstantPrincipalContext.Provider value={value}>{children}</InstantPrincipalContext.Provider>;
}

export function useInstantPrincipal() {
  const value = useContext(InstantPrincipalContext);
  if (!value) {
    throw new Error('useInstantPrincipal must be used inside InstantPrincipalProvider');
  }
  return value;
}
