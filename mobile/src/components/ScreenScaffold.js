import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export function ScreenScaffold({ title, subtitle, accent = colors.accentMore, children }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.root}>
        <View style={[styles.headerCard, { borderLeftColor: accent }]}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export function PlaceholderCard({ title, body }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  headerCard: {
    backgroundColor: colors.panel,
    borderRadius: radii.lg,
    borderLeftWidth: 6,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: spacing.xs, color: colors.inkMuted, lineHeight: 20 },
  content: { flex: 1, gap: spacing.md },
  card: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: spacing.xs },
  cardBody: { color: colors.inkMuted, lineHeight: 20 },
});

