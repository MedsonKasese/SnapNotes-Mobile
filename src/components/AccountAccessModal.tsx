import { useEffect, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthState } from '../auth/AuthStateProvider';
import { AuthOperationError, authService } from '../auth/authService';
import { getAuthErrorMessage } from '../auth/authErrors';
import { googleAuthService } from '../auth/googleAuthService';
import {
  normalizeDisplayName,
  normalizeEmail,
  validateEmailAddress,
  validateRegistration,
  validateSignIn,
  type AuthFieldErrors,
} from '../auth/authValidation';
import { cloudLibraryPreviewService } from '../cloudLibraryPreviewFirebase';
import { createCloudPreviewRequestGate, type CloudLibraryPreview } from '../cloudLibraryPreview';

type AccountScreen = 'welcome' | 'sign-in' | 'register' | 'password-reset' | 'account';
type Feedback = { kind: 'success' | 'warning'; message: string };
type CloudPreviewState = { status: 'idle' } | { status: 'loading'; uid: string; sessionKey: object } | { status: 'error'; uid: string; sessionKey: object; message: string } | { status: 'ready'; uid: string; sessionKey: object; preview: CloudLibraryPreview };
type AccountAccessModalProps = { visible: boolean; onClose: () => void };

type AccountFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  hideLabel?: boolean;
  error?: string;
  keyboardType?: TextInputProps['keyboardType'];
  autoComplete?: TextInputProps['autoComplete'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  secureTextEntry?: boolean;
  maxLength?: number;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
};

function AccountField({
  label,
  value,
  onChangeText,
  placeholder,
  hideLabel = false,
  error,
  keyboardType = 'default',
  autoComplete,
  autoCapitalize = 'none',
  secureTextEntry = false,
  maxLength,
  returnKeyType = 'done',
  onSubmitEditing,
}: AccountFieldProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const visibilityTarget = label === 'Confirm password' ? 'confirmation password' : label.toLowerCase();
  return (
    <View style={styles.fieldGroup}>
      {!hideLabel && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={[styles.fieldControl, secureTextEntry ? styles.passwordField : null]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor="#89948b"
          returnKeyType={returnKeyType}
          secureTextEntry={secureTextEntry && !passwordVisible}
          style={[styles.input, secureTextEntry ? styles.passwordInput : null, error ? styles.inputError : null]}
          value={value}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="togglebutton"
            accessibilityLabel={`${passwordVisible ? 'Hide' : 'Show'} ${visibilityTarget}`}
            accessibilityHint={passwordVisible ? 'Hides the password on screen' : 'Shows the password on screen'}
            accessibilityState={{ checked: passwordVisible }}
            hitSlop={8}
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={styles.passwordVisibilityButton}
          >
            <MaterialCommunityIcons name={passwordVisible ? 'eye-off' : 'eye'} size={22} color="#84d64b" accessible={false} />
          </Pressable>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text> : null}
      </View>
    </View>
  );
}

function AccountButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondaryButton : styles.primaryButton,
        (disabled || pressed) && styles.buttonDimmed,
      ]}
    >
      {loading ? <ActivityIndicator color={secondary ? '#347b0a' : '#ffffff'} /> : <Text style={[styles.buttonText, secondary ? styles.secondaryButtonText : null]}>{label}</Text>}
    </Pressable>
  );
}

function GoogleSignInButton({
  disabled,
  loading,
  onPress,
}: {
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.googleButton, (disabled || pressed) && styles.buttonDimmed]}
    >
      {loading ? <ActivityIndicator color="#202124" /> : <MaterialCommunityIcons name="google" size={20} color="#4285f4" accessible={false} />}
      <Text style={styles.googleButtonText}>{loading ? 'Opening Google…' : 'Continue with Google'}</Text>
    </Pressable>
  );
}

function safeMessage(error: unknown): string {
  return error instanceof AuthOperationError ? error.message : getAuthErrorMessage(error);
}

