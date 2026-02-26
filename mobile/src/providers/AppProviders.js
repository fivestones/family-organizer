import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { getDeviceSessionToken, setDeviceSessionToken } from '../lib/device-session-store';
import { refreshMobileDeviceSession } from '../lib/api-client';

const SessionContext = createContext(null);

export function AppProviders({ children }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [deviceSessionToken, setTokenState] = useState(null);
  const [activationRequired, setActivationRequired] = useState(true);

  useEffect(() => {
    let isMounted = true;
    getDeviceSessionToken()
      .then((token) => {
        if (!isMounted) return;
        setTokenState(token);
        setActivationRequired(!token);
      })
      .finally(() => {
        if (isMounted) setIsBootstrapping(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!deviceSessionToken) return;

    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      try {
        const refreshed = await refreshMobileDeviceSession();
        if (refreshed?.deviceSessionToken) {
          await setDeviceSessionToken(refreshed.deviceSessionToken);
          setTokenState(refreshed.deviceSessionToken);
        }
      } catch {
        // Keep the existing token; server-side auth checks will force reactivation if needed.
      }
    });

    return () => {
      subscription.remove();
    };
  }, [deviceSessionToken]);

  const value = useMemo(
    () => ({
      isBootstrapping,
      activationRequired,
      deviceSessionToken,
      async completeActivation(token) {
        await setDeviceSessionToken(token);
        setTokenState(token);
        setActivationRequired(false);
      },
      async clearDeviceSession() {
        await setDeviceSessionToken(null);
        setTokenState(null);
        setActivationRequired(true);
      },
    }),
    [activationRequired, deviceSessionToken, isBootstrapping]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAppSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useAppSession must be used inside AppProviders');
  }
  return value;
}

