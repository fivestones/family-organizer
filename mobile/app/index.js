import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAppSession } from '../src/providers/AppProviders';
import { colors } from '../src/theme/tokens';

export default function IndexScreen() {
  const { isBootstrapping, activationRequired, isAuthenticated } = useAppSession();

  const targetRoute = activationRequired ? '/activate' : isAuthenticated ? '/chores' : '/lock';

  if (!isBootstrapping) {
    return <Redirect href={targetRoute} />;
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.accentChores} />
    </View>
  );
}
