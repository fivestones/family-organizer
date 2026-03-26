import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, shadows, spacing, withAlpha } from '../../theme/tokens';

/**
 * Filter sheet for family member, tag, and text search filtering.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {Function} props.onClose
 * @param {Array} props.familyMembers
 * @param {Array} props.availableCalendarTags
 * @param {string[]} props.excludedMemberIds
 * @param {Function} props.onExcludedMemberIdsChange
 * @param {string[]} props.excludedTagIds
 * @param {Function} props.onExcludedTagIdsChange
 * @param {string} props.textQuery
 * @param {Function} props.onTextQueryChange
 * @param {Object} props.colors
 */
export function CalendarFilterSheet({
  visible,
  onClose,
  familyMembers = [],
  availableCalendarTags = [],
  excludedMemberIds = [],
  onExcludedMemberIdsChange,
  excludedTagIds = [],
  onExcludedTagIdsChange,
  textQuery = '',
  onTextQueryChange,
  colors,
}) {
  const styles = useMemo(() => createFilterStyles(colors), [colors]);
  const excludedMemberSet = useMemo(() => new Set(excludedMemberIds), [excludedMemberIds]);
  const excludedTagSet = useMemo(() => new Set(excludedTagIds), [excludedTagIds]);

  const hasFilters = excludedMemberIds.length > 0 || excludedTagIds.length > 0 || textQuery.length > 0;

  function toggleMember(memberId) {
    const next = excludedMemberSet.has(memberId)
      ? excludedMemberIds.filter((id) => id !== memberId)
      : [...excludedMemberIds, memberId];
    onExcludedMemberIdsChange(next);
  }

  function toggleTag(tagId) {
    const next = excludedTagSet.has(tagId)
      ? excludedTagIds.filter((id) => id !== tagId)
      : [...excludedTagIds, tagId];
    onExcludedTagIdsChange(next);
  }

  function clearAll() {
    onExcludedMemberIdsChange([]);
    onExcludedTagIdsChange([]);
    onTextQueryChange('');
  }

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
            <Text style={styles.title}>Filters</Text>
            <View style={styles.headerActions}>
              {hasFilters ? (
                <Pressable onPress={clearAll} style={styles.clearButton}>
                  <Text style={styles.clearButtonText}>Clear All</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={colors.inkMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Text search */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Search</Text>
              <TextInput
                style={styles.searchInput}
                value={textQuery}
                onChangeText={onTextQueryChange}
                placeholder="Search events..."
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>

            {/* Family members */}
            {familyMembers.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Family Members</Text>
                <Text style={styles.sectionHint}>Unchecked members are hidden from the calendar.</Text>
                <View style={styles.chipGrid}>
                  {familyMembers.map((member) => {
                    const excluded = excludedMemberSet.has(member.id);
                    return (
                      <Pressable
                        key={member.id}
                        style={[styles.chip, excluded && styles.chipExcluded]}
                        onPress={() => toggleMember(member.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !excluded }}
                        accessibilityLabel={`${excluded ? 'Show' : 'Hide'} ${member.name || 'Unknown'}`}
                      >
                        <Ionicons
                          name={excluded ? 'eye-off-outline' : 'checkmark-circle'}
                          size={16}
                          color={excluded ? colors.inkMuted : colors.accentCalendar}
                        />
                        <Text style={[styles.chipText, excluded && styles.chipTextExcluded]}>
                          {member.name || 'Unknown'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Tags */}
            {availableCalendarTags.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Tags</Text>
                <Text style={styles.sectionHint}>Unchecked tags are hidden from the calendar.</Text>
                <View style={styles.chipGrid}>
                  {availableCalendarTags.map((tag) => {
                    const tagId = tag.id || tag.normalizedName;
                    const excluded = excludedTagSet.has(tagId);
                    return (
                      <Pressable
                        key={tagId}
                        style={[styles.chip, excluded && styles.chipExcluded]}
                        onPress={() => toggleTag(tagId)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !excluded }}
                        accessibilityLabel={`${excluded ? 'Show' : 'Hide'} tag ${tag.name}`}
                      >
                        <Ionicons
                          name={excluded ? 'eye-off-outline' : 'checkmark-circle'}
                          size={16}
                          color={excluded ? colors.inkMuted : colors.accentCalendar}
                        />
                        <Text style={[styles.chipText, excluded && styles.chipTextExcluded]}>
                          {tag.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createFilterStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: withAlpha(colors.ink, 0.35),
      justifyContent: 'flex-end',
    },
    scrim: { flex: 1 },
    sheet: {
      maxHeight: '80%',
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
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    clearButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: withAlpha(colors.danger, 0.24),
      backgroundColor: withAlpha(colors.danger, 0.08),
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    clearButtonText: {
      color: colors.danger,
      fontWeight: '700',
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
    },
    bodyContent: {
      gap: spacing.lg,
      paddingBottom: spacing.lg,
    },
    section: {
      gap: spacing.xs,
    },
    sectionLabel: {
      color: colors.ink,
      fontWeight: '700',
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    sectionHint: {
      color: colors.inkMuted,
      fontSize: 12,
    },
    searchInput: {
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.ink,
      fontSize: 15,
    },
    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: 4,
    },
    chip: {
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
    chipExcluded: {
      borderColor: colors.line,
      backgroundColor: withAlpha(colors.locked, 0.1),
    },
    chipText: {
      color: colors.accentCalendar,
      fontWeight: '700',
      fontSize: 13,
    },
    chipTextExcluded: {
      color: colors.inkMuted,
    },
  });
