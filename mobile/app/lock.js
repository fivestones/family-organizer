import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { ScreenScaffold, PlaceholderCard } from '../src/components/ScreenScaffold';
import { colors, radii, spacing } from '../src/theme/tokens';
import { useAppSession } from '../src/providers/AppProviders';
import { hashPinClient } from '../src/lib/pin-hash';
import { getApiBaseUrl } from '../src/lib/api-client';

function avatarUriForMember(member) {
  const fileName =
    member?.photoUrls?.['320'] ||
    member?.photoUrls?.[320] ||
    member?.photoUrls?.['64'] ||
    member?.photoUrls?.[64];

  if (!fileName) return null;
  return `${getApiBaseUrl()}/uploads/${fileName}`;
}

function automationMemberKey(member) {
  const source = member?.name || member?.id || 'unknown';
  return String(source)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function LockScreen() {
  const {
    activationRequired,
    isAuthenticated,
    familyMembers,
    familyMembersLoading,
    familyMembersError,
    instantReady,
    bootstrapStatus,
    bootstrapError,
    retryBootstrap,
    isSwitchingPrincipal,
    principalType,
    canUseCachedParentPrincipal,
    isParentSessionSharedDevice,
    isOnline,
    ensureKidPrincipal,
    elevateParentPrincipal,
    login,
  } = useAppSession();

  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [parentSharedDevice, setParentSharedDevice] = useState(isParentSessionSharedDevice);

  const selectedMember = useMemo(
    () => familyMembers.find((member) => member.id === selectedMemberId) || null,
    [familyMembers, selectedMemberId]
  );

  const isParentSelection = selectedMember?.role === 'parent';
  const parentPinCanBeSkipped =
    isParentSelection && canUseCachedParentPrincipal && principalType === 'parent';

  if (activationRequired) {
    return <Redirect href="/activate" />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/chores" />;
  }

  async function handleMemberConfirm() {
    if (!selectedMember) return;

    setSubmitting(true);
    setError('');

    try {
      if (selectedMember.role === 'parent') {
        if (!parentPinCanBeSkipped && !pin.trim()) {
          throw new Error('Parent PIN is required');
        }

        if (!parentPinCanBeSkipped && !isOnline) {
          throw new Error('Parent mode requires internet access');
        }

        await elevateParentPrincipal({
          familyMemberId: selectedMember.id,
          pin: pin.trim(),
          sharedDevice: parentSharedDevice,
        });

        await login(selectedMember);
        router.replace('/(tabs)/chores');
        return;
      }

      await ensureKidPrincipal({ clearParentSession: true });

      if (selectedMember.pinHash) {
        if (!pin.trim()) {
          throw new Error('PIN is required');
        }
        const hashedInput = await hashPinClient(pin.trim());
        if (hashedInput !== selectedMember.pinHash) {
          throw new Error('Incorrect PIN');
        }
      }

      await login(selectedMember);
      router.replace('/(tabs)/chores');
    } catch (e) {
      setError(e?.message || 'Unable to log in');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSelectMember(member) {
    setSelectedMemberId(member.id);
    setPin('');
    setError('');
    setParentSharedDevice(isParentSessionSharedDevice);
  }

  const accent =
    selectedMember?.role === 'parent'
      ? colors.accentMore
      : selectedMember?.role === 'child'
      ? colors.accentChores
      : colors.accentMore;

  return (
    <ScreenScaffold
      title="Who’s using the app?"
      subtitle={
        instantReady
          ? 'Choose a family member to continue. Parent mode requires elevation and auto-demotes on shared devices.'
          : 'Connecting to family data…'
      }
      accent={accent}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label:
            principalType === 'parent'
              ? 'Parent principal'
              : principalType === 'kid'
              ? 'Kid principal'
              : 'No principal',
          tone: principalType === 'parent' ? 'accent' : 'neutral',
        },
      ]}
    >
      {!instantReady || bootstrapStatus === 'signing_in' ? (
        <View style={styles.centerPanel}>
          <ActivityIndicator size="large" color={colors.accentMore} />
          <Text style={styles.centerTitle}>Connecting to InstantDB</Text>
          <Text style={styles.centerText}>
            {bootstrapStatus === 'error'
              ? bootstrapError?.message || 'Unable to connect to family data.'
              : 'Signing into the shared family principal and loading member profiles.'}
          </Text>
          {(bootstrapStatus === 'error' || bootstrapError) && (
            <Pressable
              testID="lock-retry-connection-button"
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
              style={styles.secondaryButton}
              onPress={retryBootstrap}
            >
              <Text style={styles.secondaryButtonText}>Retry Connection</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          {familyMembersLoading ? (
            <View style={styles.centerPanel}>
              <ActivityIndicator size="large" color={colors.accentMore} />
              <Text style={styles.centerTitle}>Loading family members</Text>
            </View>
          ) : familyMembersError ? (
            <View style={styles.centerPanel}>
              <Text style={styles.centerTitle}>Couldn’t load family members</Text>
              <Text style={styles.centerText}>{familyMembersError.message || 'Please try again.'}</Text>
              <Pressable
                testID="lock-retry-members-button"
                accessibilityRole="button"
                accessibilityLabel="Retry loading family members"
                style={styles.secondaryButton}
                onPress={retryBootstrap}
              >
                <Text style={styles.secondaryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {!selectedMember ? (
                <>
                  <View style={styles.grid}>
                    {familyMembers.map((member) => {
                      const avatarUri = avatarUriForMember(member);
                      const isParent = member.role === 'parent';
                      return (
                        <Pressable
                          key={member.id}
                          testID={`member-card-${automationMemberKey(member)}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${member.name || 'family member'} ${isParent ? 'parent' : 'child'}`}
                          style={[styles.memberCard, isParent && styles.memberCardParent]}
                          onPress={() => handleSelectMember(member)}
                        >
                          {avatarUri ? (
                            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                          ) : (
                            <View style={[styles.avatar, { backgroundColor: isParent ? '#DCCFEF' : '#ECD9C9' }]}>
                              <Text style={styles.avatarFallback}>{(member.name || '?').slice(0, 1).toUpperCase()}</Text>
                            </View>
                          )}
                          <Text style={styles.memberName}>{member.name}</Text>
                          <Text style={styles.memberSub}>
                            {isParent ? 'Parent (elevation required)' : member.pinHash ? 'PIN required' : 'Tap to enter'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {familyMembers.length === 0 ? (
                    <PlaceholderCard
                      title="No family members found"
                      body="The mobile auth shell is connected, but the familyMembers table is empty in this Instant app."
                    />
                  ) : null}
                </>
              ) : (
                <KeyboardAvoidingView
                  style={styles.detailKeyboardWrap}
                  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                  keyboardVerticalOffset={8}
                >
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.detailScrollContent}
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={styles.detailPanel}>
                      <View style={styles.selectedHeader}>
                        {avatarUriForMember(selectedMember) ? (
                          <Image source={{ uri: avatarUriForMember(selectedMember) }} style={styles.selectedAvatarImage} />
                        ) : (
                          <View style={[styles.selectedAvatarFallback, { backgroundColor: '#EBDCC5' }]}>
                            <Text style={styles.selectedAvatarLetter}>
                              {(selectedMember.name || '?').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectedName}>{selectedMember.name}</Text>
                          <Text style={styles.selectedRole}>
                            {isParentSelection ? 'Parent mode' : 'Kid mode'}
                            {isParentSelection && parentPinCanBeSkipped ? ' (already unlocked on device)' : ''}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.label}>
                        {isParentSelection
                          ? parentPinCanBeSkipped
                            ? 'PIN (optional)'
                            : 'Parent PIN'
                          : selectedMember.pinHash
                          ? 'PIN'
                          : 'No PIN required'}
                      </Text>
                      <TextInput
                        testID="member-pin-input"
                        accessibilityLabel={
                          isParentSelection
                            ? parentPinCanBeSkipped
                              ? 'Parent PIN optional'
                              : 'Parent PIN'
                            : selectedMember.pinHash
                            ? 'PIN'
                            : 'No PIN required'
                        }
                        value={pin}
                        onChangeText={setPin}
                        placeholder={
                          isParentSelection
                            ? parentPinCanBeSkipped
                              ? 'PIN (optional)'
                              : 'Enter PIN'
                            : selectedMember.pinHash
                            ? 'Enter PIN'
                            : 'Press Continue'
                        }
                        placeholderTextColor={colors.inkMuted}
                        style={styles.input}
                        secureTextEntry
                        keyboardType="number-pad"
                        textContentType="password"
                        autoFocus
                        editable={Boolean(selectedMember.pinHash) || isParentSelection}
                        onSubmitEditing={handleMemberConfirm}
                        maxLength={12}
                      />

                      {isParentSelection ? (
                        <View style={styles.toggleRow}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.toggleTitle}>Shared device mode</Text>
                            <Text style={styles.toggleSub}>
                              Parent access auto-demotes after inactivity when enabled.
                            </Text>
                          </View>
                          <Switch
                            testID="parent-shared-device-switch"
                            accessibilityLabel="Shared device mode"
                            value={parentSharedDevice}
                            onValueChange={setParentSharedDevice}
                            thumbColor="#fff"
                            trackColor={{ false: '#BFC9D6', true: colors.accentMore }}
                          />
                        </View>
                      ) : null}

                      {!isOnline && isParentSelection && !parentPinCanBeSkipped ? (
                        <Text style={styles.warningText}>Internet is required for parent elevation.</Text>
                      ) : null}
                      {error ? (
                        <Text testID="lock-error-message" style={styles.error}>
                          {error}
                        </Text>
                      ) : null}

                      <View style={styles.buttonRow}>
                        <Pressable
                          testID="member-back-button"
                          accessibilityRole="button"
                          accessibilityLabel="Back to family member list"
                          style={[styles.secondaryButton, styles.backButton]}
                          onPress={() => {
                            setSelectedMemberId(null);
                            setPin('');
                            setError('');
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>Back</Text>
                        </Pressable>
                        <Pressable
                          testID="member-confirm-button"
                          accessibilityRole="button"
                          accessibilityLabel={
                            submitting || isSwitchingPrincipal
                              ? 'Working'
                              : selectedMember.pinHash || isParentSelection
                              ? 'Unlock'
                              : 'Continue'
                          }
                          disabled={submitting || isSwitchingPrincipal}
                          style={[
                            styles.button,
                            (submitting || isSwitchingPrincipal) && styles.buttonDisabled,
                            isParentSelection ? { backgroundColor: colors.accentMore } : { backgroundColor: colors.accentChores },
                          ]}
                          onPress={handleMemberConfirm}
                        >
                          <Text style={styles.buttonText}>
                            {submitting || isSwitchingPrincipal
                              ? 'Working…'
                              : selectedMember.pinHash || isParentSelection
                              ? 'Unlock'
                              : 'Continue'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </ScrollView>
                </KeyboardAvoidingView>
              )}
            </>
          )}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerPanel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  centerTitle: { fontWeight: '700', fontSize: 16, color: colors.ink, textAlign: 'center' },
  centerText: { color: colors.inkMuted, textAlign: 'center', lineHeight: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  memberCard: {
    width: '48%',
    minWidth: 150,
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  memberCardParent: {
    borderColor: '#D7CCE7',
    backgroundColor: '#FBF8FF',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
  },
  avatarFallback: { fontSize: 24, fontWeight: '800', color: colors.ink },
  memberName: { fontSize: 17, fontWeight: '700', color: colors.ink },
  memberSub: { color: colors.inkMuted, fontSize: 12 },
  detailPanel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailKeyboardWrap: {
    flex: 1,
  },
  detailScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingBottom: spacing.sm,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectedAvatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedAvatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedAvatarLetter: { fontSize: 28, fontWeight: '800', color: colors.ink },
  selectedName: { fontSize: 19, fontWeight: '800', color: colors.ink },
  selectedRole: { color: colors.inkMuted, marginTop: 2 },
  label: { fontWeight: '700', color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: '#fff',
    color: colors.ink,
    fontSize: 18,
    letterSpacing: 1.5,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    padding: spacing.md,
    backgroundColor: '#FFF9F2',
  },
  toggleTitle: { color: colors.ink, fontWeight: '700' },
  toggleSub: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  warningText: { color: colors.warning, fontWeight: '600' },
  error: { color: colors.danger, fontWeight: '600' },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: radii.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.ink, fontWeight: '700' },
  backButton: { flex: 0.9 },
});
