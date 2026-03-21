import React, { useState } from 'react';
import { Tabs, Redirect, router } from 'expo-router';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { radii, spacing, shadows, withAlpha } from '../../src/theme/tokens';
import { db } from '../../src/lib/instant-db';
import { AvatarPhotoImage } from '../../src/components/AvatarPhotoImage';
import { revokeMobileDeviceSession } from '../../src/lib/api-client';

function createInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

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
    lock,
    resetDeviceSession,
  } = useAppSession();
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);

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

  const styles = createTabStyles(colors);

  async function handleSwitchUser() {
    setProfileMenuVisible(false);
    await lock();
    router.replace('/lock?intent=switch-user');
  }

  async function handleLogout() {
    setProfileMenuVisible(false);
    try { await revokeMobileDeviceSession(); } catch { /* ignore */ }
    await resetDeviceSession();
    router.replace('/activate');
  }

  function handleOpenSettings() {
    setProfileMenuVisible(false);
    router.push('/more/settings');
  }

  return (
    <>
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
            if (route.name === 'profile-menu') {
              return (
                <View style={styles.profileTabIcon}>
                  <AvatarPhotoImage
                    photoUrls={currentUser?.photoUrls}
                    preferredSize="64"
                    style={styles.profileTabAvatar}
                    fallback={
                      <View style={[styles.profileTabFallback, { backgroundColor: withAlpha(color, 0.16) }]}>
                        <Text style={[styles.profileTabFallbackText, { color }]}>{createInitials(currentUser?.name)}</Text>
                      </View>
                    }
                  />
                  {focused ? <View style={[styles.profileTabRing, { borderColor: color }]} /> : null}
                </View>
              );
            }

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
        <Tabs.Screen
          name="profile-menu"
          options={{
            title: currentUser?.name || 'Me',
            tabBarButtonTestID: 'tab-profile-menu',
            tabBarActiveTintColor: colors.accentDashboard,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setProfileMenuVisible(true);
            },
          }}
        />
      </Tabs>

      <Modal visible={profileMenuVisible} transparent animationType="fade" onRequestClose={() => setProfileMenuVisible(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setProfileMenuVisible(false)} />
          <View style={styles.menuSheet}>
            <View style={styles.menuHeader}>
              <AvatarPhotoImage
                photoUrls={currentUser?.photoUrls}
                preferredSize="320"
                style={styles.menuAvatar}
                fallback={
                  <View style={styles.menuAvatarFallback}>
                    <Text style={styles.menuAvatarFallbackText}>{createInitials(currentUser?.name)}</Text>
                  </View>
                }
              />
              <View style={styles.menuHeaderCopy}>
                <Text style={styles.menuName}>{currentUser?.name || 'Family member'}</Text>
                <Text style={styles.menuRole}>{currentUser?.role === 'parent' ? 'Parent' : 'Kid'}</Text>
              </View>
            </View>

            <View style={styles.menuActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                onPress={handleOpenSettings}
                style={styles.menuRow}
              >
                <Ionicons name="settings-outline" size={20} color={colors.ink} />
                <Text style={styles.menuRowText}>Settings</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch user"
                onPress={() => { void handleSwitchUser(); }}
                style={styles.menuRow}
              >
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.ink} />
                <Text style={styles.menuRowText}>Switch User</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log out and deactivate device"
                onPress={() => { void handleLogout(); }}
                style={[styles.menuRow, styles.menuRowDanger]}
              >
                <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                <Text style={[styles.menuRowText, { color: colors.danger }]}>Log Out</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              onPress={() => setProfileMenuVisible(false)}
              style={styles.menuDoneButton}
            >
              <Text style={styles.menuDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createTabStyles = (colors) =>
  StyleSheet.create({
    profileTabIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileTabAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    profileTabFallback: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileTabFallbackText: {
      fontSize: 11,
      fontWeight: '800',
    },
    profileTabRing: {
      position: 'absolute',
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
    },
    menuOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    menuBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: withAlpha(colors.canvasStrong, 0.48),
    },
    menuSheet: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
      ...shadows.float,
    },
    menuHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    menuAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
    },
    menuAvatarFallback: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accentDashboard, 0.14),
    },
    menuAvatarFallbackText: {
      color: colors.accentDashboard,
      fontWeight: '800',
      fontSize: 16,
    },
    menuHeaderCopy: {
      flex: 1,
      gap: 2,
    },
    menuName: {
      color: colors.ink,
      fontSize: 20,
      fontWeight: '800',
    },
    menuRole: {
      color: colors.inkMuted,
      fontSize: 13,
    },
    menuActions: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      overflow: 'hidden',
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    menuRowDanger: {
      borderBottomWidth: 0,
    },
    menuRowText: {
      flex: 1,
      color: colors.ink,
      fontSize: 15,
      fontWeight: '600',
    },
    menuDoneButton: {
      minHeight: 48,
      borderRadius: radii.pill,
      backgroundColor: colors.accentDashboard,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    menuDoneText: {
      color: colors.onAccent,
      fontWeight: '800',
      fontSize: 15,
    },
  });
