import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, spacing, withAlpha } from '../../theme/tokens';

const DAY_COUNT_OPTIONS = [1, 2, 3, 5, 7, 14];
const ROW_COUNT_OPTIONS = [1, 2];

/**
 * Settings sheet for calendar display preferences.
 */
export function CalendarSettingsSheet({
  visible,
  onClose,
  settings,
  colors,
}) {
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>Calendar Settings</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Date display */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Date Display</Text>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Gregorian dates</Text>
                  <Text style={styles.switchHint}>Show standard calendar dates</Text>
                </View>
                <Switch
                  value={settings.showGregorian}
                  onValueChange={settings.setShowGregorian}
                  trackColor={{ false: withAlpha(colors.locked, 0.72), true: withAlpha(colors.accentCalendar, 0.42) }}
                  thumbColor={settings.showGregorian ? colors.accentCalendar : colors.panelElevated}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Bikram Samvat dates</Text>
                  <Text style={styles.switchHint}>Show Nepali calendar dates in Devanagari</Text>
                </View>
                <Switch
                  value={settings.showBs}
                  onValueChange={settings.setShowBs}
                  trackColor={{ false: withAlpha(colors.locked, 0.72), true: withAlpha(colors.accentCalendar, 0.42) }}
                  thumbColor={settings.showBs ? colors.accentCalendar : colors.panelElevated}
                />
              </View>
            </View>

            {/* Day view settings */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Day View</Text>

              <View style={styles.optionGroup}>
                <Text style={styles.optionLabel}>Days visible</Text>
                <View style={styles.optionChips}>
                  {DAY_COUNT_OPTIONS.map((n) => {
                    const active = settings.visibleDayCount === n;
                    return (
                      <Pressable
                        key={`dc-${n}`}
                        style={[styles.optionChip, active && styles.optionChipActive]}
                        onPress={() => settings.setVisibleDayCount(n)}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${n} day${n > 1 ? 's' : ''}`}
                      >
                        <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.optionGroup}>
                <Text style={styles.optionLabel}>Rows</Text>
                <View style={styles.optionChips}>
                  {ROW_COUNT_OPTIONS.map((n) => {
                    const active = settings.dayRowCount === n;
                    return (
                      <Pressable
                        key={`rc-${n}`}
                        style={[styles.optionChip, active && styles.optionChipActive]}
                        onPress={() => settings.setDayRowCount(n)}
                        accessibilityRole="button"
                        accessibilityLabel={`${n} row${n > 1 ? 's' : ''}`}
                      >
                        <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.optionGroup}>
                <Text style={styles.optionLabel}>Hour height</Text>
                <View style={styles.optionChips}>
                  {[32, 44, 60, 80].map((h) => {
                    const active = settings.dayHourHeight === h;
                    const label = h <= 32 ? 'Compact' : h <= 44 ? 'Default' : h <= 60 ? 'Tall' : 'XL';
                    return (
                      <Pressable
                        key={`hh-${h}`}
                        style={[styles.optionChip, active && styles.optionChipActive]}
                        onPress={() => settings.setDayHourHeight(h)}
                        accessibilityRole="button"
                        accessibilityLabel={`${label} hour height`}
                      >
                        <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createSettingsStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: withAlpha(colors.ink, 0.35),
      justifyContent: 'flex-end',
    },
    scrim: { flex: 1 },
    sheet: {
      maxHeight: '75%',
      backgroundColor: colors.panel,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: colors.line,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    handle: {
      alignSelf: 'center',
      width: 46,
      height: 5,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.locked, 0.76),
      marginBottom: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    title: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 20,
    },
    closeButton: {
      padding: 6,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
    },
    body: {
      paddingHorizontal: spacing.lg,
    },
    bodyContent: {
      gap: spacing.xl,
      paddingBottom: spacing.lg,
    },
    section: {
      gap: spacing.md,
    },
    sectionTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 16,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.md,
      backgroundColor: colors.panelElevated,
      padding: spacing.md,
    },
    switchLabel: {
      color: colors.ink,
      fontWeight: '700',
      fontSize: 14,
    },
    switchHint: {
      color: colors.inkMuted,
      fontSize: 12,
      marginTop: 2,
    },
    optionGroup: {
      gap: spacing.xs,
    },
    optionLabel: {
      color: colors.inkMuted,
      fontWeight: '700',
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    optionChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    optionChip: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    optionChipActive: {
      borderColor: withAlpha(colors.accentCalendar, 0.36),
      backgroundColor: withAlpha(colors.accentCalendar, 0.12),
    },
    optionChipText: {
      color: colors.inkMuted,
      fontWeight: '700',
      fontSize: 13,
    },
    optionChipTextActive: {
      color: colors.accentCalendar,
    },
  });
