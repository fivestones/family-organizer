import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getDeviceSessionToken, setDeviceSessionToken } from '../lib/device-session-store';
import { refreshMobileDeviceSession } from '../lib/api-client';

const DeviceSessionContext = createContext(null);

export function DeviceSessionProvider({ children }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [deviceSessionToken, setTokenState] = useState(null);
  const [activationRequired, setActivationRequired] = useState(true);
  const refreshInFlightRef = useRef(false);

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
      if (refreshInFlightRef.current) return;

      refreshInFlightRef.current = true;
      try {
        const refreshed = await refreshMobileDeviceSession();
        if (refreshed?.deviceSessionToken) {
          await setDeviceSessionToken(refreshed.deviceSessionToken);
          setTokenState(refreshed.deviceSessionToken);
        }
      } catch (error) {
        if (error?.status === 401) {
          await setDeviceSessionToken(null);
          setTokenState(null);
          setActivationRequired(true);
          return;
        }
        // Keep the existing token on transient failures. The backend will reject stale tokens and the UI can re-activate.
      } finally {
        refreshInFlightRef.current = false;
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

  return <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>;
}

export function useDeviceSession() {
  const value = useContext(DeviceSessionContext);
  if (!value) {
    throw new Error('useDeviceSession must be used inside DeviceSessionProvider');
  }
  return value;
}
