import React from 'react';
import { Tabs } from 'expo-router';
import { colors } from '../../src/theme/tokens';

export default function TabsLayout() {
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
      })}
    >
      <Tabs.Screen name="chores" options={{ title: 'Chores' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}

