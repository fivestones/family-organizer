import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { id, tx } from '@instantdb/react-native';
import { radii, shadows, spacing, withAlpha } from '../../theme/tokens';
import { buildCalendarHistoryMetadata, buildCalendarHistorySnapshot } from '../../../../lib/calendar-history';
import { buildHistoryEventTransactions } from '../../../../lib/history-events';
import {
  dedupeCalendarTagRecords,
  normalizeCalendarTagKey,
  normalizeCalendarTagName,
  sortCalendarTagRecords,
  splitCalendarTagDraft,
} from '../../../../lib/calendar-tags';
import {
  DEFAULT_EVENT_STATUS,
  addDays,
  buildInitialForm,
  combineLocalDateAndTime,
  formatYmd,
  formFromEvent,
  getLocalTimeZone,
  isImportedEvent,
  parseYmdLocal,
  shouldRetryLegacyCalendarMutation,
} from './calendar-utils';

/**
 * Bottom-sheet modal for creating/editing calendar events.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {Function} props.onClose
 * @param {Object|null} props.editingEvent - The event being edited (null for new events)
 * @param {Date} props.selectedDate - The date context for new events
 * @param {boolean} props.canEditEvents - Whether the user has edit permissions (parent mode)
 * @param {Object} props.db - InstantDB client
 * @param {Object|null} props.currentUser
 * @param {Function} props.recordParentActivity
 * @param {Array} props.availableCalendarTags
 * @param {Function} props.onSaved - Callback with the saved event's start date
 * @param {Object} props.colors - Theme colors
 */
