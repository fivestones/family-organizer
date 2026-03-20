import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { withAlpha } from '../../src/theme/tokens';
import { db } from '../../src/lib/instant-db';

export default function TabsLayout() {
  const { colors } = useAppTheme();
  const {
    activationRequired,
    currentUser,
    isAuthenticated,
    instantReady,
    isBootstrapping,
    isOffline,
    connectionStatus,
    principalType,
  } = useAppSession();

  const unreadMessagesQuery = db.useQuery(
    isAuthenticated && instantReady && currentUser
      ? {
          messageThreadMembers: {
          },
          messageThreads: {},
        }
      : null
  );

  const unreadMessageCount = React.useMemo(() => {
    const memberships = unreadMessagesQuery.data?.messageThreadMembers || [];
    const threads = unreadMessagesQuery.data?.messageThreads || [];
    const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
    return memberships.filter((membership) => {
      const thread = threadsById.get(membership.threadId);
      const latest = thread?.latestMessageAt ? new Date(thread.latestMessageAt).getTime() : 0;
      const readAt = membership?.lastReadAt ? new Date(membership.lastReadAt).getTime() : 0;
      return latest > readAt;
    }).length;
  }, [unreadMessagesQuery.data?.messageThreadMembers, unreadMessagesQuery.data?.messageThreads]);

  if (activationRequired) return <Redirect href="/activate" />;
  if (!isAuthenticated) return <Redirect href="/lock" />;

  if (isBootstrapping || !instantReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvasStrong, gap: 10 }}>
        <ActivityIndicator size="large" color={colors.accentChores} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor:
          route.name === 'dashboard'
            ? colors.accentDashboard
            : route.name === 'chores'
            ? colors.accentChores
            : route.name === 'calendar'
            ? colors.accentCalendar
            : route.name === 'messages'
            ? colors.accentDashboard
            : route.name === 'finance'
            ? colors.accentFinance
            : colors.accentMore,
        tabBarInactiveTintColor: withAlpha(colors.canvasTextMuted, 0.8),
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 0,
          height: 76,
          paddingTop: 8,
          paddingBottom: 12,
          shadowColor: colors.canvasStrong,
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -4 },
          elevation: 14,
        },
        tabBarItemStyle: {
          paddingTop: 2,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.15,
        },
        tabBarIcon: ({ color, focused, size }) => {
          let iconName = 'ellipse-outline';

          if (route.name === 'dashboard') iconName = focused ? 'sparkles' : 'sparkles-outline';
          else if (route.name === 'chores') iconName = focused ? 'checkmark-circle' : 'checkmark-circle-outline';
          else if (route.name === 'calendar') iconName = focused ? 'calendar' : 'calendar-outline';
          else if (route.name === 'messages') iconName = focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline';
          else if (route.name === 'finance') iconName = focused ? 'wallet' : 'wallet-outline';
          else if (route.name === 'more') iconName = focused ? 'grid' : 'grid-outline';

          return (
            <View
              style={{
                minWidth: 34,
                height: 30,
                borderRadius: 15,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? withAlpha(color, 0.16) : 'transparent',
              }}
            >
              <Ionicons name={iconName} size={Math.min(size, 20)} color={color} />
            </View>
          );
        },
        sceneStyle: { backgroundColor: colors.canvasStrong },
        tabBarBadge:
          route.name === 'messages'
            ? unreadMessageCount > 0
              ? String(unreadMessageCount)
              : undefined
            : route.name === 'more'
            ? isOffline
              ? '!'
              : principalType === 'parent'
              ? 'P'
              : undefined
            : undefined,
        tabBarBadgeStyle: {
          backgroundColor: isOffline ? colors.accentChores : colors.accentMore,
          color: colors.canvasStrong,
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
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarButtonTestID: 'tab-messages' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance', tabBarButtonTestID: 'tab-finance' }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarButtonTestID: 'tab-more' }} />
    </Tabs>
  );
}
