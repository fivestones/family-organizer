import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  const detailScrollRef = useRef(null);

  const selectedMember = useMemo(
    () => familyMembers.find((member) => member.id === selectedMemberId) || null,
    [familyMembers, selectedMemberId]
  );

  const isParentSelection = selectedMember?.role === 'parent';
  const parentPinCanBeSkipped =
    isParentSelection && canUseCachedParentPrincipal && principalType === 'parent';
  const isDetailMode = !!selectedMember;
  const keyboardVisible = keyboardInset > 0;
  const compactPinLayout = isDetailMode && keyboardVisible;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextInset = Math.max(0, event?.endCoordinates?.height || 0);
      setKeyboardInset(nextInset);

      if (selectedMemberId) {
        setTimeout(() => {
          detailScrollRef.current?.scrollToEnd?.({ animated: true });
        }, 80);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [selectedMemberId]);

  if (activationRequired) {
    return <Redirect href="/activate" />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/chores" />;
  }

  async function handleMemberConfirm() {
    if (!selectedMember) return;
    if (submitting) return;

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

      // The lock screen itself is loaded using the kid principal in normal flows, so
      // avoid an unnecessary principal re-sign-in unless we need to demote from parent
      // (or recover from an unknown principal state).
      if (principalType !== 'kid') {
        await ensureKidPrincipal({ clearParentSession: true });
      }

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

  const lockTitle = isDetailMode ? `Unlock for ${selectedMember.name}` : 'Who’s using the app?';
  const lockSubtitle = !isDetailMode
    ? instantReady
      ? 'Choose a family member to continue. Parent mode requires elevation and auto-demotes on shared devices.'
      : 'Connecting to family data…'
    : keyboardVisible
    ? null
    : isParentSelection
    ? 'Enter parent PIN to unlock parent mode on this shared device.'
    : selectedMember.pinHash
    ? 'Enter PIN to continue.'
    : 'No PIN set for this member.';

  const headerStatusChips = keyboardVisible
    ? []
    : [
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
      ];

  return (
    <ScreenScaffold
      title={lockTitle}
      subtitle={lockSubtitle}
      accent={accent}
      statusChips={headerStatusChips}
      headerMode={isDetailMode ? 'compact' : 'default'}
      layoutMode={isDetailMode ? 'compact' : 'default'}
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
                    ref={detailScrollRef}
                    style={styles.detailScroll}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    contentInset={{ bottom: keyboardInset }}
                    scrollIndicatorInsets={{ bottom: keyboardInset }}
                    contentContainerStyle={[
                      styles.detailScrollContent,
                      { paddingBottom: spacing.lg + keyboardInset },
                    ]}
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={[styles.detailPanel, compactPinLayout && styles.detailPanelCompact]}>
                      <View style={[styles.selectedHeader, compactPinLayout && styles.selectedHeaderCompact]}>
                        {avatarUriForMember(selectedMember) ? (
                          <Image
                            source={{ uri: avatarUriForMember(selectedMember) }}
                            style={[styles.selectedAvatarImage, compactPinLayout && styles.selectedAvatarImageCompact]}
                          />
                        ) : (
                          <View
                            style={[
                              styles.selectedAvatarFallback,
                              compactPinLayout && styles.selectedAvatarFallbackCompact,
                              { backgroundColor: '#EBDCC5' },
                            ]}
                          >
                            <Text style={[styles.selectedAvatarLetter, compactPinLayout && styles.selectedAvatarLetterCompact]}>
                              {(selectedMember.name || '?').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.selectedName, compactPinLayout && styles.selectedNameCompact]}>
                            {selectedMember.name}
                          </Text>
                          <Text style={[styles.selectedRole, compactPinLayout && styles.selectedRoleCompact]}>
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
                        onFocus={() => {
                          setTimeout(() => {
                            detailScrollRef.current?.scrollToEnd?.({ animated: true });
                          }, 120);
                        }}
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
                        style={[styles.input, compactPinLayout && styles.inputCompact]}
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

                        <View style={[styles.buttonRow, compactPinLayout && styles.buttonRowCompact]}>
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
                            submitting
                              ? 'Working'
                              : selectedMember.pinHash || isParentSelection
                              ? 'Unlock'
                              : 'Continue'
                          }
                          disabled={submitting}
                          style={[
                            styles.button,
                            compactPinLayout && styles.buttonCompact,
                            submitting && styles.buttonDisabled,
                            isParentSelection ? { backgroundColor: colors.accentMore } : { backgroundColor: colors.accentChores },
                          ]}
                          onPress={() => {
                            void handleMemberConfirm();
                          }}
                        >
                          <Text style={styles.buttonText}>
                            {submitting
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
  detailPanelCompact: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailKeyboardWrap: {
    flex: 1,
    minHeight: 0,
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingBottom: spacing.lg,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectedHeaderCompact: {
    gap: spacing.sm,
  },
  selectedAvatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedAvatarImageCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
  selectedAvatarFallbackCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  selectedAvatarLetter: { fontSize: 28, fontWeight: '800', color: colors.ink },
  selectedAvatarLetterCompact: { fontSize: 22 },
  selectedName: { fontSize: 19, fontWeight: '800', color: colors.ink },
  selectedNameCompact: { fontSize: 17 },
  selectedRole: { color: colors.inkMuted, marginTop: 2 },
  selectedRoleCompact: { marginTop: 1, fontSize: 12 },
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
  inputCompact: {
    paddingVertical: 10,
    fontSize: 16,
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
  buttonRowCompact: {
    gap: spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  buttonCompact: {
    minHeight: 42,
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
