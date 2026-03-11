import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { id, tx } from '@instantdb/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { getServerUrl, setServerUrl } from '../../src/lib/server-url';
import {
  connectAppleCalendarSync,
  getAppleCalendarSyncStatus,
  runAppleCalendarSync,
  updateAppleCalendarSyncSettings,
} from '../../src/lib/api-client';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function placementLabel(value) {
  return value === 'after' ? 'After amount' : 'Before amount';
}

function formatExample(unit) {
  const amount = (unit.decimalPlaces ?? (unit.isMonetary ? 2 : 0)) > 0 ? '12.50' : '12';
  return unit.symbolPlacement === 'after'
    ? `${amount}${unit.symbolSpacing ? ' ' : ''}${unit.symbol}`
    : `${unit.symbol}${unit.symbolSpacing ? ' ' : ''}${amount}`;
}

function initialFormState() {
  return {
    code: '',
    name: '',
    symbol: '',
    isMonetary: true,
    decimalPlaces: '2',
    symbolPlacement: 'before',
    symbolSpacing: false,
  };
}

function formatRelativeDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absMs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absMs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

function formatDateWithRelative(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${date.toLocaleString()} (${formatRelativeDate(value)})`;
}

function formatDurationMs(value) {
  if (!value || value <= 0) return 'Right away';
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  if (value < 86_400_000) return `${Math.round(value / 3_600_000)}h`;
  return `${Math.round(value / 86_400_000)}d`;
}

function pollReasonLabel(value) {
  switch (value) {
    case 'recent_changes':
      return 'Active polling after recent changes';
    case 'idle_backoff':
      return 'Light backoff while calendars stay quiet';
    case 'idle_backoff_deep':
      return 'Deep backoff while calendars stay quiet';
    case 'error_backoff':
      return 'Retry backoff after recent errors';
    case 'first_run':
      return 'Waiting for the first poll';
    default:
      return 'Standard polling cadence';
  }
}

function isPollingHeartbeatOverdue(polling) {
  if (!polling?.lastSuccessfulPollAt) return false;
  const lastPollMs = new Date(polling.lastSuccessfulPollAt).getTime();
  if (Number.isNaN(lastPollMs)) return false;

  const nextPollMs = new Date(polling.nextPollAt || '').getTime();
  if (!Number.isNaN(nextPollMs)) {
    return Date.now() > nextPollMs + 60_000;
  }

  const intervalMs = Math.max(15_000, Number(polling?.pollIntervalMs) || 0);
  return Date.now() - lastPollMs > intervalMs + 60_000;
}

export default function SettingsScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors, themeName, setThemeName, themeOptions } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    db,
    isAuthenticated,
    instantReady,
    principalType,
    isOnline,
    connectionStatus,
    resetDeviceSession,
  } = useAppSession();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(() => initialFormState());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const canManageUnits = principalType === 'parent';
  const [currentServerUrl, setCurrentServerUrl] = useState(() => getServerUrl());
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [editingUrl, setEditingUrl] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [calendarSyncStatus, setCalendarSyncStatus] = useState(null);
  const [calendarSyncLoading, setCalendarSyncLoading] = useState(false);
  const [calendarSyncError, setCalendarSyncError] = useState('');
  const [calendarSyncSaving, setCalendarSyncSaving] = useState(false);
  const [calendarSyncCredentialsDirty, setCalendarSyncCredentialsDirty] = useState(false);
  const [calendarSyncSelectionDirty, setCalendarSyncSelectionDirty] = useState(false);
  const [calendarSyncForm, setCalendarSyncForm] = useState({
    username: '',
    appSpecificPassword: '',
    accountLabel: 'Apple Calendar',
    selectedCalendarIds: [],
  });

  async function handleTestConnection() {
    setTestStatus('testing');
    try {
      await fetch(`${currentServerUrl}/api/mobile/device-activate`, { method: 'HEAD' });
      setTestStatus('ok');
    } catch {
      setTestStatus('error');
    }
  }

  async function handleSaveUrl() {
    await setServerUrl(editingUrl);
    setCurrentServerUrl(getServerUrl());
    setIsEditingUrl(false);
    setTestStatus('');
    await resetDeviceSession();
  }

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  useEffect(() => {
    if (!canManageUnits) return;
    let cancelled = false;

    async function loadCalendarSyncStatus({ silent = false } = {}) {
      if (!silent) {
        setCalendarSyncLoading(true);
        setCalendarSyncError('');
      }
      try {
        const nextStatus = await getAppleCalendarSyncStatus();
        if (cancelled) return;
        setCalendarSyncStatus(nextStatus);
        const nextSelectedCalendarIds = (nextStatus?.calendars || []).filter((calendar) => calendar.isEnabled).map((calendar) => calendar.remoteCalendarId);
        setCalendarSyncForm((current) => ({
          ...current,
          username: silent && calendarSyncCredentialsDirty ? current.username : (nextStatus?.account?.username || current.username),
          accountLabel: silent && calendarSyncCredentialsDirty ? current.accountLabel : (nextStatus?.account?.accountLabel || current.accountLabel),
          selectedCalendarIds: silent && calendarSyncSelectionDirty ? current.selectedCalendarIds : nextSelectedCalendarIds,
        }));
      } catch (nextError) {
        if (cancelled || silent) return;
        setCalendarSyncError(nextError?.message || 'Unable to load Apple Calendar sync status.');
      } finally {
        if (!cancelled && !silent) setCalendarSyncLoading(false);
      }
    }

    void loadCalendarSyncStatus();
    const intervalId = setInterval(() => {
      void loadCalendarSyncStatus({ silent: true });
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [calendarSyncCredentialsDirty, calendarSyncSelectionDirty, canManageUnits]);

  const settingsQuery = db.useQuery(
    isAuthenticated && instantReady && principalType === 'parent'
      ? {
          unitDefinitions: {
            $: { order: { code: 'asc' } },
          },
          settings: {},
        }
      : null
  );

  const unitDefinitions = useMemo(() => settingsQuery.data?.unitDefinitions || [], [settingsQuery.data?.unitDefinitions]);
  const settingsRows = useMemo(() => settingsQuery.data?.settings || [], [settingsQuery.data?.settings]);
  const currentThemeLabel = useMemo(
    () => themeOptions.find((option) => option.id === themeName)?.label || 'Warm Classic',
    [themeName, themeOptions]
  );
  const calendarSyncSummary = useMemo(() => {
    if (!calendarSyncStatus?.configured) {
      return {
        label: 'Not connected',
        body: 'Connect Apple Calendar to start importing Apple-synced events.',
        color: colors.inkMuted,
      };
    }
    if (calendarSyncSaving || calendarSyncLoading) {
      return {
        label: 'Working',
        body: 'Refreshing sync status or sending a sync request.',
        color: colors.warning,
      };
    }
    if (calendarSyncStatus?.lastRun?.status === 'running') {
      return {
        label: 'Sync in progress',
        body: 'The server is processing Apple changes right now.',
        color: colors.accentChores,
      };
    }
    if (calendarSyncStatus?.lastRun?.status === 'failed' || calendarSyncStatus?.account?.lastErrorMessage) {
      return {
        label: 'Needs attention',
        body: calendarSyncStatus?.account?.lastErrorMessage || calendarSyncStatus?.lastRun?.errorMessage || 'The last sync failed.',
        color: colors.danger,
      };
    }
    if (isPollingHeartbeatOverdue(calendarSyncStatus?.polling)) {
      return {
        label: 'Polling overdue',
        body: 'The background poller has not checked in on schedule. Near-real-time sync only works while the worker or cron is running.',
        color: colors.warning,
      };
    }
    if (calendarSyncStatus?.polling?.pollReason === 'error_backoff') {
      return {
        label: 'Retry backoff',
        body: 'Polling is healthy enough to retry, but the server is spacing checks after errors.',
        color: colors.warning,
      };
    }
    return {
      label: 'Healthy',
      body: calendarSyncStatus?.polling?.pollReason?.startsWith('idle_backoff')
        ? 'Polling is healthy and backing off because Apple calendars have been quiet.'
        : 'Polling is healthy and ready to pick up Apple changes quickly.',
      color: colors.success,
    };
  }, [
    calendarSyncLoading,
    calendarSyncSaving,
    calendarSyncStatus?.account?.lastErrorMessage,
    calendarSyncStatus?.configured,
    calendarSyncStatus?.lastRun?.errorMessage,
    calendarSyncStatus?.lastRun?.status,
    calendarSyncStatus?.polling,
    calendarSyncStatus?.polling?.pollReason,
    colors.accentChores,
    colors.danger,
    colors.inkMuted,
    colors.success,
    colors.warning,
  ]);

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:settings',
      actionLabel: 'Settings',
      payload: { href: '/more/settings' },
      returnPath: '/more/settings',
    });
  }

  async function handleCreateUnit() {
    if (submitting) return;

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const symbol = form.symbol.trim();
    const decimalPlaces = Number(form.decimalPlaces);

    if (!code || code.length < 2) {
      setError('Enter a short unit code like USD, NPR, XP, or HR.');
      return;
    }
    if (!name) {
      setError('Unit name is required.');
      return;
    }
    if (!symbol) {
      setError('A display symbol is required.');
      return;
    }
    if (!Number.isFinite(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) {
      setError('Decimal places must be between 0 and 6.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const unitId = id();
      await db.transact([
        tx.unitDefinitions[unitId].update({
          code,
          name,
          symbol,
          isMonetary: form.isMonetary,
          decimalPlaces,
          symbolPlacement: form.symbolPlacement,
          symbolSpacing: form.symbolSpacing,
        }),
      ]);
      setForm(initialFormState());
      setIsModalOpen(false);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to create the unit definition.');
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshCalendarSyncStatus() {
    const nextStatus = await getAppleCalendarSyncStatus();
    setCalendarSyncStatus(nextStatus);
    const nextSelectedCalendarIds = (nextStatus?.calendars || []).filter((calendar) => calendar.isEnabled).map((calendar) => calendar.remoteCalendarId);
    setCalendarSyncForm((current) => ({
      ...current,
      username: nextStatus?.account?.username || current.username,
      accountLabel: nextStatus?.account?.accountLabel || current.accountLabel,
      selectedCalendarIds: nextSelectedCalendarIds,
    }));
  }

  async function handleConnectCalendarSync() {
    setCalendarSyncSaving(true);
    setCalendarSyncError('');
    try {
      await connectAppleCalendarSync(calendarSyncForm);
      setCalendarSyncCredentialsDirty(false);
      setCalendarSyncSelectionDirty(false);
      setCalendarSyncForm((current) => ({ ...current, appSpecificPassword: '' }));
      await refreshCalendarSyncStatus();
    } catch (nextError) {
      setCalendarSyncError(nextError?.message || 'Unable to connect Apple Calendar.');
    } finally {
      setCalendarSyncSaving(false);
    }
  }

  async function handleSaveCalendarSelection() {
    if (!calendarSyncStatus?.account?.id) return;
    setCalendarSyncSaving(true);
    setCalendarSyncError('');
    try {
      const selectedCalendarIds = [...calendarSyncForm.selectedCalendarIds];
      await updateAppleCalendarSyncSettings({
        accountId: calendarSyncStatus.account.id,
        selectedCalendarIds,
        enabled: true,
      });
      setCalendarSyncSelectionDirty(false);
      setCalendarSyncStatus((current) => {
        if (!current) return current;
        return {
          ...current,
          calendars: (current.calendars || []).map((calendar) => ({
            ...calendar,
            isEnabled: selectedCalendarIds.includes(calendar.remoteCalendarId),
          })),
        };
      });
      void refreshCalendarSyncStatus();
    } catch (nextError) {
      setCalendarSyncError(nextError?.message || 'Unable to save Apple Calendar sync settings.');
    } finally {
      setCalendarSyncSaving(false);
    }
  }

  async function handleRunCalendarSync(trigger = 'manual') {
    if (!calendarSyncStatus?.account?.id) return;
    setCalendarSyncSaving(true);
    setCalendarSyncError('');
    try {
      const result = await runAppleCalendarSync({ accountId: calendarSyncStatus.account.id, trigger });
      const completedAtIso = new Date().toISOString();
      setCalendarSyncStatus((current) => {
        if (!current?.account) return current;
        return {
          ...current,
          account: {
            ...current.account,
            lastAttemptedSyncAt: completedAtIso,
            lastSuccessfulSyncAt: result?.skipped ? current.account.lastSuccessfulSyncAt : completedAtIso,
            lastErrorAt: result?.skipped ? current.account.lastErrorAt : '',
            lastErrorMessage: result?.skipped ? current.account.lastErrorMessage : '',
          },
          lastRun: result?.skipped
            ? current.lastRun
            : {
                ...(current.lastRun || {}),
                status: 'success',
                errorMessage: '',
                finishedAt: completedAtIso,
                startedAt: completedAtIso,
              },
          polling: current.polling
            ? {
                ...current.polling,
                lastSuccessfulPollAt: completedAtIso,
                nextPollAt: result?.nextPollAt || current.polling.nextPollAt,
                nextPollInMs: typeof result?.nextPollInMs === 'number' ? result.nextPollInMs : current.polling.nextPollInMs,
                pollIntervalMs: typeof result?.pollIntervalMs === 'number' ? result.pollIntervalMs : current.polling.pollIntervalMs,
                pollReason: result?.pollReason || current.polling.pollReason,
              }
            : current.polling,
        };
      });
      await refreshCalendarSyncStatus();
    } catch (nextError) {
      setCalendarSyncError(nextError?.message || (trigger === 'repair' ? 'Unable to sync and rewrite Apple Calendar.' : 'Unable to run Apple Calendar sync.'));
    } finally {
      setCalendarSyncSaving(false);
    }
  }

  return (
    <SubscreenScaffold
      title="Settings"
      subtitle="Theme changes stay on this device, while shared unit definitions still use the household Instant data."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: principalType === 'parent' ? 'accent' : 'neutral' },
        { label: currentThemeLabel, tone: 'accent' },
        ...(canManageUnits
          ? [
              {
                label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
                tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
              },
            ]
          : []),
      ]}
      action={
        canManageUnits ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a unit definition"
            style={styles.addButton}
            onPress={() => {
              setError('');
              setIsModalOpen(true);
            }}
          >
            <Text style={styles.addButtonText}>Add Unit</Text>
          </Pressable>
        ) : null
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.serverCard}>
          <Text style={styles.serverEyebrow}>Server Connection</Text>
          <Text style={styles.serverTitle}>API Server</Text>
          {isEditingUrl ? (
            <>
              <TextInput
                testID="settings-server-url-input"
                accessibilityLabel="Server URL"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={editingUrl}
                onChangeText={setEditingUrl}
                placeholder="https://your-server.example.com"
                placeholderTextColor={colors.inkMuted}
                style={styles.input}
              />
              <Text style={styles.serverWarning}>
                Changing the server URL will require re-activation of this device.
              </Text>
              <View style={styles.serverActions}>
                <Pressable
                  style={styles.secondaryChip}
                  onPress={() => setIsEditingUrl(false)}
                >
                  <Text style={styles.secondaryChipText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.primaryChip} onPress={handleSaveUrl}>
                  <Text style={styles.primaryChipText}>Save & Reconnect</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.serverUrlDisplay} numberOfLines={2}>
                {currentServerUrl}
              </Text>
              <View style={styles.serverActions}>
                <Pressable
                  style={styles.secondaryChip}
                  onPress={handleTestConnection}
                  disabled={testStatus === 'testing'}
                >
                  <Text style={styles.secondaryChipText}>
                    {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryChip}
                  onPress={() => {
                    setEditingUrl(currentServerUrl);
                    setIsEditingUrl(true);
                    setTestStatus('');
                  }}
                >
                  <Text style={styles.secondaryChipText}>Change URL</Text>
                </Pressable>
              </View>
              {testStatus === 'ok' && (
                <Text style={styles.serverOk}>Server reachable</Text>
              )}
              {testStatus === 'error' && (
                <Text style={styles.serverError}>Could not reach server</Text>
              )}
            </>
          )}
        </View>
        {canManageUnits ? (
          <View style={styles.syncCard}>
            <Text style={styles.serverEyebrow}>Apple Calendar Sync</Text>
            <Text style={styles.serverTitle}>Read-only import from Apple Calendar</Text>
            <Text style={styles.themeBody}>
              Connect one Apple account, choose which calendars to import, and sync those events into the shared family calendar.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Apple ID Email</Text>
              <TextInput
                value={calendarSyncForm.username}
                onChangeText={(value) => {
                  setCalendarSyncCredentialsDirty(true);
                  setCalendarSyncForm((current) => ({ ...current, username: value }));
                }}
                placeholder="parent@example.com"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={styles.input}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>App-Specific Password</Text>
              <TextInput
                value={calendarSyncForm.appSpecificPassword}
                onChangeText={(value) => {
                  setCalendarSyncCredentialsDirty(true);
                  setCalendarSyncForm((current) => ({ ...current, appSpecificPassword: value }));
                }}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
            </View>

            <View style={styles.serverActions}>
              <Pressable style={styles.secondaryChip} disabled={calendarSyncSaving || calendarSyncLoading} onPress={() => void refreshCalendarSyncStatus()}>
                <Text style={styles.secondaryChipText}>{calendarSyncLoading ? 'Refreshing…' : 'Refresh'}</Text>
              </Pressable>
              <Pressable style={styles.primaryChip} disabled={calendarSyncSaving} onPress={() => void handleConnectCalendarSync()}>
                <Text style={styles.primaryChipText}>{calendarSyncSaving ? 'Connecting…' : calendarSyncStatus?.configured ? 'Reconnect' : 'Connect'}</Text>
              </Pressable>
            </View>

            {calendarSyncStatus?.configured ? (
              <>
                <Text style={styles.serverOk}>
                  Connected as {calendarSyncStatus.account?.username || 'Apple account'}
                </Text>
                <View style={[styles.syncSummaryBadge, { borderColor: calendarSyncSummary.color, backgroundColor: withAlpha(calendarSyncSummary.color, 0.08) }]}>
                  <Text style={[styles.syncSummaryLabel, { color: calendarSyncSummary.color }]}>{calendarSyncSummary.label}</Text>
                  <Text style={styles.syncSummaryBody}>{calendarSyncSummary.body}</Text>
                </View>
                <Text style={styles.syncStatusHint}>
                  Sync Now uses the normal incremental Apple delta sync. Sync and Rewrite forces a full repair pass and can rewrite imported rows after bugs or mapping changes.
                </Text>
                <View style={styles.syncStatusGrid}>
                  <View style={styles.syncStatusCell}>
                    <Text style={styles.syncStatusLabel}>Last successful sync</Text>
                    <Text style={styles.syncStatusValue}>{formatDateWithRelative(calendarSyncStatus?.account?.lastSuccessfulSyncAt)}</Text>
                  </View>
                  <View style={styles.syncStatusCell}>
                    <Text style={styles.syncStatusLabel}>Last poll heartbeat</Text>
                    <Text style={styles.syncStatusValue}>{formatDateWithRelative(calendarSyncStatus?.polling?.lastSuccessfulPollAt)}</Text>
                  </View>
                  <View style={styles.syncStatusCell}>
                    <Text style={styles.syncStatusLabel}>Next poll</Text>
                    <Text style={styles.syncStatusValue}>{formatDateWithRelative(calendarSyncStatus?.polling?.nextPollAt)}</Text>
                    <Text style={styles.syncStatusHint}>About {formatDurationMs(calendarSyncStatus?.polling?.nextPollInMs)}</Text>
                  </View>
                  <View style={styles.syncStatusCell}>
                    <Text style={styles.syncStatusLabel}>Polling mode</Text>
                    <Text style={styles.syncStatusValue}>{pollReasonLabel(calendarSyncStatus?.polling?.pollReason)}</Text>
                    <Text style={styles.syncStatusHint}>Interval {formatDurationMs(calendarSyncStatus?.polling?.pollIntervalMs)}</Text>
                  </View>
                </View>
                <Text style={styles.syncStatusHint}>
                  Background polling only updates when the server worker or cron is hitting the Apple sync route. Quiet calendars also back off to a slower cadence between checks.
                </Text>
                <View style={styles.choiceColumn}>
                  {(calendarSyncStatus.calendars || []).map((calendar) => {
                    const selected = calendarSyncForm.selectedCalendarIds.includes(calendar.remoteCalendarId);
                    return (
                      <Pressable
                        key={calendar.id || calendar.remoteCalendarId}
                        style={[styles.choiceChip, selected && styles.choiceChipSelected]}
                        onPress={() => {
                          setCalendarSyncSelectionDirty(true);
                          setCalendarSyncForm((current) => {
                            const selectedIds = current.selectedCalendarIds.includes(calendar.remoteCalendarId)
                              ? current.selectedCalendarIds.filter((item) => item !== calendar.remoteCalendarId)
                              : [...current.selectedCalendarIds, calendar.remoteCalendarId];
                            return { ...current, selectedCalendarIds: selectedIds };
                          });
                        }}
                      >
                        <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                          {selected ? 'Imported' : 'Tap to import'} • {calendar.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.serverActions}>
                  <Pressable style={styles.secondaryChip} disabled={calendarSyncSaving} onPress={() => void handleSaveCalendarSelection()}>
                    <Text style={styles.secondaryChipText}>{calendarSyncSaving ? 'Saving…' : 'Save Calendars'}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryChip} disabled={calendarSyncSaving} onPress={() => void handleRunCalendarSync('manual')}>
                    <Text style={styles.secondaryChipText}>{calendarSyncSaving ? 'Syncing…' : 'Sync Now'}</Text>
                  </Pressable>
                  <Pressable style={styles.primaryChip} disabled={calendarSyncSaving} onPress={() => void handleRunCalendarSync('repair')}>
                    <Text style={styles.primaryChipText}>{calendarSyncSaving ? 'Syncing…' : 'Sync and Rewrite'}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {calendarSyncStatus?.lastRun?.errorMessage ? (
              <Text style={styles.serverError}>{calendarSyncStatus.lastRun.errorMessage}</Text>
            ) : null}
            {calendarSyncError ? <Text style={styles.serverError}>{calendarSyncError}</Text> : null}
          </View>
        ) : null}

        <View style={styles.themeCard}>
          <Text style={styles.themeEyebrow}>Local Appearance</Text>
          <Text style={styles.themeTitle}>App theme</Text>
          <Text style={styles.themeBody}>
            This changes only this iPhone or iPad. It does not sync to the family database.
          </Text>
          <View style={styles.themeOptions}>
            {themeOptions.map((option) => {
              const selected = option.id === themeName;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${option.label} theme`}
                  style={[styles.themeOption, selected && styles.themeOptionSelected]}
                  onPress={() => {
                    void setThemeName(option.id);
                  }}
                >
                  <View style={styles.themeOptionHeader}>
                    <Text style={[styles.themeOptionLabel, selected && styles.themeOptionLabelSelected]}>{option.label}</Text>
                    <Text style={[styles.themeOptionBadge, selected && styles.themeOptionBadgeSelected]}>
                      {selected ? 'Selected' : 'Tap to apply'}
                    </Text>
                  </View>
                  <Text style={styles.themeOptionDescription}>{option.description}</Text>
                  <View style={styles.themeSwatchRow}>
                    {option.preview.map((swatch) => (
                      <View key={`${option.id}-${swatch}`} style={[styles.themeSwatch, { backgroundColor: swatch }]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {canManageUnits ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryEyebrow}>Household Units</Text>
              <Text style={styles.summaryTitle}>Currency and rewards</Text>
              <Text style={styles.summaryBody}>
                This screen now surfaces the shared unit catalog so finance totals, chore rewards, and custom point systems use the same definitions on mobile as the web app.
              </Text>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Unit Definitions</Text>
              {settingsQuery.isLoading ? (
                <Text style={styles.helperText}>Loading unit definitions…</Text>
              ) : unitDefinitions.length === 0 ? (
                <Text style={styles.helperText}>No units defined yet.</Text>
              ) : (
                unitDefinitions.map((unit) => (
                  <View key={unit.id} style={styles.unitCard}>
                    <View style={styles.unitHeader}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.unitCode}>{unit.code}</Text>
                        <Text style={styles.unitName}>{unit.name}</Text>
                      </View>
                      <View style={[styles.unitTypePill, unit.isMonetary ? styles.monetaryPill : styles.customPill]}>
                        <Text style={[styles.unitTypeText, unit.isMonetary ? styles.monetaryText : styles.customText]}>
                          {unit.isMonetary ? 'Monetary' : 'Custom'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.metaGrid}>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>Symbol</Text>
                        <Text style={styles.metaValue}>{unit.symbol}</Text>
                      </View>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>Placement</Text>
                        <Text style={styles.metaValue}>{placementLabel(unit.symbolPlacement)}</Text>
                      </View>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>Decimals</Text>
                        <Text style={styles.metaValue}>{unit.decimalPlaces ?? 0}</Text>
                      </View>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>Example</Text>
                        <Text style={styles.metaValue}>{formatExample(unit)}</Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Raw Settings Rows</Text>
              {settingsRows.length === 0 ? (
                <Text style={styles.helperText}>No raw `settings` rows found in this Instant app yet.</Text>
              ) : (
                settingsRows.map((row) => (
                  <View key={row.id} style={styles.settingRow}>
                    <Text style={styles.settingName}>{row.name}</Text>
                    <Text style={styles.settingValue}>{row.value}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <ParentAccessNotice
            body="Log in as a parent to review shared currency settings and create new unit definitions. The theme switch above is already local and available now."
            onContinue={handoffToParent}
          />
        )}
      </ScrollView>

      <Modal visible={canManageUnits && isModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setIsModalOpen(false)}>
        <View style={styles.modalScreen}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>New Unit Definition</Text>
                <Text style={styles.modalSubtitle}>Create a shared currency or custom reward unit for finance and chore rewards.</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={() => setIsModalOpen(false)}>
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Code</Text>
                <TextInput
                  value={form.code}
                  onChangeText={(value) => setForm((current) => ({ ...current, code: value.toUpperCase() }))}
                  placeholder="USD"
                  placeholderTextColor={colors.inkMuted}
                  autoCapitalize="characters"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
                  placeholder="US Dollar"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Symbol</Text>
                <TextInput
                  value={form.symbol}
                  onChangeText={(value) => setForm((current) => ({ ...current, symbol: value }))}
                  placeholder="$"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.input}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.toggleTitle}>Monetary unit</Text>
                  <Text style={styles.toggleBody}>Turn this off for points, stars, hours, and other non-cash rewards.</Text>
                </View>
                <Switch
                  value={form.isMonetary}
                  onValueChange={(value) => setForm((current) => ({ ...current, isMonetary: value }))}
                  thumbColor={colors.panelElevated}
                  trackColor={{ false: withAlpha(colors.locked, 0.72), true: colors.accentMore }}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Decimal Places</Text>
                <TextInput
                  value={form.decimalPlaces}
                  onChangeText={(value) => setForm((current) => ({ ...current, decimalPlaces: value }))}
                  placeholder="2"
                  placeholderTextColor={colors.inkMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Symbol Placement</Text>
                <View style={styles.choiceRow}>
                  {['before', 'after'].map((value) => {
                    const selected = form.symbolPlacement === value;
                    return (
                      <Pressable
                        key={value}
                        style={[styles.choiceChip, selected && styles.choiceChipSelected]}
                        onPress={() => setForm((current) => ({ ...current, symbolPlacement: value }))}
                      >
                        <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                          {placementLabel(value)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.toggleTitle}>Add spacing</Text>
                  <Text style={styles.toggleBody}>Examples: `$ 12.50` or `12.50 XP`.</Text>
                </View>
                <Switch
                  value={form.symbolSpacing}
                  onValueChange={(value) => setForm((current) => ({ ...current, symbolSpacing: value }))}
                  thumbColor={colors.panelElevated}
                  trackColor={{ false: withAlpha(colors.locked, 0.72), true: colors.accentMore }}
                />
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.formActions}>
                <Pressable style={styles.secondaryAction} onPress={() => setIsModalOpen(false)}>
                  <Text style={styles.secondaryActionText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.primaryAction} onPress={() => void handleCreateUnit()}>
                  <Text style={styles.primaryActionText}>{submitting ? 'Saving…' : 'Create Unit'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SubscreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  addButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.accentMore,
    fontWeight: '700',
  },
  syncCard: {
    backgroundColor: withAlpha(colors.accentCalendar, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentCalendar, 0.24),
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  syncSummaryBadge: {
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 4,
  },
  syncSummaryLabel: {
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  syncSummaryBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  syncStatusGrid: {
    gap: spacing.sm,
  },
  syncStatusCell: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: colors.panelElevated,
    padding: spacing.sm,
    gap: 4,
  },
  syncStatusLabel: {
    color: colors.inkMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  syncStatusValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  syncStatusHint: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  themeCard: {
    backgroundColor: withAlpha(colors.accentMore, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.2),
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  themeEyebrow: {
    color: colors.accentMore,
    textTransform: 'uppercase',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  themeTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  themeBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  themeOptions: {
    gap: spacing.sm,
  },
  themeOption: {
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.2),
    backgroundColor: colors.panelElevated,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  themeOptionSelected: {
    borderColor: colors.accentMore,
    backgroundColor: withAlpha(colors.accentMore, 0.08),
  },
  themeOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  themeOptionLabel: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 16,
    flex: 1,
  },
  themeOptionLabelSelected: {
    color: colors.accentMore,
  },
  themeOptionBadge: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  themeOptionBadgeSelected: {
    color: colors.accentMore,
  },
  themeOptionDescription: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  themeSwatchRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: 2,
  },
  themeSwatch: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.panelElevated, 0.8),
  },
  summaryCard: {
    backgroundColor: withAlpha(colors.accentMore, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.22),
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryEyebrow: {
    color: colors.accentMore,
    textTransform: 'uppercase',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  summaryTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  summaryBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  panel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  helperText: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  unitCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: colors.panel,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  unitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  unitCode: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  unitName: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  unitTypePill: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  monetaryPill: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.26),
  },
  customPill: {
    backgroundColor: withAlpha(colors.warning, 0.12),
    borderColor: withAlpha(colors.warning, 0.26),
  },
  unitTypeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  monetaryText: {
    color: colors.success,
  },
  customText: {
    color: colors.warning,
  },
  metaGrid: {
    gap: spacing.sm,
  },
  metaCell: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  metaLabel: {
    color: colors.inkMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  metaValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  settingRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 4,
  },
  settingName: {
    color: colors.ink,
    fontWeight: '700',
  },
  settingValue: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  modalCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: colors.inkMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  closeButton: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: colors.ink,
    fontWeight: '700',
  },
  formContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.ink,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: colors.panelElevated,
    color: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: colors.panel,
    padding: spacing.md,
  },
  toggleTitle: {
    color: colors.ink,
    fontWeight: '700',
  },
  toggleBody: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choiceColumn: {
    gap: spacing.sm,
  },
  choiceChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceChipSelected: {
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderColor: withAlpha(colors.accentMore, 0.24),
  },
  choiceChipText: {
    color: colors.inkMuted,
    fontWeight: '700',
    fontSize: 12,
  },
  choiceChipTextSelected: {
    color: colors.accentMore,
  },
  errorText: {
    color: colors.danger,
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.ink,
    fontWeight: '700',
  },
  primaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.sm,
    backgroundColor: colors.accentMore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: colors.onAccent,
    fontWeight: '700',
  },
  serverCard: {
    backgroundColor: withAlpha(colors.accentChores, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentChores, 0.2),
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  serverEyebrow: {
    color: colors.accentChores,
    textTransform: 'uppercase',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  serverTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  serverUrlDisplay: {
    color: colors.ink,
    fontSize: 14,
    fontFamily: 'Courier',
  },
  serverWarning: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  serverActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  secondaryChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryChipText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  primaryChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accentChores,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryChipText: {
    color: colors.onAccent,
    fontWeight: '700',
    fontSize: 13,
  },
  serverOk: {
    color: colors.success,
    fontWeight: '600',
    fontSize: 13,
  },
  serverError: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  });
