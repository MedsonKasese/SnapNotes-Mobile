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
import {
  normalizeDisplayName,
  normalizeEmail,
  validateEmailAddress,
  validateRegistration,
  validateSignIn,
  type AuthFieldErrors,
} from '../auth/authValidation';

type AccountScreen = 'welcome' | 'sign-in' | 'register' | 'password-reset' | 'account';
type Feedback = { kind: 'success' | 'warning'; message: string };
type AccountAccessModalProps = { visible: boolean; onClose: () => void };

type AccountFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
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
      <Text style={styles.fieldLabel}>{label}</Text>
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
          placeholderTextColor="#71806b"
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
            <MaterialCommunityIcons name={passwordVisible ? 'eye-off' : 'eye'} size={22} color="#3b7f16" accessible={false} />
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
  const requestInFlight = useRef(false);
  const verificationUserId =
    state.status === 'signed-in' && !state.user.emailVerified ? state.user.uid : null;

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

  const accountView = state.status === 'signed-in' || screen === 'account';

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
                    <Text style={styles.accountEmail}>{state.user.email ?? 'Signed-in Firebase account'}</Text>
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
                {state.status === 'initializing' && <Text accessibilityLiveRegion="polite" style={styles.hint}>Checking for a saved account session…</Text>}
                {state.status === 'unavailable' && (
                  <View style={styles.inlineStatus}>
                    <Text style={styles.hint}>Account status is unavailable; local notes still work.</Text>
                    <AccountButton label="Retry account status" secondary onPress={retryAuthState} />
                  </View>
                )}
                <View style={styles.buttonStack}>
                  <AccountButton label="Sign in" onPress={() => { setFormError(null); setFieldErrors({}); setScreen('sign-in'); }} />
                  <AccountButton label="Create account" secondary onPress={() => { setFormError(null); setFieldErrors({}); setScreen('register'); }} />
                  <AccountButton label="Back to notes" secondary onPress={close} />
                </View>
              </View>
            ) : screen === 'sign-in' ? (
              <View style={styles.panel}>
                <Text style={styles.eyebrow}>WELCOME BACK</Text>
                <Text accessibilityRole="header" style={styles.title}>Sign in</Text>
                <Text style={styles.bodyText}>Your device-local notes remain available and are not changed by signing in.</Text>
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
                  placeholder="Your password"
                  secureTextEntry
                  autoComplete="current-password"
                  error={fieldErrors.password}
                  returnKeyType="go"
                  onSubmitEditing={() => { void submitSignIn(); }}
                />
                {formError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>{formError}</Text>}
                <View style={styles.buttonStack}>
                  <AccountButton label={busy ? 'Signing in…' : 'Sign in'} loading={busy} disabled={busy} onPress={() => { void submitSignIn(); }} />
                  <AccountButton label="Forgot password?" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setFeedback(null); setScreen('password-reset'); }} />
                  <AccountButton label="Create an account" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setScreen('register'); }} />
                  <AccountButton label="Back" secondary disabled={busy} onPress={() => { setFormError(null); setFieldErrors({}); setScreen('welcome'); }} />
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
  modalRoot: { flex: 1, backgroundColor: '#f7f9f5' },
  keyboard: { flex: 1 },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e4eadf' },
  brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#48a111' },
  brandMarkText: { color: '#ffffff', fontSize: 23, fontWeight: '900' },
  headerCopy: { flex: 1 },
  brand: { color: '#20351d', fontSize: 17, fontWeight: '800' },
  headerSubtitle: { color: '#64715e', fontSize: 12, marginTop: 2 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f3f7ef' },
  closeText: { color: '#344b2d', fontSize: 28, lineHeight: 31 },
  content: { flexGrow: 1, padding: 18, paddingBottom: 34, gap: 14 },
  panel: { padding: 18, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e8da', gap: 15 },
  eyebrow: { color: '#478f1b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#20351d', fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
  bodyText: { color: '#52634d', fontSize: 14, lineHeight: 21 },
  fieldGroup: { gap: 6 },
  fieldControl: { gap: 6 },
  fieldLabel: { color: '#344b2d', fontSize: 14, fontWeight: '700' },
  input: { minHeight: 50, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#d5dfcd', borderRadius: 11, backgroundColor: '#f8faf6', color: '#20351d', fontSize: 16 },
  passwordField: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  passwordVisibilityButton: { position: 'absolute', right: 2, top: 1, bottom: 1, width: 46, alignItems: 'center', justifyContent: 'center' },
  inputError: { borderColor: '#b3261e' },
  fieldError: { color: '#b3261e', fontSize: 12, lineHeight: 17 },
  formError: { color: '#a51d1d', fontSize: 13, lineHeight: 19 },
  success: { color: '#2d6b1b', fontSize: 13, lineHeight: 20, padding: 12, borderRadius: 10, backgroundColor: '#eff7e9' },
  warning: { color: '#79520a', fontSize: 13, lineHeight: 20, padding: 12, borderRadius: 10, backgroundColor: '#fff6db', borderWidth: 1, borderColor: '#f1e1ad' },
  hint: { color: '#687763', fontSize: 13, lineHeight: 19 },
  buttonStack: { gap: 9, marginTop: 3 },
  button: { minHeight: 47, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: '#48a111' },
  secondaryButton: { backgroundColor: '#f0f5eb', borderWidth: 1, borderColor: '#dce6d4' },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  secondaryButtonText: { color: '#3b6f25' },
  buttonDimmed: { opacity: 0.62 },
  accountEmail: { color: '#344b2d', fontSize: 15, fontWeight: '700' },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16 },
  statusVerified: { backgroundColor: '#e8f5df' },
  statusUnverified: { backgroundColor: '#fff2d3' },
  statusText: { color: '#79520a', fontSize: 12, fontWeight: '800' },
  statusTextVerified: { color: '#347b0a' },
  inlineStatus: { gap: 8 },
  localFirstNote: { color: '#62705c', fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
});
