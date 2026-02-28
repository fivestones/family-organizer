import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenScaffold } from './ScreenScaffold';
import { radii, spacing } from '../theme/tokens';
import { useAppTheme } from '../theme/ThemeProvider';

export function SubscreenScaffold({
  title,
  subtitle,
  accent,
  statusChips = [],
  action = null,
  children,
}) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const resolvedAccent = accent || colors.accentMore;

  return (
    <ScreenScaffold title={title} subtitle={subtitle} accent={resolvedAccent} statusChips={statusChips} headerMode="compact">
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        {action ? <View>{action}</View> : <View />}
      </View>
      {children}
    </ScreenScaffold>
  );
}

export function ParentAccessNotice({
  title = 'Parent login required',
  body,
  onContinue,
  continueLabel = 'Continue as parent',
}) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.noticeCard}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={continueLabel}
        style={styles.noticeButton}
        onPress={() => {
          void onContinue?.();
        }}
      >
        <Text style={styles.noticeButtonText}>{continueLabel}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: colors.ink,
    fontWeight: '700',
  },
  noticeCard: {
    backgroundColor: '#FFF5E9',
    borderWidth: 1,
    borderColor: '#EAC8A4',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noticeTitle: {
    color: '#8B4D17',
    fontSize: 16,
    fontWeight: '800',
  },
  noticeBody: {
    color: '#805736',
    fontSize: 13,
    lineHeight: 18,
  },
  noticeButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: '#FFF9F1',
    borderWidth: 1,
    borderColor: '#DCA878',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeButtonText: {
    color: '#8B4D17',
    fontWeight: '700',
  },
  });
