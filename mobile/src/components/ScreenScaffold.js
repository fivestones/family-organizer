import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

const CHIP_TONES = {
  neutral: { bg: '#F2ECE0', text: colors.inkMuted, border: colors.line },
  success: { bg: '#EAF7EE', text: colors.success, border: '#BFE2CC' },
  warning: { bg: '#FFF2DF', text: colors.warning, border: '#E7CC9F' },
  accent: { bg: '#F1EAF9', text: colors.accentMore, border: '#D7CCE7' },
};

export function ScreenScaffold({ title, subtitle, accent = colors.accentMore, statusChips = [], children }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.root}>
        <View style={[styles.headerCard, { borderLeftColor: accent }]}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>{title}</Text>
            {statusChips.length > 0 ? (
              <View style={styles.chipsRow}>
                {statusChips.map((chip) => {
                  const tone = CHIP_TONES[chip.tone] || CHIP_TONES.neutral;
                  return (
                    <View
                      key={`${chip.label}-${chip.tone || 'neutral'}`}
                      style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}
                    >
                      <Text style={[styles.chipText, { color: tone.text }]}>{chip.label}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
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
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    flexShrink: 1,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
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
