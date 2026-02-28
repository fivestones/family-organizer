import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { radii, shadows, spacing } from '../theme/tokens';
import { useAppTheme } from '../theme/ThemeProvider';

function getChipTones(colors) {
  return {
    neutral: { bg: '#F2ECE0', text: colors.inkMuted, border: colors.line },
    success: { bg: '#EAF7EE', text: colors.success, border: '#BFE2CC' },
    warning: { bg: '#FFF2DF', text: colors.warning, border: '#E7CC9F' },
    accent: { bg: '#F1EAF9', text: colors.accentMore, border: '#D7CCE7' },
  };
}

export function ScreenScaffold({
  title,
  subtitle,
  accent,
  statusChips = [],
  headerAction = null,
  children,
  headerMode = 'default',
  layoutMode = 'default',
}) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const chipTones = React.useMemo(() => getChipTones(colors), [colors]);
  const compactHeader = headerMode === 'compact';
  const compactLayout = layoutMode === 'compact';
  const resolvedAccent = accent || colors.accentMore;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={[styles.root, compactLayout && styles.rootCompact]}>
        <View style={[styles.headerCard, compactHeader && styles.headerCardCompact, { borderLeftColor: resolvedAccent }]}>
          <View style={styles.headerTop}>
            <Text style={[styles.title, compactHeader && styles.titleCompact]} numberOfLines={compactHeader ? 2 : undefined}>
              {title}
            </Text>
            {headerAction ? <View style={styles.headerActionWrap}>{headerAction}</View> : null}
            {!headerAction && statusChips.length > 0 ? (
              <View style={styles.chipsRow}>
                {statusChips.map((chip) => {
                  const tone = chipTones[chip.tone] || chipTones.neutral;
                  return (
                    <View
                      key={`${chip.label}-${chip.tone || 'neutral'}`}
                      style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}
                    >
                      <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
                        {chip.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, compactHeader && styles.subtitleCompact]} numberOfLines={compactHeader ? 2 : undefined}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export function PlaceholderCard({ title, body }) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  rootCompact: { padding: spacing.md, gap: spacing.md },
  headerCard: {
    backgroundColor: colors.panel,
    borderRadius: radii.lg,
    borderLeftWidth: 6,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  headerCardCompact: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink, flexShrink: 1, flexGrow: 1, minWidth: 0 },
  titleCompact: { fontSize: 22, lineHeight: 28, flexShrink: 1 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: '48%',
    flexShrink: 0,
  },
  headerActionWrap: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    flexShrink: 0,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-end',
  },
  chipText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  subtitle: { marginTop: spacing.xs, color: colors.inkMuted, lineHeight: 20 },
  subtitleCompact: { marginTop: 6, lineHeight: 18, fontSize: 13 },
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
