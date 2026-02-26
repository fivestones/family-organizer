import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '../src/providers/AppProviders';
import { colors } from '../src/theme/tokens';

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="dark" backgroundColor={colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </AppProviders>
  );
}

