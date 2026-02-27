import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { ScreenScaffold, PlaceholderCard } from '../src/components/ScreenScaffold';
import { colors, radii, spacing } from '../src/theme/tokens';
import { useAppSession } from '../src/providers/AppProviders';
import { hashPinClient } from '../src/lib/pin-hash';
import { getApiBaseUrl } from '../src/lib/api-client';
import { clearPendingParentAction, getPendingParentAction } from '../src/lib/session-prefs';

const PIN_PAD_LAYOUT = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'delete'],
];

const MAX_PIN_LENGTH = 6;

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
  const [pendingParentAction, setPendingParentActionState] = useState(null);
  const [pendingParentActionLoaded, setPendingParentActionLoaded] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState('');
  const hardwarePinInputRef = useRef(null);
  const rootNavigationState = useRootNavigationState();
  const navigationReady = Boolean(rootNavigationState?.key);

  const selectedMember = useMemo(
    () => familyMembers.find((member) => member.id === selectedMemberId) || null,
    [familyMembers, selectedMemberId]
  );

  const isParentSelection = selectedMember?.role === 'parent';
  const parentPinCanBeSkipped =
    isParentSelection && canUseCachedParentPrincipal && principalType === 'parent';
  const isDetailMode = !!selectedMember;
  const pinEntryRequired = isParentSelection || Boolean(selectedMember?.pinHash);
  const pinSlots = Math.max(4, Math.min(MAX_PIN_LENGTH, Math.max(pin.length, 4)));

  const focusHardwarePinInput = useCallback(() => {
    if (!selectedMember) return;
    hardwarePinInputRef.current?.focus?.();
  }, [selectedMember]);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingAction() {
      const pending = await getPendingParentAction();
      if (!cancelled) {
        setPendingParentActionState(pending);
        setPendingParentActionLoaded(true);
      }
    }

    void loadPendingAction();
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingRedirect = activationRequired
    ? '/activate'
    : redirectTarget && pendingParentActionLoaded && isAuthenticated
    ? redirectTarget
    : isAuthenticated && pendingParentActionLoaded && !pendingParentAction
    ? '/chores'
    : '';

  useEffect(() => {
    if (!pendingRedirect || !navigationReady) return;
    router.replace(pendingRedirect);
  }, [navigationReady, pendingRedirect]);

  useEffect(() => {
    if (!selectedMember) return undefined;

    const focusTimer = setTimeout(() => {
      focusHardwarePinInput();
    }, 40);

    return () => {
      clearTimeout(focusTimer);
    };
  }, [focusHardwarePinInput, selectedMember]);

  if (pendingRedirect) {
    return (
      <ScreenScaffold
        title="Preparing the app"
        subtitle="Finishing the navigation handoff before we continue."
        accent={colors.accentMore}
        headerMode="compact"
      >
        <View style={styles.centerPanel}>
          <ActivityIndicator size="large" color={colors.accentMore} />
          <Text style={styles.centerTitle}>Almost there</Text>
          <Text style={styles.centerText}>Waiting for navigation to finish initializing.</Text>
        </View>
      </ScreenScaffold>
    );
  }

  async function handleCancelPendingParentAction() {
    const returnPath = pendingParentAction?.returnPath || '/chores';
    await clearPendingParentAction();
    setPendingParentActionState(null);
    setPendingParentActionLoaded(true);
    setSelectedMemberId(null);
    setPin('');
    setError('');
    setRedirectTarget('');
    router.replace(returnPath);
  }

  function appendPinDigit(digit) {
    if (!pinEntryRequired || submitting) return;
    setError('');
    setPin((current) => {
      if (current.length >= MAX_PIN_LENGTH) return current;
      return `${current}${digit}`;
    });
  }

  function clearPin() {
    if (!pinEntryRequired || submitting) return;
    setError('');
    setPin('');
  }

  function deletePinDigit() {
    if (!pinEntryRequired || submitting) return;
    setError('');
    setPin((current) => current.slice(0, -1));
  }

  function handleBackAction() {
    if (pendingParentAction) {
      void handleCancelPendingParentAction();
      return;
    }

    setSelectedMemberId(null);
    setPin('');
    setError('');
  }

  function handleHardwareInputChange(nextValue) {
    if (!pinEntryRequired || submitting) return;

    const digitsOnly = String(nextValue || '')
      .replace(/\D+/g, '')
      .slice(0, MAX_PIN_LENGTH);

    setError('');
    setPin(digitsOnly);
  }

  function handleHardwareKeyPress(event) {
    if (!selectedMember || submitting) return;

    const key = event?.nativeEvent?.key;
    if (!key) return;

    if (/^\d$/.test(key)) {
      appendPinDigit(key);
      return;
    }

    if (key === 'Backspace') {
      deletePinDigit();
      return;
    }

    if (key === 'Enter' || key === 'Return') {
      void handleMemberConfirm();
      return;
    }

    if (key === 'Escape') {
      handleBackAction();
    }
  }

  async function handleMemberConfirm() {
    if (!selectedMember) return;
    if (submitting) return;

    setSubmitting(true);
    setError('');

    try {
      if (pendingParentAction && selectedMember.role !== 'parent') {
        throw new Error('Parent login is required to continue this action. Choose a parent member or press Cancel.');
      }

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
        if (pendingParentAction) {
          const targetPath = pendingParentAction.returnPath || '/chores';
          const resumeUrl = `${targetPath}?resumeParentAction=1&resumeActionId=${encodeURIComponent(
            pendingParentAction.actionId
          )}&resumeNonce=${Date.now()}`;
          setRedirectTarget(resumeUrl);
          return;
        }

        setRedirectTarget('/chores');
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
      setRedirectTarget('/chores');
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
      ? pendingParentAction?.actionLabel
        ? `Parent login is required to continue: ${pendingParentAction.actionLabel}`
        : 'Choose a family member to continue. Parent mode requires elevation and auto-demotes when shared-device mode is on.'
      : 'Connecting to family data…'
    : isParentSelection
    ? 'Enter parent PIN to unlock parent mode on this shared device.'
    : selectedMember.pinHash
    ? 'Enter PIN to continue.'
    : 'No PIN set for this member.';

  const headerStatusChips = [
    { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
    {
      label: principalType === 'parent' ? 'Parent mode' : principalType === 'kid' ? 'Kid mode' : 'No mode',
      tone: principalType === 'parent' ? 'accent' : 'neutral',
    },
  ];

  return (
    <ScreenScaffold
      title={lockTitle}
      subtitle={lockSubtitle}
      accent={accent}
      statusChips={headerStatusChips}
      headerMode="compact"
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
                  {pendingParentAction ? (
                    <View style={styles.pendingActionCard}>
                      <Text style={styles.pendingActionTitle}>Parent login required</Text>
                      <Text style={styles.pendingActionBody}>
                        {pendingParentAction.actionLabel
                          ? `Continue by logging in as a parent to run: ${pendingParentAction.actionLabel}.`
                          : 'Log in as a parent to continue this action.'}
                      </Text>
                      <Pressable
                        testID="lock-cancel-parent-action"
                        accessibilityRole="button"
                        accessibilityLabel="Cancel and return to previous screen"
                        style={styles.pendingCancelButton}
                        onPress={() => {
                          void handleCancelPendingParentAction();
                        }}
                      >
                        <Text style={styles.pendingCancelText}>Cancel and go back</Text>
                      </Pressable>
                    </View>
                  ) : null}

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
                <View style={styles.detailFill}>
                  <View
                    style={[styles.detailPanel, styles.detailPanelExpanded]}
                    onTouchStart={focusHardwarePinInput}
                  >
                    <TextInput
                      ref={hardwarePinInputRef}
                      value={pinEntryRequired ? pin : ''}
                      onChangeText={handleHardwareInputChange}
                      onKeyPress={handleHardwareKeyPress}
                      onSubmitEditing={() => {
                        void handleMemberConfirm();
                      }}
                      autoFocus
                      blurOnSubmit={false}
                      caretHidden
                      contextMenuHidden
                      keyboardType="number-pad"
                      returnKeyType="go"
                      showSoftInputOnFocus={false}
                      style={styles.hardwarePinInput}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                    <View style={styles.selectedHeader}>
                        {avatarUriForMember(selectedMember) ? (
                          <Image
                            source={{ uri: avatarUriForMember(selectedMember) }}
                            style={styles.selectedAvatarImage}
                          />
                        ) : (
                          <View
                            style={[
                              styles.selectedAvatarFallback,
                              { backgroundColor: '#EBDCC5' },
                            ]}
                          >
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
                        {isParentSelection ? (
                          <View style={styles.sharedModeNotice}>
                            <View style={styles.sharedModeHeader}>
                              <Text style={styles.sharedModeNoticeTitle}>Shared device mode</Text>
                              <Switch
                                testID="parent-shared-device-switch"
                                accessibilityLabel="Shared device mode"
                                value={parentSharedDevice}
                                onValueChange={setParentSharedDevice}
                                thumbColor="#fff"
                                trackColor={{ false: '#BFC9D6', true: colors.accentMore }}
                              />
                            </View>
                            <Text style={styles.sharedModeNoticeBody}>
                              Parent access auto-demotes after inactivity when this switch is enabled.
                            </Text>
                          </View>
                        ) : null}
                    </View>

                    <View style={styles.detailBody}>
                      <View style={styles.pinSection}>
                        <Text style={styles.label}>
                          {isParentSelection
                            ? parentPinCanBeSkipped
                              ? 'PIN (optional)'
                              : 'Parent PIN'
                            : selectedMember.pinHash
                            ? 'PIN'
                            : 'No PIN required'}
                        </Text>

                        <View
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
                          style={[styles.pinDisplay, !pinEntryRequired && styles.pinDisplayPassive]}
                        >
                          {pinEntryRequired ? (
                            <>
                              <View style={styles.pinDotsRow}>
                                {Array.from({ length: pinSlots }).map((_, index) => {
                                  const filled = index < pin.length;
                                  return (
                                    <View
                                      key={`pin-dot-${index}`}
                                      style={[styles.pinDot, filled && styles.pinDotFilled]}
                                    />
                                  );
                                })}
                              </View>
                              <Text style={styles.pinHelperText}>
                                {pin.length > 0
                                  ? `${pin.length} digit${pin.length === 1 ? '' : 's'} entered`
                                  : parentPinCanBeSkipped
                                  ? 'Parent PIN can be skipped on this device'
                                  : 'Use the number pad below'}
                              </Text>
                            </>
                          ) : (
                            <Text style={styles.pinHelperText}>No PIN is set for this member. Press Continue.</Text>
                          )}
                        </View>

                        {pinEntryRequired ? (
                          <View style={styles.pinPad}>
                            {PIN_PAD_LAYOUT.map((row, rowIndex) => (
                              <View key={`pin-row-${rowIndex}`} style={styles.pinPadRow}>
                                {row.map((value) => {
                                  if (value === 'clear') {
                                    return (
                                      <Pressable
                                        key="clear"
                                        testID="pin-key-clear"
                                        accessibilityRole="button"
                                        accessibilityLabel="Clear PIN"
                                        style={[styles.pinKey, styles.pinKeyUtility]}
                                        onPress={clearPin}
                                      >
                                        <Text style={[styles.pinKeyText, styles.pinKeyTextUtility]}>Clear</Text>
                                      </Pressable>
                                    );
                                  }

                                  if (value === 'delete') {
                                    return (
                                      <Pressable
                                        key="delete"
                                        testID="pin-key-delete"
                                        accessibilityRole="button"
                                        accessibilityLabel="Delete PIN digit"
                                        style={[styles.pinKey, styles.pinKeyUtility]}
                                        onPress={deletePinDigit}
                                      >
                                        <Text style={[styles.pinKeyText, styles.pinKeyTextUtility]}>Delete</Text>
                                      </Pressable>
                                    );
                                  }

                                  return (
                                    <Pressable
                                      key={value}
                                      testID={`pin-key-${value}`}
                                      accessibilityRole="button"
                                      accessibilityLabel={`PIN digit ${value}`}
                                      style={styles.pinKey}
                                      onPress={() => appendPinDigit(value)}
                                    >
                                      <Text style={styles.pinKeyText}>{value}</Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>

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
                          accessibilityLabel={
                            pendingParentAction
                              ? 'Cancel parent login and return to previous screen'
                              : 'Back to family member list'
                          }
                          style={[styles.secondaryButton, styles.backButton]}
                          hitSlop={10}
                          onPress={handleBackAction}
                        >
                          <Text style={styles.secondaryButtonText}>{pendingParentAction ? 'Cancel' : 'Back'}</Text>
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
                            submitting && styles.buttonDisabled,
                            isParentSelection ? { backgroundColor: colors.accentMore } : { backgroundColor: colors.accentChores },
                          ]}
                          hitSlop={10}
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
                  </View>
                </View>
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
  pendingActionCard: {
    backgroundColor: '#FFF5E9',
    borderWidth: 1,
    borderColor: '#EAC8A4',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  pendingActionTitle: {
    color: '#8B4D17',
    fontWeight: '800',
    fontSize: 14,
  },
  pendingActionBody: {
    color: '#805736',
    lineHeight: 18,
    fontSize: 12,
  },
  pendingCancelButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#DCA878',
    borderRadius: radii.pill,
    backgroundColor: '#FFF9F1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
  },
  pendingCancelText: {
    color: '#8B4D17',
    fontWeight: '700',
    fontSize: 12,
  },
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
  detailPanelExpanded: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  hardwarePinInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  detailFill: {
    flex: 1,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectedAvatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedAvatarLetter: { fontSize: 22, fontWeight: '800', color: colors.ink },
  selectedName: { fontSize: 17, fontWeight: '800', color: colors.ink },
  selectedRole: { color: colors.inkMuted, marginTop: 2 },
  sharedModeNotice: {
    width: 170,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: '#FFF9F2',
    padding: spacing.sm,
    gap: 4,
    alignSelf: 'stretch',
  },
  sharedModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sharedModeNoticeTitle: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12,
    flex: 1,
  },
  sharedModeNoticeBody: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  detailBody: {
    gap: spacing.md,
  },
  pinSection: {
    gap: spacing.sm,
  },
  label: { fontWeight: '700', color: colors.ink },
  pinDisplay: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: '#fff',
    gap: spacing.sm,
  },
  pinDisplayPassive: {
    minHeight: 72,
    justifyContent: 'center',
  },
  pinDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#F7F1E7',
  },
  pinDotFilled: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  pinHelperText: {
    color: colors.inkMuted,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
  pinPad: {
    gap: spacing.sm,
  },
  pinPadRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pinKey: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinKeyUtility: {
    backgroundColor: '#FBF6EB',
  },
  pinKeyText: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 20,
  },
  pinKeyTextUtility: {
    fontSize: 14,
  },
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