export function AccountAccessModal({ visible, onClose }: AccountAccessModalProps) {
  const {
    state,
    retry: retryAuthState,
    refreshVerificationStatus: refreshAuthVerificationStatus,
  } = useAuthState();
  const [screen, setScreen] = useState<AccountScreen>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [pendingDisplayName, setPendingDisplayName] = useState<string | null>(null);
  const [verificationRetryAvailable, setVerificationRetryAvailable] = useState(false);
  const [verificationCooldownMs, setVerificationCooldownMs] = useState(0);
  const googleSignInAvailable = googleAuthService.isConfigured();
  const requestInFlight = useRef(false);
  const cloudPreviewGate = useRef(createCloudPreviewRequestGate());
  const [cloudPreview, setCloudPreview] = useState<CloudPreviewState>({ status: 'idle' });
  const verifiedPreviewUid = state.status === 'signed-in' && state.user.emailVerified ? state.user.uid : null;
  const activeCloudPreview: CloudPreviewState = cloudPreview.status !== 'idle' &&
    cloudPreview.uid === verifiedPreviewUid && cloudPreview.sessionKey === state
    ? cloudPreview
    : { status: 'idle' };
  const verificationUserId =
    state.status === 'signed-in' && !state.user.emailVerified ? state.user.uid : null;

  useEffect(() => {
    cloudPreviewGate.current.setVerifiedUid(verifiedPreviewUid);
  }, [verifiedPreviewUid]);

  useEffect(() => {
    if (!visible || !verificationUserId) return;
    const updateCooldown = () => {
      setVerificationCooldownMs(authService.getVerificationResendCooldownMs());
    };
    const initialUpdate = setTimeout(updateCooldown, 0);
    const timer = setInterval(updateCooldown, 1000);
    return () => {
      clearTimeout(initialUpdate);
      clearInterval(timer);
    };
  }, [visible, verificationUserId]);

  const clearTransientState = () => {
    setScreen('welcome');
    setDisplayName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setFormError(null);
    setFeedback(null);
    setCreatedEmail(null);
    setPendingDisplayName(null);
    setVerificationRetryAvailable(false);
  };

  const close = () => {
    if (requestInFlight.current) return;
    clearTransientState();
    onClose();
  };

  const runAction = async (action: () => Promise<void>, destination: 'form' | 'account' = 'form') => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      await action();
    } catch (error) {
      const message = safeMessage(error);
      if (destination === 'account') setFeedback({ kind: 'warning', message });
      else setFormError(message);
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const submitGoogleSignIn = async () => {
    await runAction(async () => {
      const result = await googleAuthService.signIn();
      if (result.status === 'cancelled') return;
      setPassword('');
      setConfirmPassword('');
      setFieldErrors({});
      setFeedback({
        kind: 'success',
        message: 'You are signed in. Your local notes and Private Notes were not changed; nothing was uploaded.',
      });
      setScreen('account');
    });
  };

  const submitSignIn = async () => {
    const errors = validateSignIn(email, password);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    await runAction(async () => {
      await authService.signIn(email, password);
      setPassword('');
      setConfirmPassword('');
      setFieldErrors({});
      setFeedback({ kind: 'success', message: 'You are signed in. Your existing device-local notes were not changed.' });
      setScreen('account');
    });
  };

  const submitPasswordReset = async () => {
    const emailError = validateEmailAddress(email);
    const errors: AuthFieldErrors = emailError ? { email: emailError } : {};
    setFieldErrors(errors);
    setFormError(null);
    setFeedback(null);
    if (Object.keys(errors).length > 0) return;
    await runAction(async () => {
      const result = await authService.requestPasswordReset(email);
      setFeedback({ kind: 'success', message: result.message });
    });
  };

  const submitRegistration = async () => {
    const errors = validateRegistration(displayName, email, password, confirmPassword);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    await runAction(async () => {
      const result = await authService.register(displayName, email, password);
      const cleanEmail = normalizeEmail(email);
      const cleanName = normalizeDisplayName(displayName);
      setCreatedEmail(result.email);
      setPendingDisplayName(result.displayNameUpdated ? null : cleanName);
      setVerificationRetryAvailable(!result.verificationEmailSent);
      setPassword('');
      setConfirmPassword('');
      setFieldErrors({});
      if (result.displayNameUpdated && result.verificationEmailSent) {
        setFeedback({
          kind: 'success',
          message: `Your account was created and a verification email was sent to ${result.email || cleanEmail}. You can continue using local notes without verifying first.`,
        });
      } else {
        const followUps: string[] = [];
        if (!result.displayNameUpdated) followUps.push('the display name was not saved');
        if (!result.verificationEmailSent) followUps.push('the verification email could not be sent');
        setFeedback({
          kind: 'warning',
          message: `Your account was created, but ${followUps.join(' and ')}. Do not create another account; retry the unfinished step below. Your local notes remain available.`,
        });
      }
      setScreen('account');
    });
  };

  const retryDisplayName = async () => {
    if (!pendingDisplayName) return;
    await runAction(async () => {
      await authService.retryRegistrationDisplayName(pendingDisplayName);
      setPendingDisplayName(null);
      setFeedback({ kind: 'success', message: 'Your account name was saved. Your local notes were not changed.' });
    }, 'account');
  };

  const retryVerificationEmail = async () => {
    await runAction(async () => {
      await authService.resendVerificationEmail();
      setVerificationRetryAvailable(false);
      setFeedback({ kind: 'success', message: 'Verification email sent. Use the newest email link; older or expired links may not work. Your local notes remain available.' });
    }, 'account');
  };

  const refreshVerification = async () => {
    await runAction(async () => {
      const emailVerified = await refreshAuthVerificationStatus();
      if (emailVerified === null) {
        setFeedback({
          kind: 'warning',
          message: 'The account session changed while status was refreshing. Check the current account status again. Your local notes remain available.',
        });
        return;
      }
      setFeedback({
        kind: 'success',
        message: emailVerified
          ? 'Email verified. Your local notes and Private Notes remain on this device; no sync occurred.'
          : 'Verification is still pending. If the link was invalid or expired, request a new email and open the latest link. Your local notes remain available.',
      });
    }, 'account');
  };

  const handleSignOut = async () => {
    await runAction(async () => {
      await authService.signOut();
      clearTransientState();
    }, 'account');
  };

  const loadCloudPreview = async () => {
    if (state.status !== 'signed-in' || !state.user.emailVerified) return;
    const uid = state.user.uid;
    cloudPreviewGate.current.setVerifiedUid(uid);
    const requestId = cloudPreviewGate.current.begin(uid);
    if (requestId === null) return;
    setCloudPreview({ status: 'loading', uid, sessionKey: state });
    try {
      const preview = await cloudLibraryPreviewService.load(uid);
      if (!cloudPreviewGate.current.isCurrent(uid, requestId)) return;
      setCloudPreview({ status: 'ready', uid, sessionKey: state, preview });
    } catch {
      if (!cloudPreviewGate.current.isCurrent(uid, requestId)) return;
      setCloudPreview({ status: 'error', uid, sessionKey: state, message: 'Could not load the cloud preview. It is not being treated as an empty library; try again when the connection is available.' });
    }
  };

  const accountView = state.status === 'signed-in' || screen === 'account';
  const accountDisplayName = state.status === 'signed-in'
    ? state.user.displayName?.trim() || state.user.email?.split('@')[0] || 'SnapNotes user'
    : null;
  const accountInitials = state.status === 'signed-in'
    ? (state.user.displayName || state.user.email || 'U').trim().split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U'
    : 'U';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.modalRoot}>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>S</Text></View>
            <View style={styles.headerCopy}>
              <Text style={styles.brand}>SnapNotes</Text>
              <Text style={styles.headerSubtitle}>Optional account</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account screen"
              disabled={busy}
              onPress={close}
              style={({ pressed }) => [styles.closeButton, (pressed || busy) && styles.buttonDimmed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {accountView ? (
              <View style={styles.panel}>
                <Text accessibilityRole="header" style={styles.title}>Account</Text>
                {state.status === 'signed-in' ? (
                  <>
                    <View accessibilityLabel={`Account profile for ${accountDisplayName}`} style={styles.accountSummary}>
                      <View style={styles.accountAvatar}>
                        <Text style={styles.accountAvatarText}>{accountInitials}</Text>
                      </View>
                      <View style={styles.accountDetails}>
                        <Text numberOfLines={1} style={styles.accountDisplayName}>{accountDisplayName}</Text>
                        {state.user.email ? <Text numberOfLines={1} style={styles.accountEmail}>{state.user.email}</Text> : null}
                        <Text style={styles.accountProvider}>Signed-in account</Text>
                      </View>
                    </View>
                    <View style={[styles.statusPill, state.user.emailVerified ? styles.statusVerified : styles.statusUnverified]}>
                      <Text style={[styles.statusText, state.user.emailVerified ? styles.statusTextVerified : null]}>
                        {state.user.emailVerified ? 'Email verified' : 'Verification pending'}
                      </Text>
                    </View>
                    {!state.user.emailVerified && (
                      <Text style={styles.bodyText}>
                        Your local notes stay available while you verify. Refresh after opening the email link; if a link is invalid or expired, request a new email and use the latest link. Verification never moves notes or changes Private Notes.
                      </Text>
                    )}
                    {!state.user.emailVerified && (
                      <View style={styles.buttonStack}>
                        <AccountButton label={busy ? 'Refreshing…' : 'Refresh verification status'} loading={busy} disabled={busy} secondary onPress={() => { void refreshVerification(); }} />
                        <AccountButton
                          label={busy ? 'Sending…' : verificationCooldownMs > 0 ? `Resend verification email in ${Math.ceil(verificationCooldownMs / 1000)}s` : 'Resend verification email'}
                          loading={busy}
                          disabled={busy || verificationCooldownMs > 0}
                          onPress={() => { void retryVerificationEmail(); }}
                        />
                      </View>
                    )}
                    {state.user.emailVerified && (
                      <View style={styles.cloudPreviewPanel}>
                        <Text style={styles.cloudPreviewTitle}>Read-only PWA cloud preview</Text>
                        <Text style={styles.bodyText}>Load your signed-in account library only when you choose. This preview never syncs, imports, decrypts, or changes device notes. Private Notes are excluded.</Text>
                        <AccountButton
                          label={activeCloudPreview.status === 'loading' ? 'Loading cloud preview…' : activeCloudPreview.status === 'ready' ? 'Refresh read-only preview' : 'Preview cloud library (read-only)'}
                          loading={activeCloudPreview.status === 'loading'}
                          disabled={activeCloudPreview.status === 'loading' || busy}
                          secondary
                          onPress={() => { void loadCloudPreview(); }}
                        />
                        {activeCloudPreview.status === 'error' && <Text accessibilityRole="alert" style={styles.warning}>{activeCloudPreview.message}</Text>}
                        {activeCloudPreview.status === 'ready' && (
                          <View style={styles.cloudPreviewResults}>
                            <Text style={styles.hint}>Loaded read-only · {activeCloudPreview.preview.notes.length} notes · {activeCloudPreview.preview.folders.length} folders · {activeCloudPreview.preview.pageCount} cloud pages</Text>
                            {activeCloudPreview.preview.notes.map((note, index) => {
                              const title = typeof note.fields.title === 'string' ? note.fields.title : 'Untitled note';
                              const text = typeof note.fields.text === 'string' ? note.fields.text : '';
                              return (
                                <View key={`${String(note.fields.id)}-${index}`} style={styles.cloudPreviewNote}>
                                  <Text style={styles.cloudPreviewNoteTitle}>{title || 'Untitled note'}</Text>
                                  {text ? <Text numberOfLines={3} style={styles.cloudPreviewNoteText}>{text}</Text> : null}
                                  {note.unsupportedFields.length > 0 && <Text style={styles.cloudPreviewUnsupported}>Unsupported PWA fields: {note.unsupportedFields.join(', ')}</Text>}
                                </View>
                              );
                            })}
                            {activeCloudPreview.preview.folders.length > 0 && (
                              <Text style={styles.cloudPreviewNoteText}>Folders: {activeCloudPreview.preview.folders.map((folder) => folder.name).join(', ')}</Text>
                            )}
                            <Text style={styles.cloudPreviewFootnote}>Preview only; nothing was imported or written back. Unsupported PWA fields (including attachment fields) are listed by name only.</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.bodyText}>
                      {createdEmail
                        ? `Your account was created for ${createdEmail}. The app has not confirmed the session yet; do not submit registration again.`
                        : 'The account session could not be confirmed. Your notes workspace remains available.'}
                    </Text>
                    {state.status === 'initializing' && <Text accessibilityLiveRegion="polite" style={styles.hint}>Checking account status…</Text>}
                    {state.status === 'unavailable' && <AccountButton label="Retry account status" secondary onPress={retryAuthState} />}
                    {state.status === 'signed-out' && <AccountButton label="Back to account options" secondary onPress={() => { setScreen('welcome'); setFeedback(null); }} />}
                  </>
                )}

                {feedback && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={feedback.kind === 'success' ? styles.success : styles.warning}>{feedback.message}</Text>}
                {pendingDisplayName !== null && <AccountButton label={busy ? 'Saving name…' : 'Retry saving account name'} loading={busy} disabled={busy} onPress={() => { void retryDisplayName(); }} />}
                {verificationRetryAvailable && state.status !== 'signed-in' && <AccountButton label={busy ? 'Sending…' : 'Retry verification email'} loading={busy} disabled={busy} secondary onPress={() => { void retryVerificationEmail(); }} />}
                <View style={styles.buttonStack}>
                  {state.status === 'signed-in' && <AccountButton label={busy ? 'Signing out…' : 'Sign out'} loading={busy} disabled={busy} secondary onPress={() => { void handleSignOut(); }} />}
                  <AccountButton label="Back to notes" secondary disabled={busy} onPress={close} />
                </View>
              </View>
            ) : screen === 'welcome' ? (
              <View style={styles.panel}>
                <Text style={styles.eyebrow}>YOUR NOTES, YOUR CHOICE</Text>
                <Text accessibilityRole="header" style={styles.title}>Use SnapNotes without an account.</Text>
                <Text style={styles.bodyText}>
                  Signing in adds your Firebase account identity only. It does not upload, merge, or move notes from this device, and it does not unlock Private Notes.
                </Text>
                <View style={styles.accountSummary}>
                  <View style={styles.accountAvatar}>
                    <MaterialCommunityIcons name="account-outline" size={23} color="#ffffff" accessible={false} />
                  </View>
                  <View style={styles.accountDetails}>
                    <Text style={styles.accountDisplayName}>Local mode</Text>
                    <Text style={styles.accountEmail}>Your notes are stored on this device</Text>
                  </View>
                </View>
                {state.status === 'initializing' && <Text accessibilityLiveRegion="polite" style={styles.hint}>Checking for a saved account session…</Text>}
                {state.status === 'unavailable' && (
                  <View style={styles.inlineStatus}>
                    <Text style={styles.hint}>Account status is unavailable; local notes still work.</Text>
                    <AccountButton label="Retry account status" secondary onPress={retryAuthState} />
                  </View>
                )}
                {formError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>{formError}</Text>}
                <View style={styles.buttonStack}>
                  {googleSignInAvailable ? (
                    <GoogleSignInButton disabled={busy} loading={busy} onPress={() => { void submitGoogleSignIn(); }} />
                  ) : (
                    <Text style={styles.hint}>Google sign-in is not configured for this build yet. Email sign-in and local notes remain available.</Text>
                  )}
                  <AccountButton label="Sign in" onPress={() => { setFormError(null); setFieldErrors({}); setScreen('sign-in'); }} />
                  <AccountButton label="Create account" secondary onPress={() => { setFormError(null); setFieldErrors({}); setScreen('register'); }} />
                  <AccountButton label="Back to notes" secondary onPress={close} />
                </View>
              </View>
            ) : screen === 'sign-in' ? (
              <View style={styles.panel}>
                <Text style={styles.eyebrow}>SNAPNOTES ACCOUNT</Text>
                <Text accessibilityRole="header" style={styles.title}>Sign in to SnapNotes</Text>
                <Text style={styles.bodyText}>Your device-local notes remain available and are not changed by signing in.</Text>
                <AccountField
                  label="Email"
                  hideLabel
                  value={email}
                  onChangeText={(value) => { setEmail(value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
                  placeholder="Email"
                  keyboardType="email-address"
                  autoComplete="email"
                  error={fieldErrors.email}
                  returnKeyType="next"
                />
                <AccountField
                  label="Password"
                  hideLabel
                  value={password}
                  onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
                  placeholder="Password"
                  secureTextEntry
                  autoComplete="current-password"
                  error={fieldErrors.password}
                  returnKeyType="go"
                  onSubmitEditing={() => { void submitSignIn(); }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => { setFormError(null); setFieldErrors({}); setFeedback(null); setScreen('password-reset'); }}
                  style={({ pressed }) => [styles.forgotPasswordLink, (pressed || busy) && styles.buttonDimmed]}
                >
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </Pressable>
                {formError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>{formError}</Text>}
                <View style={styles.buttonStack}>
                  {googleSignInAvailable ? (
                    <GoogleSignInButton disabled={busy} loading={busy} onPress={() => { void submitGoogleSignIn(); }} />
                  ) : (
                    <Text style={styles.hint}>Google sign-in is not configured for this build yet. Email sign-in and local notes remain available.</Text>
                  )}
                  <AccountButton label={busy ? 'Signing in…' : 'Sign In'} loading={busy} disabled={busy} onPress={() => { void submitSignIn(); }} />
                  <AccountButton label="Create Account" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setScreen('register'); }} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={close}
                    style={({ pressed }) => [styles.cancelButton, (pressed || busy) && styles.buttonDimmed]}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : screen === 'password-reset' ? (
              <View style={styles.panel}>
                <Text style={styles.eyebrow}>ACCOUNT RECOVERY</Text>
                <Text accessibilityRole="header" style={styles.title}>Reset password</Text>
                <Text style={styles.bodyText}>Enter your email address. The response will not reveal whether an account exists for it.</Text>
                <AccountField
                  label="Email"
                  value={email}
                  onChangeText={(value) => { setEmail(value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoComplete="email"
                  error={fieldErrors.email}
                  returnKeyType="go"
                  onSubmitEditing={() => { void submitPasswordReset(); }}
                />
                {formError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>{formError}</Text>}
                {feedback && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.success}>{feedback.message}</Text>}
                <View style={styles.buttonStack}>
                  <AccountButton label={busy ? 'Requesting…' : 'Send reset instructions'} loading={busy} disabled={busy} onPress={() => { void submitPasswordReset(); }} />
                  <AccountButton label="Back to sign in" secondary disabled={busy} onPress={() => { setFormError(null); setFeedback(null); setScreen('sign-in'); }} />
                </View>
              </View>
            ) : (
              <View style={styles.panel}>
                <Text style={styles.eyebrow}>START WITH AN ACCOUNT</Text>
                <Text accessibilityRole="header" style={styles.title}>Create account</Text>
                <Text style={styles.bodyText}>An account does not migrate or sync your existing local notes.</Text>
                <AccountField
                  label="Name"
                  value={displayName}
                  onChangeText={(value) => { setDisplayName(value); setFieldErrors((current) => ({ ...current, displayName: undefined })); }}
                  placeholder="Your name"
                  autoCapitalize="words"
                  autoComplete="name"
                  maxLength={80}
                  error={fieldErrors.displayName}
                  returnKeyType="next"
                />
                <AccountField
                  label="Email"
                  value={email}
                  onChangeText={(value) => { setEmail(value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoComplete="email"
                  error={fieldErrors.email}
                  returnKeyType="next"
                />
                <AccountField
                  label="Password"
                  value={password}
                  onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
                  placeholder="At least 6 characters"
                  secureTextEntry
                  autoComplete="new-password"
                  error={fieldErrors.password}
                  returnKeyType="next"
                />
                <AccountField
                  label="Confirm password"
                  value={confirmPassword}
                  onChangeText={(value) => { setConfirmPassword(value); setFieldErrors((current) => ({ ...current, confirmPassword: undefined })); }}
                  placeholder="Enter the same password again"
                  secureTextEntry
                  autoComplete="new-password"
                  error={fieldErrors.confirmPassword}
                  returnKeyType="go"
                  onSubmitEditing={() => { void submitRegistration(); }}
                />
                {formError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>{formError}</Text>}
                <View style={styles.buttonStack}>
                  <AccountButton label={busy ? 'Creating account…' : 'Create account'} loading={busy} disabled={busy} onPress={() => { void submitRegistration(); }} />
                  <AccountButton label="Back to sign in" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setScreen('sign-in'); }} />
                  <AccountButton label="Back" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setScreen('welcome'); }} />
                </View>
              </View>
            )}

            <Text style={styles.localFirstNote}>
              Local notes remain on this device whether you sign in, sign out, or stay offline. Private Notes keeps its separate vault unlock.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, backgroundColor: '#0b0f0b' },
  keyboard: { flex: 1 },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#0b0f0b', borderBottomWidth: 1, borderBottomColor: '#202820' },
  brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#65c52b' },
  brandMarkText: { color: '#ffffff', fontSize: 23, fontWeight: '900' },
  headerCopy: { flex: 1 },
  brand: { color: '#f0f4ef', fontSize: 17, fontWeight: '800' },
  headerSubtitle: { color: '#a5afa6', fontSize: 12, marginTop: 2 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#202820' },
  closeText: { color: '#d8e0d8', fontSize: 28, lineHeight: 31 },
  content: { flexGrow: 1, padding: 18, paddingBottom: 34, gap: 14 },
  panel: { padding: 22, borderRadius: 26, backgroundColor: '#171d17', borderWidth: 1, borderColor: '#252f27', gap: 16 },
  eyebrow: { color: '#74cf37', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#f1f5f1', fontSize: 28, lineHeight: 35, fontWeight: '800', letterSpacing: -0.5 },
  bodyText: { color: '#bbc5bc', fontSize: 14, lineHeight: 21 },
  fieldGroup: { gap: 6 },
  fieldControl: { gap: 6 },
  fieldLabel: { color: '#e0e7e0', fontSize: 14, fontWeight: '700' },
  input: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1, borderColor: '#374239', borderRadius: 14, backgroundColor: '#202820', color: '#f1f5f1', fontSize: 17 },
  passwordField: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  passwordVisibilityButton: { position: 'absolute', right: 2, top: 1, bottom: 1, width: 46, alignItems: 'center', justifyContent: 'center' },
  inputError: { borderColor: '#b3261e' },
  fieldError: { color: '#b3261e', fontSize: 12, lineHeight: 17 },
  formError: { color: '#ff827a', fontSize: 13, lineHeight: 19 },
  success: { color: '#a4e180', fontSize: 13, lineHeight: 20, padding: 12, borderRadius: 10, backgroundColor: '#1c2d1b' },
  warning: { color: '#f2d078', fontSize: 13, lineHeight: 20, padding: 12, borderRadius: 10, backgroundColor: '#302916', borderWidth: 1, borderColor: '#594a25' },
  hint: { color: '#a5afa6', fontSize: 13, lineHeight: 19 },
  buttonStack: { gap: 11, marginTop: 3 },
  googleButton: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, backgroundColor: '#f8f9fa' },
  googleButtonText: { color: '#202124', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  button: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: '#65c52b' },
  secondaryButton: { backgroundColor: '#202820', borderWidth: 1, borderColor: '#374239' },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  secondaryButtonText: { color: '#f0f4ef' },
  buttonDimmed: { opacity: 0.62 },
  forgotPasswordLink: { alignSelf: 'flex-end', paddingVertical: 4 },
  forgotPasswordText: { color: '#74cf37', fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  cancelButtonText: { color: '#f05a63', fontSize: 17, fontWeight: '800' },
  accountSummary: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderWidth: 1, borderColor: '#374239', borderRadius: 12, backgroundColor: '#202820' },
  accountAvatar: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#65c52b' },
  accountAvatarText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  accountDetails: { minWidth: 0, flex: 1, gap: 2 },
  accountDisplayName: { color: '#f0f4ef', fontSize: 14, fontWeight: '800' },
  accountEmail: { color: '#a5afa6', fontSize: 12, fontWeight: '400' },
  accountProvider: { color: '#84d64b', fontSize: 11, fontWeight: '800' },
  cloudPreviewPanel: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#111711', borderWidth: 1, borderColor: '#374239' },
  cloudPreviewTitle: { color: '#f0f4ef', fontSize: 15, fontWeight: '800' },
  cloudPreviewResults: { gap: 10 },
  cloudPreviewNote: { gap: 5, padding: 11, borderRadius: 10, backgroundColor: '#202820' },
  cloudPreviewNoteTitle: { color: '#f0f4ef', fontSize: 14, fontWeight: '700' },
  cloudPreviewNoteText: { color: '#bbc5bc', fontSize: 13, lineHeight: 18 },
  cloudPreviewUnsupported: { color: '#f2d078', fontSize: 12, lineHeight: 17 },
  cloudPreviewFootnote: { color: '#a5afa6', fontSize: 11, lineHeight: 16 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16 },
  statusVerified: { backgroundColor: '#1c2d1b' },
  statusUnverified: { backgroundColor: '#302916' },
  statusText: { color: '#f2d078', fontSize: 12, fontWeight: '800' },
  statusTextVerified: { color: '#a4e180' },
  inlineStatus: { gap: 8 },
  localFirstNote: { color: '#a5afa6', fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
});
