import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { db } from '../lib/instant-db';
import { getKidInstantToken, getParentInstantToken } from '../lib/api-client';
import {
  clearPrincipalTokens,
  getKidPrincipalToken,
  getParentPrincipalToken,
  setKidPrincipalToken,
  setParentPrincipalToken,
} from '../lib/device-session-store';
import { useDeviceSession } from './DeviceSessionProvider';
import {
  DEFAULT_PARENT_SHARED_DEVICE,
  clearParentLastActivityAt,
  clearParentSharedDeviceMode,
  clearPreferredPrincipal,
  clearPrincipalPrefs,
  getParentLastActivityAt,
  getParentSharedDeviceIdleTimeoutMs,
  getParentSharedDeviceMode,
  getParentUnlocked,
  getPreferredPrincipal,
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

  const isParentModeActive = principalType === 'parent' && parentUnlocked && isParentSessionSharedDevice;

  const persistParentActivity = useCallback(
    async (force = false) => {
      if (!isParentModeActive) return;
      const now = lastParentActivityMsRef.current || Date.now();
      if (!force && now - lastParentPersistMsRef.current < 5000) return;
      lastParentPersistMsRef.current = now;
      await setParentLastActivityAt(now);
    },
    [isParentModeActive]
  );

  const clearParentSessionState = useCallback(async () => {
    await setParentPrincipalToken(null);
    await setParentUnlocked(false);
    await clearParentLastActivityAt();
    setParentUnlockedState(false);
    setHasCachedParentPrincipal(false);
  }, []);

  const signInWithPrincipalToken = useCallback(
    async (principal, token, opts = {}) => {
      await db.auth.signInWithToken(token);

      if (principal === 'kid') {
        if (opts.cacheToken !== false) {
          await setKidPrincipalToken(token);
        }
        await setPreferredPrincipal('kid');
        setPrincipalType('kid');
      } else {
        if (opts.cacheToken !== false) {
          await setParentPrincipalToken(token);
        }
        const unlockParent = opts.unlockParent !== false;
        await setParentUnlocked(unlockParent);
        await setPreferredPrincipal('parent');
        setParentUnlockedState(unlockParent);
        setHasCachedParentPrincipal(true);
        setPrincipalType('parent');
        lastParentActivityMsRef.current = Date.now();
        await setParentLastActivityAt(lastParentActivityMsRef.current);
      }

      bootstrappedRef.current = true;
      setBootstrapError(null);
      setBootstrapStatus('ready');
    },
    []
  );

  const ensureKidPrincipal = useCallback(
    async (opts = {}) => {
      if (!deviceSessionToken) {
        throw new Error('Device activation is required');
      }

      setIsSwitchingPrincipal(true);
      try {
        if (opts.clearParentSession) {
          await clearParentSessionState();
          await clearParentSharedDeviceMode();
          setIsParentSessionSharedDevice(DEFAULT_PARENT_SHARED_DEVICE);
        }

        if (!opts.clearParentSession && auth.user && principalType === 'kid') {
          return;
        }

        const allowCached = opts.preferCached !== false;
        if (allowCached) {
          const cachedKidToken = await getKidPrincipalToken();
          if (cachedKidToken) {
            try {
              await signInWithPrincipalToken('kid', cachedKidToken, { cacheToken: false });
              return;
            } catch {
              await setKidPrincipalToken(null);
            }
          }
        }

        const response = await getKidInstantToken();
        await signInWithPrincipalToken('kid', response.token);
      } catch (error) {
        if (error?.status === 401) {
          await resetForUnauthorizedDevice();
        }
        throw error;
      } finally {
        setIsSwitchingPrincipal(false);
      }
    },
    [
      auth.user,
      clearParentSessionState,
      deviceSessionToken,
      principalType,
      resetForUnauthorizedDevice,
      signInWithPrincipalToken,
    ]
  );

  const elevateParentPrincipal = useCallback(
    async ({ familyMemberId, pin, sharedDevice }) => {
      if (!deviceSessionToken) {
        throw new Error('Device activation is required');
      }

      const sharedDeviceMode =
        typeof sharedDevice === 'boolean' ? sharedDevice : isParentSessionSharedDevice;
      await setParentSharedDeviceMode(sharedDeviceMode);
      setIsParentSessionSharedDevice(sharedDeviceMode);

      lastParentActivityMsRef.current = Date.now();
      await setParentLastActivityAt(lastParentActivityMsRef.current);

      setIsSwitchingPrincipal(true);
      try {
        if (auth.user && principalType === 'parent' && parentUnlocked) {
          return;
        }

        const cachedParentToken = await getParentPrincipalToken();
        if (cachedParentToken && parentUnlocked) {
          try {
            await signInWithPrincipalToken('parent', cachedParentToken, {
              cacheToken: false,
              unlockParent: true,
            });
            return;
          } catch {
            await clearParentSessionState();
          }
        }

        const response = await getParentInstantToken({ familyMemberId, pin });
        await signInWithPrincipalToken('parent', response.token, { unlockParent: true });
      } catch (error) {
        if (error?.status === 401) {
          await resetForUnauthorizedDevice();
        }
        throw error;
      } finally {
        setIsSwitchingPrincipal(false);
      }
    },
    [
      auth.user,
      clearParentSessionState,
      deviceSessionToken,
      isParentSessionSharedDevice,
      parentUnlocked,
      principalType,
      resetForUnauthorizedDevice,
      signInWithPrincipalToken,
    ]
  );

  const demoteParentPrincipal = useCallback(async () => {
    await ensureKidPrincipal({ clearParentSession: true });
  }, [ensureKidPrincipal]);

  const clearPrincipalState = useCallback(async () => {
    clearIdleTimer();
    bootstrappedRef.current = false;
    setBootstrapError(null);
    setBootstrapStatus('waiting_for_device');
    setPrincipalType('unknown');
    setParentUnlockedState(false);
    setHasCachedParentPrincipal(false);
    setIsParentSessionSharedDevice(DEFAULT_PARENT_SHARED_DEVICE);
    await clearPrincipalTokens();
    await clearPrincipalPrefs();
    await clearPreferredPrincipal();
    await clearParentSharedDeviceMode();
    await safeSignOutInstant();
  }, [clearIdleTimer]);

  const resetForUnauthorizedDevice = useCallback(async () => {
    await clearPrincipalState();
    await clearDeviceSession();
  }, [clearDeviceSession, clearPrincipalState]);

  const retryBootstrap = useCallback(() => {
    bootstrappedRef.current = false;
    setBootstrapError(null);
    setBootstrapVersion((v) => v + 1);
  }, []);

  const recordParentActivity = useCallback(() => {
    if (!isParentModeActive) return;

    const now = Date.now();
    lastParentActivityMsRef.current = now;
    void persistParentActivity(false);

    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      void ensureKidPrincipal({ clearParentSession: true }).catch((error) => {
        setBootstrapError(error);
        setBootstrapStatus('error');
      });
    }, parentSharedDeviceIdleTimeoutMs);
  }, [clearIdleTimer, ensureKidPrincipal, isParentModeActive, parentSharedDeviceIdleTimeoutMs, persistParentActivity]);

  useEffect(() => {
    let cancelled = false;

    async function syncPrefs() {
      if (!deviceSessionToken) {
        setIsPrefsLoaded(true);
        return;
      }

      const [storedParentUnlocked, storedSharedMode, storedLastActivity, storedParentToken] =
        await Promise.all([
          getParentUnlocked(),
          getParentSharedDeviceMode(),
          getParentLastActivityAt(),
          getParentPrincipalToken(),
        ]);

      if (cancelled) return;

      setParentUnlockedState(storedParentUnlocked);
      setIsParentSessionSharedDevice(storedSharedMode);
      setHasCachedParentPrincipal(Boolean(storedParentToken));
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

      if (!isPrefsLoaded) return;
      if (bootstrappedRef.current && auth.user) {
        setBootstrapStatus('ready');
        return;
      }

      setBootstrapStatus('signing_in');
      setBootstrapError(null);

      try {
        const preferred = await getPreferredPrincipal();
        const cachedParentToken = await getParentPrincipalToken();
        const canReuseParent = preferred === 'parent' && (await getParentUnlocked()) && !!cachedParentToken;

        if (canReuseParent && cachedParentToken) {
          try {
            await signInWithPrincipalToken('parent', cachedParentToken, {
              cacheToken: false,
              unlockParent: true,
            });
            if (!cancelled) {
              setBootstrapStatus('ready');
            }
            return;
          } catch {
            await clearParentSessionState();
          }
        }

        await ensureKidPrincipal({ preferCached: true });
        if (!cancelled) {
          setBootstrapStatus('ready');
        }
      } catch (error) {
        if (error?.status === 401) {
          await resetForUnauthorizedDevice();
        }
        if (cancelled) return;
        setBootstrapError(error);
        setBootstrapStatus('error');
      }
    }

    void bootstrapPrincipal();

    return () => {
      cancelled = true;
    };
  }, [
    auth.user,
    bootstrapVersion,
    clearIdleTimer,
    clearParentSessionState,
    deviceSessionToken,
    ensureKidPrincipal,
    isPrefsLoaded,
    resetForUnauthorizedDevice,
    signInWithPrincipalToken,
  ]);

  useEffect(() => {
    if (!isParentModeActive) {
      clearIdleTimer();
      return;
    }

    let cancelled = false;

    async function restoreTimerFromPersistedActivity() {
      const persisted = await getParentLastActivityAt();
      if (cancelled) return;

      const now = Date.now();
      const baseline = persisted && Number.isFinite(persisted) ? persisted : now;
      lastParentActivityMsRef.current = baseline;

      const idleMs = now - baseline;
      if (idleMs >= parentSharedDeviceIdleTimeoutMs) {
        void ensureKidPrincipal({ clearParentSession: true }).catch((error) => {
          setBootstrapError(error);
          setBootstrapStatus('error');
        });
        return;
      }

      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        void ensureKidPrincipal({ clearParentSession: true }).catch((error) => {
          setBootstrapError(error);
          setBootstrapStatus('error');
        });
      }, parentSharedDeviceIdleTimeoutMs - idleMs);
    }

    void restoreTimerFromPersistedActivity();

    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        await restoreTimerFromPersistedActivity();
        return;
      }

      await persistParentActivity(true);
    });

    return () => {
      cancelled = true;
      subscription.remove();
      clearIdleTimer();
      void persistParentActivity(true);
    };
  }, [
    clearIdleTimer,
    ensureKidPrincipal,
    isParentModeActive,
    parentSharedDeviceIdleTimeoutMs,
    persistParentActivity,
  ]);

  const value = useMemo(
    () => ({
      db,
      auth,
      connectionStatus,
      principalType,
      bootstrapStatus,
      bootstrapError,
      isSwitchingPrincipal,
      parentUnlocked,
      isParentSessionSharedDevice,
      parentSharedDeviceIdleTimeoutMs,
      canUseCachedParentPrincipal: parentUnlocked && hasCachedParentPrincipal,
      instantReady: bootstrapStatus === 'ready',
      ensureKidPrincipal,
      elevateParentPrincipal,
      demoteParentPrincipal,
      clearPrincipalState,
      retryBootstrap,
      recordParentActivity,
    }),
    [
      auth,
      bootstrapError,
      bootstrapStatus,
      connectionStatus,
      demoteParentPrincipal,
      elevateParentPrincipal,
      ensureKidPrincipal,
      hasCachedParentPrincipal,
      isParentSessionSharedDevice,
      isSwitchingPrincipal,
      parentSharedDeviceIdleTimeoutMs,
      parentUnlocked,
      principalType,
      clearPrincipalState,
      retryBootstrap,
      recordParentActivity,
    ]
  );

  return <InstantPrincipalContext.Provider value={value}>{children}</InstantPrincipalContext.Provider>;
}

export function useInstantPrincipal() {
  const value = useContext(InstantPrincipalContext);
  if (!value) {
    throw new Error('useInstantPrincipal must be used inside InstantPrincipalProvider');
  }
  return value;
}
