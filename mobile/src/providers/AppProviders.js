import React from 'react';
import { View } from 'react-native';
import { DeviceSessionProvider, useDeviceSession } from './DeviceSessionProvider';
import { NetworkStatusProvider, useNetworkStatus } from './NetworkStatusProvider';
import { InstantPrincipalProvider, useInstantPrincipal } from './InstantPrincipalProvider';
import { FamilyAuthProvider, useFamilyAuth } from './FamilyAuthProvider';

function InteractionCapture({ children }) {
  const { recordParentActivity } = useInstantPrincipal();

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordParentActivity();
        return false;
      }}
    >
      {children}
    </View>
  );
}

export function AppProviders({ children }) {
  return (
    <DeviceSessionProvider>
      <NetworkStatusProvider>
        <InstantPrincipalProvider>
          <FamilyAuthProvider>
            <InteractionCapture>{children}</InteractionCapture>
          </FamilyAuthProvider>
        </InstantPrincipalProvider>
      </NetworkStatusProvider>
    </DeviceSessionProvider>
  );
}

export function useAppSession() {
  const device = useDeviceSession();
  const network = useNetworkStatus();
  const principal = useInstantPrincipal();
  const family = useFamilyAuth();

  const principalBootstrapping =
    !device.activationRequired &&
    (principal.bootstrapStatus === 'signing_in' ||
      (principal.bootstrapStatus === 'waiting_for_device' && !!device.deviceSessionToken));

  const isBootstrapping = device.isBootstrapping || principalBootstrapping || family.isRestoringSelection;

  return {
    ...device,
    ...network,
    ...principal,
    ...family,
    isBootstrapping,
    isParentMode: principal.principalType === 'parent',
    async resetDeviceSession() {
      await family.clearFamilySessionState();
      await principal.clearPrincipalState();
      await device.clearDeviceSession();
    },
  };
}
