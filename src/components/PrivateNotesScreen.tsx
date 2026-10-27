import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrivateAccess } from '../privateAccess';
import { createPrivateSession } from '../privateSession';
import { restoreDevicePrivateNote } from '../privateRestoreService';
import type { PrivateNotePreview } from '../privateNoteReader';

const access = createPrivateAccess(AsyncStorage);

export function PrivateNotesScreen({ onBack, onRestored }: { onBack: () => void; onRestored?: () => Promise<void> }) {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'locked' | 'unlocked' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [privateNotes, setPrivateNotes] = useState<PrivateNotePreview[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const lifecycle = useRef({ mounted: false, busy: false });
  const sessionGuard = useRef(createPrivateSession());

  function clearSensitiveInputs() {
    setPassword('');
    setConfirmation('');
    setPasswordVisible(false);
    setConfirmationVisible(false);
  }

  useEffect(() => {
    const session = lifecycle.current;
    const activeGuard = sessionGuard.current;
    let active = true;
    session.mounted = true;
    activeGuard.setActive(AppState.currentState === 'active');
    void access.status().then(status => { if (active) setPhase(status); })
      .catch(() => { if (active) { setPhase('error'); setError('Could not read the encrypted vault. No changes were made.'); } });
    return () => {
      active = false;
      session.mounted = false;
      activeGuard.setActive(false);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      sessionGuard.current.setActive(state === 'active');
      if (state !== 'active') {
        setPhase(current => current === 'unlocked' ? 'locked' : current);
        clearSensitiveInputs();
        setPrivateNotes([]);
        setSelectedNoteId(null);
        setRestoreId(null);
        setRestorePassword('');
        setError(null);
      }
    });
    return () => subscription.remove();
  }, []);

  function lock() {
    sessionGuard.current.invalidate();
    setPhase(current => current === 'unlocked' ? 'locked' : current);
    clearSensitiveInputs();
    setPrivateNotes([]);
    setSelectedNoteId(null);
    setRestoreId(null);
    setRestorePassword('');
    setError(null);
  }

  async function submit() {
    const session = lifecycle.current;
    // A ref closes the double-tap gap before React renders the busy state.
    if (!session.mounted || session.busy || AppState.currentState !== 'active' ||
      (phase !== 'setup' && phase !== 'locked')) return;
    const generation = sessionGuard.current.begin();
    if (generation === null) return;
    session.busy = true;
    setBusy(true);
    setPasswordVisible(false);
    setConfirmationVisible(false);
    setError(null);
    try {
      let unlockedNotes: PrivateNotePreview[] = [];
      if (phase === 'setup') {
        await access.setup(password, confirmation);
      } else {
        unlockedNotes = await access.readUnlocked(password);
      }
      if (!session.mounted) return;
      // Setup may have committed while backgrounded. Offer unlock, not setup,
      // but never let a result from the old foreground session unlock the UI.
      const valid = sessionGuard.current.valid(generation) && AppState.currentState === 'active';
      setPrivateNotes(valid ? unlockedNotes : []);
      setSelectedNoteId(null);
      setPhase(valid ? 'unlocked' : 'locked');
      clearSensitiveInputs();
    } catch (cause) {
      if (session.mounted && sessionGuard.current.valid(generation) && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'Private Notes could not be unlocked.');
      }
    } finally {
      session.busy = false;
      sessionGuard.current.finish(generation);
      if (session.mounted) setBusy(false);
    }
  }

  async function restoreSelected() {
    if (!restoreId || busy || phase !== 'unlocked' || AppState.currentState !== 'active') return;
    const id = restoreId;
    const generation = sessionGuard.current.begin();
    if (generation === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreDevicePrivateNote(id, restorePassword);
      if (!sessionGuard.current.valid(generation) || !lifecycle.current.mounted || AppState.currentState !== 'active') return;
      if (result === 'restored') {
        setPrivateNotes(notes => notes.filter(note => note.id !== id));
        setSelectedNoteId(null);
        setRestoreId(null);
        setRestorePassword('');
        if (onRestored) await onRestored();
      } else {
        setError('Restore needs recovery. Both copies may exist. Do not delete either copy.');
      }
    } catch (cause) {
      if (sessionGuard.current.valid(generation) && lifecycle.current.mounted) {
        setError(cause instanceof Error ? cause.message : 'Restore failed.');
      }
    } finally {
      sessionGuard.current.finish(generation);
      if (lifecycle.current.mounted) setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" onPress={() => { lock(); onBack(); }}>
        <Text style={styles.back}>‹ All notes</Text>
      </Pressable>
      <Text style={styles.eyebrow}>PRIVATE NOTES</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {phase === 'setup' ? 'Protect your notes' : phase === 'unlocked' ? 'Private Notes' : 'Locked notes'}
      </Text>
      {phase === 'loading' ? <ActivityIndicator /> : phase === 'error' ? (
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      ) : phase === 'unlocked' ? (
        <>
          <Text style={styles.description}>Your encrypted notes are available only while this vault is unlocked.</Text>
          {privateNotes.length === 0 ? <Text style={styles.description}>No private notes yet.</Text> : privateNotes.map(note => (
            <View key={note.id}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open private note ${note.title || 'Untitled'}`}
                onPress={() => setSelectedNoteId(current => current === note.id ? null : note.id)}>
                <Text style={styles.privateNoteTitle}>{note.title || 'Untitled note'}</Text>
              </Pressable>
              {selectedNoteId === note.id && <View style={{ gap: 12 }}>
                <Text style={styles.description}>{note.text}</Text>
                <Pressable accessibilityRole="button" onPress={() => { setRestoreId(note.id); setRestorePassword(''); }}>
                  <Text style={styles.back}>Move back to ordinary notes</Text>
                </Pressable>
              </View>}
            </View>
          ))}
          {restoreId !== null && <View style={{ gap: 10 }}>
            <Text style={styles.description}>Confirm your Private Notes password to restore this note.</Text>
            <TextInput accessibilityLabel="Confirm password to restore private note" secureTextEntry
              autoCapitalize="none" autoCorrect={false} value={restorePassword}
              onChangeText={setRestorePassword} placeholder="Private Notes password" style={styles.input} />
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void restoreSelected()}>
              <Text style={styles.buttonText}>{busy ? 'Restoring…' : 'Restore note'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRestoreId(null); setRestorePassword(''); }}>
              <Text style={styles.back}>Cancel restore</Text>
            </Pressable>
          </View>}
          <Pressable style={styles.button} onPress={lock}>
            <Text style={styles.buttonText}>Lock Private Notes</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.description}>
            {phase === 'setup'
              ? 'Create a password with at least 12 characters. If you forget it, encrypted private content cannot be recovered. If you cancel after starting setup, it may still finish. Keep this password to unlock later.'
              : 'Enter your Private Notes password. It is never saved on this device.'}
          </Text>
          <View style={styles.inputRow}>
            <TextInput accessibilityLabel="Private Notes password" placeholder="Password" secureTextEntry={!passwordVisible}
              autoCapitalize="none" autoCorrect={false} underlineColorAndroid="transparent"
              value={password} onChangeText={setPassword} style={styles.input} />
            <Pressable accessibilityRole="button"
              accessibilityLabel={`${passwordVisible ? 'Hide' : 'Show'} Private Notes password`}
              accessibilityHint={passwordVisible ? 'Hides the password on screen' : 'Shows the password on screen'}
              disabled={busy} hitSlop={8} style={styles.visibilityButton}
              onPress={() => setPasswordVisible(visible => !visible)}>
              <MaterialCommunityIcons name={passwordVisible ? 'eye-off' : 'eye'} size={22} color="#3b7f16" />
            </Pressable>
          </View>
          {phase === 'setup' && (
            <View style={styles.inputRow}>
              <TextInput accessibilityLabel="Confirm Private Notes password" placeholder="Confirm password" secureTextEntry={!confirmationVisible}
                autoCapitalize="none" autoCorrect={false} underlineColorAndroid="transparent"
                value={confirmation} onChangeText={setConfirmation} style={styles.input} />
              <Pressable accessibilityRole="button"
                accessibilityLabel={`${confirmationVisible ? 'Hide' : 'Show'} confirmation password`}
                accessibilityHint={confirmationVisible ? 'Hides the confirmation password on screen' : 'Shows the confirmation password on screen'}
                disabled={busy} hitSlop={8} style={styles.visibilityButton}
                onPress={() => setConfirmationVisible(visible => !visible)}>
                <MaterialCommunityIcons name={confirmationVisible ? 'eye-off' : 'eye'} size={22} color="#3b7f16" />
              </Pressable>
            </View>
          )}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={() => { lock(); onBack(); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, styles.submitButton]} onPress={() => void submit()}>
              <Text style={styles.buttonText}>{busy ? 'Please wait…' : phase === 'setup' ? 'Set password' : 'Unlock'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 22, gap: 16, backgroundColor: '#fff' },
  back: { color: '#3b7f16', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  eyebrow: { color: '#3b7f16', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#20351d', fontSize: 28, fontWeight: '800' },
  description: { color: '#586851', fontSize: 15, lineHeight: 23 },
  privateNoteTitle: { color: '#20351d', fontSize: 17, fontWeight: '700', paddingVertical: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderColor: '#cbd9c3', borderWidth: 1, borderRadius: 12, paddingLeft: 14 },
  input: { flex: 1, paddingVertical: 14, paddingRight: 8, fontSize: 16, color: '#20351d' },
  visibilityButton: { minWidth: 48, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#a32b2b', fontSize: 14 },
  button: { padding: 16, borderRadius: 12, backgroundColor: '#3b7f16', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cancelButton: { flex: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#c73333', alignItems: 'center', justifyContent: 'center', backgroundColor: '#b42323' },
  cancelText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  submitButton: { flex: 1, minHeight: 50, justifyContent: 'center' },
});
