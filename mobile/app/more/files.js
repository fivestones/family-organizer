import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { getPresignedFileUrl, getMobileFilesList } from '../../src/lib/api-client';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatTimestamp(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function FilesScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { principalType, isOnline, connectionStatus } = useAppSession();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  useEffect(() => {
    if (principalType !== 'parent') return;
    void loadFiles();
  }, [principalType]);

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:files',
      actionLabel: 'Files',
      payload: { href: '/more/files' },
      returnPath: '/more/files',
    });
  }

  async function loadFiles() {
    setLoading(true);
    setError('');
    try {
      const response = await getMobileFilesList();
      setFiles(response.files || []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load files.');
    } finally {
      setLoading(false);
    }
  }

  async function openFile(fileKey) {
    try {
      const url = await getPresignedFileUrl(fileKey);
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Unable to open file', error?.message || 'Please try again.');
    }
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Files"
        subtitle="Storage browsing is parent-gated because it can expose household uploads and attachments."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to browse uploaded files and open them through the mobile bearer-auth route."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Files"
      subtitle="Phase 4 now includes native file listing through the mobile auth contract."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        { label: `${files.length} files`, tone: 'accent' },
      ]}
      action={
        <Pressable style={styles.refreshButton} onPress={() => void loadFiles()}>
          <Text style={styles.refreshButtonText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </Pressable>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Storage</Text>
          <Text style={styles.summaryTitle}>Mobile file browser</Text>
          <Text style={styles.summaryBody}>
            Opening a file uses the bearer-auth mobile route, so downloads stay aligned with the existing shared-device security model.
          </Text>
        </View>

        {loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Loading files…</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load files</Text>
            <Text style={styles.emptyBody}>{error}</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No uploaded files yet</Text>
            <Text style={styles.emptyBody}>Once attachments or file-manager uploads land in this environment, they will show up here.</Text>
          </View>
        ) : (
          files.map((file) => (
            <View key={file.key} style={styles.fileCard}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.fileName}>{file.key}</Text>
                <Text style={styles.fileMeta}>
                  {formatSize(file.size)} • {formatTimestamp(file.lastModified)}
                </Text>
              </View>
              <Pressable style={styles.openButton} onPress={() => void openFile(file.key)}>
                <Text style={styles.openButtonText}>Open</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SubscreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  refreshButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonText: {
    color: colors.accentMore,
    fontWeight: '700',
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
  emptyCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  fileCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fileName: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 14,
  },
  fileMeta: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  openButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  openButtonText: {
    color: colors.accentMore,
    fontWeight: '700',
  },
  });
