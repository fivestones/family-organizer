import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { ScreenScaffold } from '../src/components/ScreenScaffold';
import { radii, spacing } from '../src/theme/tokens';
import { mobileDeviceActivate } from '../src/lib/api-client';
import { getServerUrl, setServerUrl } from '../src/lib/server-url';
import { useAppSession } from '../src/providers/AppProviders';
import { useAppTheme } from '../src/theme/ThemeProvider';
import { useBootstrap } from './_layout';

function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export default function ActivateScreen() {
  const { completeActivation } = useAppSession();
  const { rebootstrap } = useBootstrap();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [serverUrl, setServerUrlState] = useState(() => getServerUrl());
  const [accessKey, setAccessKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [urlStatus, setUrlStatus] = useState('');

  async function handleTestConnection() {
    const testUrl = normalizeUrl(serverUrl);
    if (!testUrl) {
      setUrlStatus('error');
      return;
    }
    setUrlStatus('testing');
    try {
      await fetch(`${testUrl}/api/mobile/device-activate`, { method: 'HEAD' });
      setUrlStatus('ok');
    } catch {
      setUrlStatus('error');
    }
  }

  async function handleActivate() {
    setSubmitting(true);
    setError('');
    try {
      await setServerUrl(serverUrl);
      const result = await mobileDeviceActivate({
        accessKey: accessKey.trim(),
        platform: 'ios',
        deviceName: Constants.deviceName || 'iPhone',
        appVersion: Constants.expoConfig?.version,
      });
      await completeActivation(result.deviceSessionToken);
      // Re-bootstrap to fetch server config and initialize InstantDB
      // before navigating. This remounts AppProviders with real providers.
      await rebootstrap();
    } catch (e) {
      setError(e?.message || 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenScaffold
      title="Activate this iPhone"
      subtitle="Enter the server address and device key to connect this phone to your family organizer."
      accent={colors.accentChores}
    >
      <View style={styles.panel}>
        <Text style={styles.label}>Server URL</Text>
        <View style={styles.urlRow}>
          <TextInput
            testID="server-url-input"
            accessibilityLabel="Server URL"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={serverUrl}
            onChangeText={(text) => {
              setServerUrlState(text);
              setUrlStatus('');
            }}
            placeholder="https://your-server.example.com"
            placeholderTextColor={colors.inkMuted}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            testID="test-connection-button"
            accessibilityRole="button"
            accessibilityLabel="Test connection to server"
            style={styles.testButton}
            onPress={handleTestConnection}
            disabled={urlStatus === 'testing' || !serverUrl.trim()}
          >
            <Text style={styles.testButtonText}>
              {urlStatus === 'testing' ? 'Testing…' : 'Test'}
            </Text>
          </Pressable>
        </View>
        {urlStatus === 'ok' && (
          <Text style={styles.urlOk}>Server reachable</Text>
        )}
        {urlStatus === 'error' && (
          <Text style={styles.urlError}>Could not reach server</Text>
        )}

        <View style={styles.divider} />

        <Text style={styles.label}>Device Access Key</Text>
        <TextInput
          testID="activation-key-input"
          accessibilityLabel="Device access key"
          autoCapitalize="none"
          autoCorrect={false}
          value={accessKey}
          onChangeText={setAccessKey}
          placeholder="Enter activation key"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          testID="activate-device-button"
          accessibilityRole="button"
          accessibilityLabel={submitting ? 'Activating device' : 'Activate device'}
          disabled={submitting || !accessKey.trim() || !serverUrl.trim()}
          style={[styles.button, (!accessKey.trim() || !serverUrl.trim() || submitting) && styles.buttonDisabled]}
          onPress={handleActivate}
        >
          <Text style={styles.buttonText}>{submitting ? 'Activating…' : 'Activate Device'}</Text>
        </Pressable>
      </View>
    </ScreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  panel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  label: { fontWeight: '700', color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.panelElevated,
    color: colors.ink,
  },
  urlRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  testButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    color: colors.ink,
    fontWeight: '700',
  },
  urlOk: {
    color: colors.success,
    fontWeight: '600',
    fontSize: 13,
  },
  urlError: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.xs,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radii.sm,
    backgroundColor: colors.accentChores,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onAccent, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '600' },
  });
