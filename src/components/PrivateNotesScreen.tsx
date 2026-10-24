import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrivateAccess } from '../privateAccess';

const access = createPrivateAccess(AsyncStorage);

export function PrivateNotesScreen({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'locked' | 'unlocked' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lifecycle = useRef({ mounted: false, generation: 0, busy: false });

  useEffect(() => {
    const session = lifecycle.current;
    let active = true;
    session.mounted = true;
    void access.status().then(status => { if (active) setPhase(status); })
      .catch(() => { if (active) { setPhase('error'); setError('Could not read the encrypted vault. No changes were made.'); } });
    return () => {
      active = false;
      session.mounted = false;
      session.generation += 1;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        lifecycle.current.generation += 1;
        setPhase(current => current === 'unlocked' ? 'locked' : current);
        setPassword('');
        setConfirmation('');
        setError(null);
      }
    });
    return () => subscription.remove();
  }, []);

  function lock() {
    lifecycle.current.generation += 1;
    setPhase(current => current === 'unlocked' ? 'locked' : current);
    setPassword('');
    setConfirmation('');
    setError(null);
  }

  async function submit() {
    const session = lifecycle.current;
    // A ref closes the double-tap gap before React renders the busy state.
    if (!session.mounted || session.busy || AppState.currentState !== 'active' ||
      (phase !== 'setup' && phase !== 'locked')) return;
    session.busy = true;
    const generation = session.generation;
    setBusy(true);
    setError(null);
    try {
      if (phase === 'setup') {
        await access.setup(password, confirmation);
      } else {
        await access.unlock(password);
      }
      if (!session.mounted) return;
      // Setup may have committed while backgrounded. Offer unlock, not setup,
      // but never let a result from the old foreground session unlock the UI.
      setPhase(session.generation === generation && AppState.currentState === 'active' ? 'unlocked' : 'locked');
      setPassword('');
      setConfirmation('');
    } catch (cause) {
      if (session.mounted && session.generation === generation && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'Private Notes could not be unlocked.');
      }
    } finally {
      session.busy = false;
      if (session.mounted) setBusy(false);
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
          <Text style={styles.description}>Your private vault is protected. Moving notes into Private and viewing encrypted notes will be enabled in a later update.</Text>
          <Pressable style={styles.button} onPress={lock}>
            <Text style={styles.buttonText}>Lock Private Notes</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.description}>
            {phase === 'setup'
              ? 'Create a password with at least 12 characters. If you forget it, encrypted private content cannot be recovered.'
              : 'Enter your Private Notes password. It is never saved on this device.'}
          </Text>
          <TextInput accessibilityLabel="Private Notes password" placeholder="Password" secureTextEntry
            autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} style={styles.input} />
          {phase === 'setup' && (
            <TextInput accessibilityLabel="Confirm Private Notes password" placeholder="Confirm password" secureTextEntry
              autoCapitalize="none" autoCorrect={false} value={confirmation} onChangeText={setConfirmation} style={styles.input} />
          )}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void submit()}>
            <Text style={styles.buttonText}>{busy ? 'Please wait…' : phase === 'setup' ? 'Set password' : 'Unlock'}</Text>
          </Pressable>
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
  input: { borderColor: '#cbd9c3', borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, color: '#20351d' },
  error: { color: '#a32b2b', fontSize: 14 },
  button: { padding: 16, borderRadius: 12, backgroundColor: '#3b7f16', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
