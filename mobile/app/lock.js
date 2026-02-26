import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ScreenScaffold, PlaceholderCard } from '../src/components/ScreenScaffold';
import { colors, radii, spacing } from '../src/theme/tokens';

const DEMO_MEMBERS = [
  { id: '1', name: 'Ava', tone: '#F4BC95' },
  { id: '2', name: 'Noah', tone: '#BFD7EA' },
  { id: '3', name: 'Parent', tone: '#D2C4F0' },
];

export default function LockScreen() {
  return (
    <ScreenScaffold
      title="Who’s using the app?"
      subtitle="Phase 1 will replace this placeholder with the full avatar login grid, kid PIN checks, and parent elevation token flow."
      accent={colors.accentMore}
    >
      <View style={styles.grid}>
        {DEMO_MEMBERS.map((member) => (
          <Pressable key={member.id} style={styles.memberCard} onPress={() => router.replace('/(tabs)/chores')}>
            <View style={[styles.avatar, { backgroundColor: member.tone }]} />
            <Text style={styles.memberName}>{member.name}</Text>
            <Text style={styles.memberSub}>Tap to enter</Text>
          </Pressable>
        ))}
      </View>

      <PlaceholderCard
        title="Next implementation steps"
        body="Wire this screen to Instant family members, local child PIN hashing, parent principal elevation, and shared-device idle timeout demotion."
      />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  memberCard: {
    width: '48%',
    minWidth: 150,
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
  },
  memberName: { fontSize: 17, fontWeight: '700', color: colors.ink },
  memberSub: { color: colors.inkMuted, fontSize: 12 },
});

