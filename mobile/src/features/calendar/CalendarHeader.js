import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, shadows, spacing, withAlpha } from '../../theme/tokens';

const VIEW_MODE_LABELS = {
  month: 'Month',
  day: 'Day',
  agenda: 'Agenda',
};

const VIEW_MODE_OPTIONS = ['month', 'day', 'agenda'];

/**
 * Compact calendar header with view picker, period label, today button, filter/settings icons.
 *
 * @param {Object} props
 * @param {string} props.viewMode - 'month' | 'day' | 'agenda'
 * @param {Function} props.onViewModeChange
 * @param {string} props.periodLabel - e.g. "March 2026"
 * @param {string} [props.periodLabelSecondary] - e.g. "चैत्र २०८२"
 * @param {boolean} props.showTodayButton
 * @param {Function} props.onTodayPress
 * @param {boolean} props.hasActiveFilters
 * @param {Function} props.onFilterPress
 * @param {Function} props.onSettingsPress
 * @param {Object} props.colors
 */
export function CalendarHeader({
  viewMode,
  onViewModeChange,
  periodLabel,
  periodLabelSecondary,
  showTodayButton,
  onTodayPress,
  hasActiveFilters,
  onFilterPress,
  onSettingsPress,
  colors,
}) {
  const styles = useMemo(() => createHeaderStyles(colors), [colors]);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  return (
    <View style={styles.container}>
      {/* Left: View mode dropdown */}
      <Pressable
        style={styles.viewPicker}
        onPress={() => setDropdownVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`Current view: ${VIEW_MODE_LABELS[viewMode]}. Tap to change.`}
      >
        <Text style={styles.viewPickerText}>{VIEW_MODE_LABELS[viewMode]}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.accentCalendar} />
      </Pressable>

      {/* Center: Period label + Today button */}
      <View style={styles.center}>
        <View style={styles.periodLabelWrap}>
          <Text style={styles.periodLabel} numberOfLines={1}>{periodLabel}</Text>
          {periodLabelSecondary ? (
            <Text style={styles.periodLabelSecondary} numberOfLines={1}>{periodLabelSecondary}</Text>
          ) : null}
        </View>
        {showTodayButton ? (
          <Pressable
            style={styles.todayButton}
            onPress={onTodayPress}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Right: Filter + Settings icons */}
      <View style={styles.rightIcons}>
        <Pressable
          style={styles.iconButton}
          onPress={onFilterPress}
          accessibilityRole="button"
          accessibilityLabel="Open filters"
        >
          <Ionicons name="funnel-outline" size={18} color={hasActiveFilters ? colors.accentCalendar : colors.inkMuted} />
          {hasActiveFilters ? <View style={styles.filterBadge} /> : null}
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={onSettingsPress}
          accessibilityRole="button"
          accessibilityLabel="Calendar settings"
        >
          <Ionicons name="settings-outline" size={18} color={colors.inkMuted} />
        </Pressable>
      </View>

      {/* View mode dropdown modal */}
      <Modal
        visible={dropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <Pressable style={styles.dropdownOverlay} onPress={() => setDropdownVisible(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownHeading}>Calendar View</Text>
            {VIEW_MODE_OPTIONS.map((mode) => {
              const active = mode === viewMode;
              return (
                <Pressable
                  key={mode}
                  style={[styles.dropdownOption, active && styles.dropdownOptionActive]}
                  onPress={() => {
                    onViewModeChange(mode);
                    setDropdownVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${VIEW_MODE_LABELS[mode]} view`}
                >
                  <Text style={[styles.dropdownOptionText, active && styles.dropdownOptionTextActive]}>
                    {VIEW_MODE_LABELS[mode]}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.accentCalendar} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const createHeaderStyles = (colors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: spacing.xs,
      minHeight: 44,
    },
    viewPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.24),
      backgroundColor: withAlpha(colors.accentCalendar, 0.08),
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    viewPickerText: {
      color: colors.accentCalendar,
      fontWeight: '700',
      fontSize: 13,
    },
    center: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    periodLabelWrap: {
      alignItems: 'center',
    },
    periodLabel: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 15,
      textAlign: 'center',
    },
    periodLabelSecondary: {
      color: colors.inkMuted,
      fontWeight: '600',
      fontSize: 11,
      textAlign: 'center',
    },
    todayButton: {
      borderRadius: radii.pill,
      backgroundColor: colors.accentCalendar,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    todayButtonText: {
      color: colors.onAccent,
      fontWeight: '700',
      fontSize: 11,
    },
    rightIcons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    iconButton: {
      padding: 6,
      position: 'relative',
    },
    filterBadge: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 7,
      height: 7,
      borderRadius: 999,
      backgroundColor: colors.accentCalendar,
    },
    // Dropdown modal
    dropdownOverlay: {
      flex: 1,
      backgroundColor: withAlpha(colors.canvasStrong, 0.48),
      justifyContent: 'flex-start',
      paddingTop: 100,
    },
    dropdownSheet: {
      marginHorizontal: spacing.xl,
      backgroundColor: colors.panel,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadows.float,
    },
    dropdownHeading: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 17,
      marginBottom: spacing.xs,
    },
    dropdownOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
    },
    dropdownOptionActive: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    },
    dropdownOptionText: {
      color: colors.ink,
      fontWeight: '600',
      fontSize: 15,
    },
    dropdownOptionTextActive: {
      color: colors.accentCalendar,
      fontWeight: '800',
    },
  });
