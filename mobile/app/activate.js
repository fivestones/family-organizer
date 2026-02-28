import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { ScreenScaffold, PlaceholderCard } from '../src/components/ScreenScaffold';
import { radii, spacing } from '../src/theme/tokens';
import { mobileDeviceActivate } from '../src/lib/api-client';
import { useAppSession } from '../src/providers/AppProviders';
import { useAppTheme } from '../src/theme/ThemeProvider';

export default function ActivateScreen() {
  const { completeActivation } = useAppSession();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [accessKey, setAccessKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleActivate() {
    setSubmitting(true);
    setError('');
    try {
      const result = await mobileDeviceActivate({
        accessKey: accessKey.trim(),
        platform: 'ios',
        deviceName: Constants.deviceName || 'iPhone',
        appVersion: Constants.expoConfig?.version,
      });
      await completeActivation(result.deviceSessionToken);
      router.replace('/lock');
    } catch (e) {
      setError(e?.message || 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenScaffold
      title="Activate this iPhone"
      subtitle="Enter the family device key to unlock shared access. QR scanning will be added in the Phase 1 native auth pass."
      accent={colors.accentChores}
    >
      <View style={styles.panel}>
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
          disabled={submitting || !accessKey.trim()}
          style={[styles.button, (!accessKey.trim() || submitting) && styles.buttonDisabled]}
          onPress={handleActivate}
        >
          <Text style={styles.buttonText}>{submitting ? 'Activating…' : 'Activate Device'}</Text>
        </Pressable>
      </View>

      <PlaceholderCard
        title="Planned in Phase 1"
        body="QR code activation, secure parent elevation flow, avatar-based lock screen, and Instant principal token switching."
      />
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
    backgroundColor: '#fff',
    color: colors.ink,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radii.sm,
    backgroundColor: colors.accentChores,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '600' },
  });
