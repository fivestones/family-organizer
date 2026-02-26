import React, { useEffect } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAppSession } from '../src/providers/AppProviders';
import { colors } from '../src/theme/tokens';

export default function IndexScreen() {
  const router = useRouter();
  const { isBootstrapping, activationRequired } = useAppSession();

  useEffect(() => {
    if (isBootstrapping) return;
    router.replace(activationRequired ? '/activate' : '/lock');
  }, [activationRequired, isBootstrapping, router]);

  if (!isBootstrapping) {
    return <Redirect href={activationRequired ? '/activate' : '/lock'} />;
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.accentChores} />
    </View>
  );
}

