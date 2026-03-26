import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, spacing, withAlpha } from '../../theme/tokens';

const SCOPE_OPTIONS = [
  {
    value: 'single',
    label: 'This event only',
    description: 'Only modify this one occurrence.',
    icon: 'ellipse-outline',
  },
  {
    value: 'following',
    label: 'This and following events',
    description: 'Modify this and all future occurrences.',
    icon: 'arrow-forward-outline',
  },
  {
    value: 'all',
    label: 'All events in series',
    description: 'Modify every occurrence of this recurring event.',
    icon: 'repeat-outline',
  },
];

/**
 * Recurrence scope chooser — shown when editing/deleting/dragging a recurring event.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {Function} props.onClose
 * @param {Function} props.onSelect - Called with 'single' | 'following' | 'all'
 * @param {string} props.actionLabel - e.g. "Move", "Edit", "Delete"
 * @param {Object} props.colors
 */
export function CalendarRecurrenceScopeSheet({
  visible,
  onClose,
  onSelect,
  actionLabel = 'Edit',
  colors,
}) {
  const styles = useMemo(() => createScopeStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{actionLabel} recurring event</Text>
          <Text style={styles.subtitle}>This event is part of a series. What would you like to {actionLabel.toLowerCase()}?</Text>

          <View style={styles.options}>
            {SCOPE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={styles.option}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <Ionicons name={option.icon} size={22} color={colors.accentCalendar} />
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createScopeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: withAlpha(colors.ink, 0.4),
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.lg,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.panel,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.md,
      elevation: 8,
    },
    title: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 18,
    },
    subtitle: {
      color: colors.inkMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    options: {
      gap: spacing.xs,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
    },
    optionText: {
      flex: 1,
    },
    optionLabel: {
      color: colors.ink,
      fontWeight: '700',
      fontSize: 14,
    },
    optionDescription: {
      color: colors.inkMuted,
      fontSize: 12,
      marginTop: 2,
    },
    cancelButton: {
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: 20,
    },
    cancelText: {
      color: colors.inkMuted,
      fontWeight: '700',
      fontSize: 14,
    },
  });
