import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, shadows, spacing, withAlpha } from '../../theme/tokens';
import {
  formatEventRangeLabel,
  formatDayTitle,
  isImportedEvent,
  eventStartsAt,
} from './calendar-utils';

/**
 * Read-only event detail sheet. Shown when tapping an event in any view.
 * Has an "Edit" button (parent-only) that opens the edit sheet.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {Function} props.onClose
 * @param {Object|null} props.event
 * @param {boolean} props.canEditEvents
 * @param {Function} props.onEditPress
 * @param {Object} props.colors
 */
export function CalendarEventDetailSheet({
  visible,
  onClose,
  event,
  canEditEvents,
  onEditPress,
  colors,
}) {
  const styles = useMemo(() => createDetailStyles(colors), [colors]);

  if (!event) return null;

  const startDate = eventStartsAt(event);
  const imported = isImportedEvent(event);

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

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title}>{event.title || 'Untitled event'}</Text>
              <Text style={styles.rangeLabel}>{formatEventRangeLabel(event)}</Text>
              {startDate ? (
                <Text style={styles.dateLabel}>{formatDayTitle(startDate)}</Text>
              ) : null}
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Status badge */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, event.isAllDay ? styles.badgeAllDay : styles.badgeTimed]}>
                <Text style={[styles.badgeText, event.isAllDay ? styles.badgeTextAllDay : styles.badgeTextTimed]}>
                  {event.isAllDay ? 'All day' : 'Timed'}
                </Text>
              </View>
              {imported ? (
                <View style={styles.badgeImported}>
                  <Text style={styles.badgeImportedText}>
                    Apple Calendar{event.sourceCalendarName ? ` · ${event.sourceCalendarName}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Description */}
            {event.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Description</Text>
                <Text style={styles.descriptionText}>{event.description}</Text>
              </View>
            ) : null}

            {/* Location */}
            {event.location ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Location</Text>
                <Text style={styles.sectionText}>{event.location}</Text>
              </View>
            ) : null}

            {/* Tags */}
            {event.tags?.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Tags</Text>
                <View style={styles.tagRow}>
                  {event.tags.map((tag) => (
                    <View key={tag.normalizedName} style={styles.tag}>
                      <Text style={styles.tagText}>{tag.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Family members */}
            {event.pertainsTo?.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>People</Text>
                <View style={styles.tagRow}>
                  {event.pertainsTo.map((member) => (
                    <View key={member.id} style={styles.memberChip}>
                      <Text style={styles.memberChipText}>{member.name || 'Unknown'}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Recurrence */}
            {event.rrule ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Recurrence</Text>
                <Text style={styles.sectionText}>{event.rrule}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            {canEditEvents ? (
              <Pressable
                style={styles.editButton}
                onPress={() => {
                  onClose();
                  setTimeout(() => onEditPress(event), 200);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit this event"
              >
                <Ionicons name="pencil" size={16} color={colors.onAccent} />
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
            ) : (
              <Text style={styles.readOnlyHint}>Read only in kid mode</Text>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createDetailStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: withAlpha(colors.ink, 0.35),
      justifyContent: 'flex-end',
    },
    scrim: {
      flex: 1,
    },
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
      alignItems: 'flex-start',
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
    },
    title: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 20,
      lineHeight: 26,
    },
    rangeLabel: {
      color: colors.accentCalendar,
      fontWeight: '700',
      fontSize: 13,
    },
    dateLabel: {
      color: colors.inkMuted,
      fontSize: 12,
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
      marginTop: spacing.md,
    },
    bodyContent: {
      gap: spacing.md,
      paddingBottom: spacing.md,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    badge: {
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderWidth: 1,
    },
    badgeAllDay: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
      borderColor: withAlpha(colors.accentCalendar, 0.24),
    },
    badgeTimed: {
      backgroundColor: withAlpha(colors.warning, 0.12),
      borderColor: withAlpha(colors.warning, 0.24),
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    badgeTextAllDay: {
      color: colors.accentCalendar,
    },
    badgeTextTimed: {
      color: colors.warning,
    },
    badgeImported: {
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: withAlpha(colors.inkMuted, 0.24),
      backgroundColor: withAlpha(colors.inkMuted, 0.08),
    },
    badgeImportedText: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    section: {
      gap: 4,
    },
    sectionLabel: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    sectionText: {
      color: colors.ink,
      fontSize: 14,
      lineHeight: 20,
    },
    descriptionText: {
      color: colors.ink,
      fontSize: 14,
      lineHeight: 20,
    },
    tagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    tag: {
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.24),
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    },
    tagText: {
      color: colors.accentCalendar,
      fontSize: 11,
      fontWeight: '700',
    },
    memberChip: {
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: withAlpha(colors.ink, 0.16),
      backgroundColor: withAlpha(colors.ink, 0.06),
    },
    memberChipText: {
      color: colors.ink,
      fontSize: 11,
      fontWeight: '700',
    },
    actions: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 12,
      backgroundColor: colors.accentCalendar,
      paddingVertical: 12,
    },
    editButtonText: {
      color: colors.onAccent,
      fontWeight: '800',
      fontSize: 15,
    },
    readOnlyHint: {
      color: colors.inkMuted,
      textAlign: 'center',
      fontSize: 13,
      fontWeight: '600',
    },
  });
