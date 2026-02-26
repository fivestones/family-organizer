import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';

export default function TabsLayout() {
  const {
    activationRequired,
    isAuthenticated,
    instantReady,
    isBootstrapping,
    isOffline,
    connectionStatus,
    principalType,
  } = useAppSession();

  if (activationRequired) {
    return <Redirect href="/activate" />;
  }

  if (isBootstrapping || !instantReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 10 }}>
        <ActivityIndicator size="large" color={colors.accentChores} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/lock" />;
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:
          route.name === 'chores'
            ? colors.accentChores
            : route.name === 'calendar'
            ? colors.accentCalendar
            : route.name === 'finance'
            ? colors.accentFinance
            : colors.accentMore,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: '#fffdf7',
          borderTopColor: colors.line,
          height: 62,
          paddingTop: 6,
        },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarBadge:
          route.name === 'more'
            ? isOffline
              ? '!'
              : principalType === 'parent'
              ? 'P'
              : undefined
            : undefined,
        tabBarBadgeStyle: {
          backgroundColor: isOffline ? '#D46A4C' : '#6E5B8C',
          color: '#fff',
          fontSize: 10,
          minWidth: 18,
          height: 18,
        },
      })}
    >
      <Tabs.Screen name="chores" options={{ title: 'Chores', tabBarButtonTestID: 'tab-chores' }} />
      <Tabs.Screen
        name="calendar"
        options={{
          title: connectionStatus === 'authenticated' ? 'Calendar' : 'Calendar',
          tabBarButtonTestID: 'tab-calendar',
        }}
      />
      <Tabs.Screen name="finance" options={{ title: 'Finance', tabBarButtonTestID: 'tab-finance' }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarButtonTestID: 'tab-more' }} />
    </Tabs>
  );
}