export function CalendarEventEditSheet({
  visible,
  onClose,
  editingEvent,
  selectedDate,
  canEditEvents,
  db,
  currentUser,
  recordParentActivity,
  availableCalendarTags,
  onSaved,
  colors,
}) {
  const styles = useMemo(() => createEditSheetStyles(colors), [colors]);

  const [form, setForm] = useState(() =>
    editingEvent ? formFromEvent(editingEvent) : buildInitialForm(selectedDate)
  );
  const [saving, setSaving] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Reset form when the modal opens or the event changes
  useEffect(() => {
    if (visible) {
      setForm(editingEvent ? formFromEvent(editingEvent) : buildInitialForm(selectedDate));
      setSaving(false);
    }
  }, [visible, editingEvent?.id, selectedDate]);

  useEffect(() => {
    const subShow = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subHide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(subShow, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(subHide, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const availableCalendarTagByKey = useMemo(
    () => new Map(availableCalendarTags.map((tag) => [tag.normalizedName, tag])),
    [availableCalendarTags]
  );

  const selectedTagKeys = useMemo(
    () => new Set((form.tags || []).map((tag) => tag.normalizedName || normalizeCalendarTagKey(tag.name))),
    [form.tags]
  );

  const tagSuggestions = useMemo(() => {
    const draftKey = normalizeCalendarTagKey(form.tagDraft);
    return availableCalendarTags
      .filter((tag) => !selectedTagKeys.has(tag.normalizedName))
      .filter((tag) => !draftKey || tag.normalizedName.includes(draftKey))
      .slice(0, 8);
  }, [availableCalendarTags, form.tagDraft, selectedTagKeys]);

  const isEditingImportedEvent = !!(editingEvent && isImportedEvent(editingEvent));
  const canEditEventDetails = canEditEvents && !saving;
  const canEditEventTags = canEditEvents && !saving;

  function handleChange(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function addTagsToForm(values) {
    const nextValues = Array.isArray(values) ? values : [values];
    setForm((prev) => ({
      ...prev,
      tags: sortCalendarTagRecords(dedupeCalendarTagRecords([...(prev.tags || []), ...nextValues], availableCalendarTagByKey)),
      tagDraft: '',
    }));
  }

  function handleTagDraftChange(value) {
    const { committed, remaining } = splitCalendarTagDraft(value);
    if (committed.length > 0) {
      setForm((prev) => ({
        ...prev,
        tags: sortCalendarTagRecords(dedupeCalendarTagRecords([...(prev.tags || []), ...committed], availableCalendarTagByKey)),
        tagDraft: remaining,
      }));
      return;
    }
    handleChange('tagDraft', value);
  }

  function handleAddTagDraft() {
    const nextTag = normalizeCalendarTagName(form.tagDraft);
    if (!nextTag) {
      handleChange('tagDraft', '');
      return;
    }
    addTagsToForm([nextTag]);
  }

  function handleRemoveTag(tagKey) {
    setForm((prev) => ({
      ...prev,
      tags: (prev.tags || []).filter((tag) => tag.normalizedName !== tagKey),
    }));
  }

  const appendCalendarHistoryTransactions = useCallback(
    (txOps, input) => {
      if (!currentUser?.id) return txOps;

      const historyEvent = buildHistoryEventTransactions({
        tx,
        createId: id,
        occurredAt: input.occurredAt,
        domain: 'calendar',
        actionType: input.actionType,
        summary: input.summary,
        source: 'manual',
        actorFamilyMemberId: currentUser.id,
        calendarItemId: input.calendarItemId || null,
        metadata: buildCalendarHistoryMetadata({
          title: input.title || null,
          before: input.beforeSnapshot || null,
          after: input.afterSnapshot || null,
          extra: input.metadata || null,
        }),
      });

      return [...txOps, ...historyEvent.transactions];
    },
    [currentUser?.id]
  );

  async function handleSave() {
    recordParentActivity();

    const draftTagName = normalizeCalendarTagName(form.tagDraft);
    const nextTags = sortCalendarTagRecords(
      dedupeCalendarTagRecords(draftTagName ? [...(form.tags || []), draftTagName] : form.tags || [], availableCalendarTagByKey)
    );
    if (draftTagName) {
      setForm((prev) => ({ ...prev, tags: nextTags, tagDraft: '' }));
    }

    const nowIso = new Date().toISOString();

    const buildTagTxOps = (targetEventId, previousTags) => {
      const txOps = [];
      const previousTagIds = new Set(
        dedupeCalendarTagRecords(previousTags || [], availableCalendarTagByKey)
          .map((tag) => availableCalendarTagByKey.get(tag.normalizedName)?.id || tag.id || '')
          .filter(Boolean)
      );
      const resolvedNextTags = [];

      for (const tag of nextTags) {
        const existingTag = availableCalendarTagByKey.get(tag.normalizedName);
        const tagId = existingTag?.id || tag.id || id();
        resolvedNextTags.push({
          id: tagId,
          name: existingTag?.name || tag.name,
          normalizedName: tag.normalizedName,
        });

        if (!existingTag?.id && !tag.id) {
          txOps.push(
            tx.calendarTags[tagId].update({
              createdAt: nowIso,
              name: tag.name,
              normalizedName: tag.normalizedName,
              updatedAt: nowIso,
            })
          );
        }
      }

      const nextTagIds = new Set(resolvedNextTags.map((tag) => tag.id));

      for (const previousTagId of Array.from(previousTagIds)) {
        if (!nextTagIds.has(previousTagId)) {
          txOps.push(tx.calendarItems[targetEventId].unlink({ tags: previousTagId }));
        }
      }

      for (const tag of resolvedNextTags) {
        if (tag.id && !previousTagIds.has(tag.id)) {
          txOps.push(tx.calendarItems[targetEventId].link({ tags: tag.id }));
        }
      }

      return txOps;
    };

    const title = form.title.trim();
    if (!title) {
      Alert.alert('Missing title', 'Please add an event title.');
      return;
    }

    let payload;

    if (form.isAllDay) {
      const startDate = parseYmdLocal(form.startDate);
      const endDateInclusive = parseYmdLocal(form.endDate);
      if (!startDate || !endDateInclusive) {
        Alert.alert('Invalid date', 'Use YYYY-MM-DD for start and end dates.');
        return;
      }
      if (endDateInclusive < startDate) {
        Alert.alert('Invalid range', 'End date must be on or after the start date.');
        return;
      }

      const endDateExclusive = addDays(endDateInclusive, 1);
      payload = {
        title,
        description: form.description.trim(),
        startDate: formatYmd(startDate),
        endDate: formatYmd(endDateExclusive),
        isAllDay: true,
        year: startDate.getFullYear(),
        month: startDate.getMonth() + 1,
        dayOfMonth: startDate.getDate(),
      };
    } else {
      const start = combineLocalDateAndTime(form.startDate, form.startTime);
      const end = combineLocalDateAndTime(form.endDate, form.endTime);
      if (!start || !end) {
        Alert.alert('Invalid date/time', 'Use YYYY-MM-DD dates and HH:mm times.');
        return;
      }
      if (end <= start) {
        Alert.alert('Invalid range', 'End time must be after the start time.');
        return;
      }

      payload = {
        title,
        description: form.description.trim(),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        isAllDay: false,
        year: start.getFullYear(),
        month: start.getMonth() + 1,
        dayOfMonth: start.getDate(),
      };
    }

    const legacyPayload = payload;
    const eventId = editingEvent?.id || id();
    const previousSequence = typeof editingEvent?.sequence === 'number' ? editingEvent.sequence : 0;
    const status = String(form.status || editingEvent?.status || DEFAULT_EVENT_STATUS).trim().toLowerCase() || DEFAULT_EVENT_STATUS;
    const payloadBase = {
      uid: editingEvent?.uid || form.uid || eventId,
      sequence: editingEvent?.id ? previousSequence + 1 : previousSequence,
      status,
      createdAt: editingEvent?.createdAt || form.createdAt || nowIso,
      updatedAt: nowIso,
      dtStamp: nowIso,
      lastModified: nowIso,
      location: String(form.location || editingEvent?.location || '').trim(),
      timeZone: String(form.timeZone || editingEvent?.timeZone || getLocalTimeZone()).trim(),
      rrule: String(form.rrule || editingEvent?.rrule || '').trim(),
      rdates: Array.isArray(form.rdates) ? form.rdates : Array.isArray(editingEvent?.rdates) ? editingEvent.rdates : [],
      exdates: Array.isArray(form.exdates) ? form.exdates : Array.isArray(editingEvent?.exdates) ? editingEvent.exdates : [],
      recurrenceLines:
        Array.isArray(form.recurrenceLines)
          ? form.recurrenceLines
          : Array.isArray(editingEvent?.recurrenceLines)
            ? editingEvent.recurrenceLines
            : [],
      recurrenceId: String(form.recurrenceId || editingEvent?.recurrenceId || '').trim(),
      recurringEventId: String(form.recurringEventId || editingEvent?.recurringEventId || '').trim(),
      recurrenceIdRange: String(form.recurrenceIdRange || editingEvent?.recurrenceIdRange || '').trim(),
      alarms: Array.isArray(form.alarms) ? form.alarms : Array.isArray(editingEvent?.alarms) ? editingEvent.alarms : [],
      eventType: String(form.eventType || editingEvent?.eventType || 'default'),
      visibility: String(form.visibility || editingEvent?.visibility || 'default'),
      transparency: String(form.transparency || editingEvent?.transparency || (form.isAllDay ? 'transparent' : 'opaque')),
      ...(typeof form.travelDurationBeforeMinutes === 'number' ? { travelDurationBeforeMinutes: form.travelDurationBeforeMinutes } : {}),
      ...(typeof form.travelDurationAfterMinutes === 'number' ? { travelDurationAfterMinutes: form.travelDurationAfterMinutes } : {}),
    };

    payload = { ...payload, ...payloadBase };
    const tagTxOps = buildTagTxOps(eventId, editingEvent?.tags || []);
    const summary = `${editingEvent?.id ? 'Updated' : 'Created'} event "${title || 'Untitled event'}"`;
    const buildSaveTxOps = (nextPayload) =>
      appendCalendarHistoryTransactions([tx.calendarItems[eventId].update(nextPayload), ...tagTxOps], {
        occurredAt: nowIso,
        actionType: editingEvent?.id ? 'calendar_event_updated' : 'calendar_event_created',
        summary,
        calendarItemId: eventId,
        title: title || 'Untitled event',
        beforeSnapshot: buildCalendarHistorySnapshot(editingEvent),
        afterSnapshot: buildCalendarHistorySnapshot(nextPayload),
      });

    setSaving(true);
    try {
      await db.transact(buildSaveTxOps(payload));
      onSaved?.(parseYmdLocal(form.startDate));
      onClose();
    } catch (error) {
      if (shouldRetryLegacyCalendarMutation(error)) {
        try {
          await db.transact(buildSaveTxOps(legacyPayload));
          onSaved?.(parseYmdLocal(form.startDate));
          onClose();
          return;
        } catch (fallbackError) {
          setSaving(false);
          Alert.alert('Unable to save event', fallbackError?.message || 'Please try again.');
          return;
        }
      }
      setSaving(false);
      Alert.alert('Unable to save event', error?.message || 'Please try again.');
    }
  }

  function handleDelete() {
    if (!editingEvent?.id) return;
    recordParentActivity();

    Alert.alert('Delete event?', 'This will permanently remove the selected calendar item.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            try {
              await db.transact(
                appendCalendarHistoryTransactions([tx.calendarItems[editingEvent.id].delete()], {
                  occurredAt: new Date().toISOString(),
                  actionType: 'calendar_event_deleted',
                  summary: `Deleted event "${editingEvent?.title || 'Untitled event'}"`,
                  calendarItemId: editingEvent.id,
                  title: editingEvent?.title || 'Untitled event',
                  beforeSnapshot: buildCalendarHistorySnapshot(editingEvent),
                })
              );
              onClose();
            } catch (error) {
              setSaving(false);
              Alert.alert('Unable to delete event', error?.message || 'Please try again.');
            }
          })();
        },
      },
    ]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
          style={styles.modalKeyboardLayer}
        >
          <Pressable style={styles.modalScrim} onPress={onClose} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{editingEvent?.id ? 'Edit Event' : 'Add Event'}</Text>
                <Text style={styles.modalSubtitle}>
                  {isEditingImportedEvent
                    ? canEditEvents
                      ? 'Apple-synced events are fully editable here. Changes stay local until a future Apple sync.'
                      : 'Apple-synced events can be edited in parent mode.'
                    : canEditEvents
                      ? 'All-day events store exclusive end dates to match web semantics.'
                      : 'Read only in kid mode. Switch to parent mode to save changes.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close event editor"
                onPress={onClose}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.modalForm,
                keyboardVisible ? styles.modalFormKeyboardOpen : null,
              ]}
            >
              {/* Title */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  accessibilityLabel="Calendar event title"
                  value={form.title}
                  editable={canEditEventDetails}
                  onChangeText={(value) => handleChange('title', value)}
                  placeholder="Family dinner"
                  placeholderTextColor={colors.inkMuted}
                  style={[styles.textInput, !canEditEventDetails && styles.inputDisabled]}
                  onFocus={recordParentActivity}
                />
              </View>

              {/* Description */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  accessibilityLabel="Calendar event description"
                  value={form.description}
                  editable={canEditEventDetails}
                  onChangeText={(value) => handleChange('description', value)}
                  placeholder="Optional details"
                  placeholderTextColor={colors.inkMuted}
                  style={[styles.textInput, styles.textArea, !canEditEventDetails && styles.inputDisabled]}
                  multiline
                  textAlignVertical="top"
                  onFocus={recordParentActivity}
                />
              </View>

              {/* Tags */}
              <View style={styles.fieldBlock}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Tags</Text>
                  <Text style={styles.fieldMeta}>Reusable labels for future filtering</Text>
                </View>
                {form.tags?.length ? (
                  <View style={styles.editorTagRow}>
                    {form.tags.map((tag) => (
                      <Pressable
                        key={tag.normalizedName}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove tag ${tag.name}`}
                        disabled={!canEditEventTags}
                        onPress={() => handleRemoveTag(tag.normalizedName)}
                        style={[styles.editorTagChip, !canEditEventTags && styles.editorTagChipDisabled]}
                      >
                        <Text style={styles.editorTagChipText}>{tag.name}</Text>
                        {canEditEventTags ? <Text style={styles.editorTagChipDismiss}>Remove</Text> : null}
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.fieldHint}>No tags yet. Add labels to keep related events easy to find.</Text>
                )}
                <View style={styles.tagComposerRow}>
                  <TextInput
                    accessibilityLabel="Calendar event tags"
                    value={form.tagDraft}
                    editable={canEditEventTags}
                    onChangeText={handleTagDraftChange}
                    onSubmitEditing={handleAddTagDraft}
                    placeholder="School, travel, birthday"
                    placeholderTextColor={colors.inkMuted}
                    style={[styles.textInput, styles.tagComposerInput, !canEditEventTags && styles.inputDisabled]}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onFocus={recordParentActivity}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add tag"
                    disabled={!canEditEventTags}
                    onPress={handleAddTagDraft}
                    style={[styles.tagAddButton, !canEditEventTags && styles.tagAddButtonDisabled]}
                  >
                    <Text style={[styles.tagAddButtonText, !canEditEventTags && styles.actionTextDisabled]}>Add</Text>
                  </Pressable>
                </View>
                {tagSuggestions.length ? (
                  <View style={styles.tagSuggestionRow}>
                    {tagSuggestions.map((tag) => (
                      <Pressable
                        key={`tag-suggestion-${tag.normalizedName}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Use tag ${tag.name}`}
                        disabled={!canEditEventTags}
                        onPress={() => addTagsToForm([tag])}
                        style={[styles.tagSuggestionChip, !canEditEventTags && styles.editorTagChipDisabled]}
                      >
                        <Text style={styles.tagSuggestionText}>{tag.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.fieldHint}>
                  Type a label and tap Add, or separate tags with commas.
                </Text>
              </View>

              {/* All-day toggle */}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: !!form.isAllDay, disabled: !canEditEventDetails }}
                disabled={!canEditEventDetails}
                onPress={() => handleChange('isAllDay', !form.isAllDay)}
                style={[styles.switchRow, !canEditEventDetails && styles.switchRowDisabled]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>All-day event</Text>
                  <Text style={styles.switchMeta}>
                    {form.isAllDay ? 'Date-only event' : 'Timed event with local timezone'}
                  </Text>
                </View>
                <Switch
                  value={!!form.isAllDay}
                  onValueChange={(value) => handleChange('isAllDay', value)}
                  disabled={!canEditEventDetails}
                  trackColor={{ false: withAlpha(colors.locked, 0.72), true: withAlpha(colors.accentCalendar, 0.42) }}
                  thumbColor={form.isAllDay ? colors.accentCalendar : colors.panelElevated}
                />
              </Pressable>

              {/* Dates */}
              <View style={styles.inlineFields}>
                <View style={[styles.fieldBlock, styles.inlineField]}>
                  <Text style={styles.fieldLabel}>Start Date</Text>
                  <TextInput
                    accessibilityLabel="Event start date"
                    value={form.startDate}
                    editable={canEditEventDetails}
                    onChangeText={(value) => handleChange('startDate', value)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.inkMuted}
                    style={[styles.textInput, !canEditEventDetails && styles.inputDisabled]}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={recordParentActivity}
                  />
                </View>
                <View style={[styles.fieldBlock, styles.inlineField]}>
                  <Text style={styles.fieldLabel}>{form.isAllDay ? 'End Date (inclusive)' : 'End Date'}</Text>
                  <TextInput
                    accessibilityLabel="Event end date"
                    value={form.endDate}
                    editable={canEditEventDetails}
                    onChangeText={(value) => handleChange('endDate', value)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.inkMuted}
                    style={[styles.textInput, !canEditEventDetails && styles.inputDisabled]}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={recordParentActivity}
                  />
                </View>
              </View>

              {/* Times (timed events only) */}
              {!form.isAllDay ? (
                <View style={styles.inlineFields}>
                  <View style={[styles.fieldBlock, styles.inlineField]}>
                    <Text style={styles.fieldLabel}>Start Time</Text>
                    <TextInput
                      accessibilityLabel="Event start time"
                      value={form.startTime}
                      editable={canEditEventDetails}
                      onChangeText={(value) => handleChange('startTime', value)}
                      placeholder="HH:mm"
                      placeholderTextColor={colors.inkMuted}
                      style={[styles.textInput, !canEditEventDetails && styles.inputDisabled]}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={recordParentActivity}
                    />
                  </View>
                  <View style={[styles.fieldBlock, styles.inlineField]}>
                    <Text style={styles.fieldLabel}>End Time</Text>
                    <TextInput
                      accessibilityLabel="Event end time"
                      value={form.endTime}
                      editable={canEditEventDetails}
                      onChangeText={(value) => handleChange('endTime', value)}
                      placeholder="HH:mm"
                      placeholderTextColor={colors.inkMuted}
                      style={[styles.textInput, !canEditEventDetails && styles.inputDisabled]}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={recordParentActivity}
                    />
                  </View>
                </View>
              ) : null}

              {/* Actions */}
              <View style={styles.modalActions}>
                {editingEvent?.id ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete calendar event"
                    disabled={saving}
                    onPress={handleDelete}
                    style={[
                      styles.secondaryDangerButton,
                      saving && styles.actionButtonDisabled,
                      !canEditEvents && styles.secondaryDangerLocked,
                    ]}
                  >
                    <Text style={[styles.secondaryDangerText, (saving || !canEditEvents) && styles.actionTextDisabled]}>
                      Delete
                    </Text>
                  </Pressable>
                ) : (
                  <View />
                )}

                <View style={styles.modalActionRight}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel event editing"
                    onPress={onClose}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save calendar event"
                    disabled={saving}
                    onPress={() => { void handleSave(); }}
                    style={[styles.primaryButton, saving && styles.actionButtonDisabled, !canEditEvents && styles.primaryButtonLocked]}
                  >
                    <Text style={[styles.primaryButtonText, (saving || !canEditEvents) && styles.actionTextDisabled]}>
                      {saving
                        ? 'Saving...'
                        : canEditEvents
                          ? (editingEvent?.id ? 'Save' : 'Create')
                          : 'Parent Login'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const createEditSheetStyles = (colors) =>
  StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: withAlpha(colors.ink, 0.35),
      justifyContent: 'flex-end',
    },
    modalKeyboardLayer: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalScrim: {
      flex: 1,
    },
    modalSheet: {
      maxHeight: '88%',
      backgroundColor: colors.panel,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
    },
    modalHandle: {
      alignSelf: 'center',
      width: 46,
      height: 5,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.locked, 0.76),
      marginBottom: 4,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    modalTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 21,
    },
    modalSubtitle: {
      color: colors.inkMuted,
      lineHeight: 18,
      marginTop: 4,
    },
    modalCloseButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    modalCloseText: {
      fontWeight: '700',
      color: colors.inkMuted,
    },
    modalForm: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
    },
    modalFormKeyboardOpen: {
      paddingBottom: spacing.xxl,
    },
    fieldBlock: {
      gap: 6,
    },
    fieldLabel: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    fieldLabelRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    fieldMeta: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    fieldHint: {
      color: colors.inkMuted,
      fontSize: 12,
      lineHeight: 18,
    },
    textInput: {
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: colors.ink,
      fontSize: 15,
    },
    textArea: {
      minHeight: 88,
      paddingTop: 10,
    },
    inputDisabled: {
      backgroundColor: withAlpha(colors.locked, 0.16),
      color: colors.inkMuted,
    },
    editorTagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    editorTagChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.24),
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    editorTagChipDisabled: {
      opacity: 0.6,
    },
    editorTagChipText: {
      color: colors.accentCalendar,
      fontSize: 12,
      fontWeight: '700',
    },
    editorTagChipDismiss: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    tagComposerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    tagComposerInput: {
      flex: 1,
    },
    tagAddButton: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.28),
      backgroundColor: withAlpha(colors.accentCalendar, 0.12),
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    tagAddButtonDisabled: {
      opacity: 0.6,
    },
    tagAddButtonText: {
      color: colors.accentCalendar,
      fontWeight: '800',
    },
    tagSuggestionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    tagSuggestionChip: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    tagSuggestionText: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.md,
      backgroundColor: colors.panel,
      padding: spacing.md,
    },
    switchRowDisabled: {
      backgroundColor: withAlpha(colors.locked, 0.16),
    },
    switchTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 15,
    },
    switchMeta: {
      marginTop: 2,
      color: colors.inkMuted,
      lineHeight: 17,
      fontSize: 12,
    },
    inlineFields: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    inlineField: {
      flex: 1,
    },
    modalActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    modalActionRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    secondaryButton: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    secondaryButtonText: {
      color: colors.inkMuted,
      fontWeight: '700',
    },
    primaryButton: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.36),
      backgroundColor: colors.accentCalendar,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    primaryButtonLocked: {
      backgroundColor: withAlpha(colors.locked, 0.18),
      borderColor: withAlpha(colors.locked, 0.32),
    },
    primaryButtonText: {
      color: colors.onAccent,
      fontWeight: '800',
    },
    secondaryDangerButton: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.danger, 0.24),
      backgroundColor: withAlpha(colors.danger, 0.1),
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    secondaryDangerLocked: {
      backgroundColor: withAlpha(colors.locked, 0.18),
      borderColor: withAlpha(colors.locked, 0.32),
    },
    secondaryDangerText: {
      color: colors.danger,
      fontWeight: '800',
    },
    actionButtonDisabled: {
      opacity: 0.55,
    },
    actionTextDisabled: {
      color: colors.inkMuted,
    },
  });
