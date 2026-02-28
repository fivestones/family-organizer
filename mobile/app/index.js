import React, { useEffect } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAppSession } from '../src/providers/AppProviders';
import { colors } from '../src/theme/tokens';

export default function IndexScreen() {
  const { isBootstrapping, activationRequired, isAuthenticated } = useAppSession();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = Boolean(rootNavigationState?.key);

  const targetRoute = activationRequired ? '/activate' : isAuthenticated ? '/dashboard' : '/lock';

  useEffect(() => {
    if (isBootstrapping || !navigationReady) return;
    router.replace(targetRoute);
  }, [isBootstrapping, navigationReady, router, targetRoute]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.accentChores} />
    </View>
  );
}
