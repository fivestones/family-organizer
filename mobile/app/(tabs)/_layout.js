import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { withAlpha } from '../../src/theme/tokens';

export default function TabsLayout() {
  const { colors } = useAppTheme();
  const {
    activationRequired,
    isAuthenticated,
    instantReady,
    isBootstrapping,
    isOffline,
    connectionStatus,
    principalType,
  } = useAppSession();

  if (activationRequired) return <Redirect href="/activate" />;
  if (!isAuthenticated) return <Redirect href="/lock" />;

  if (isBootstrapping || !instantReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 10 }}>
        <ActivityIndicator size="large" color={colors.accentChores} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:
          route.name === 'dashboard'
            ? colors.accentDashboard
            : route.name === 'chores'
            ? colors.accentChores
            : route.name === 'calendar'
            ? colors.accentCalendar
            : route.name === 'finance'
            ? colors.accentFinance
            : colors.accentMore,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.panel,
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
          backgroundColor: isOffline ? colors.accentChores : colors.accentMore,
          color: colors.onAccent,
          fontSize: 10,
          minWidth: 18,
          height: 18,
        },
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Today', tabBarButtonTestID: 'tab-dashboard' }} />
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
