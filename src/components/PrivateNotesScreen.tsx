import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import {
  ActivityIndicator, Alert, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenCapture from 'expo-screen-capture';
import { createPrivateAccess, type AuthenticatedPrivateSession } from '../privateAccess';
import { importPrivateKey } from '../privateCrypto';
import { PRIVATE_BIOMETRIC_ENABLED_FLAG, privateBiometricKeyStore } from '../privateBiometricUnlock';
import { createPrivateSession } from '../privateSession';
import { createPrivateScreenCaptureProtection } from '../privateScreenCapture';
import { restoreDevicePrivateNoteWithKey } from '../privateRestoreService';
import { deleteDevicePrivateNote, updateDevicePrivateNote } from '../privateNoteManagementService';
import { validateDraft } from '../notes';
import { sanitizeNoteHtml } from '../noteFormatting';
import { getNoteActionsMenuLayout, type MenuRect } from '../noteActionsMenu';
import type { PrivateNotePreview } from '../privateNoteReader';
import { RichNoteEditor, type RichNoteEditorHandle } from './RichNoteEditor';

const access = createPrivateAccess(AsyncStorage);
type FontAwesomeName = ComponentProps<typeof FontAwesome>['name'];
type EditDraft = { id: string; title: string; text: string; html: string };

const PRIVATE_ACTIONS: { label: string; icon: FontAwesomeName }[] = [
  { label: 'Edit note', icon: 'pencil' },
  { label: 'Move out of Private Notes', icon: 'sign-out' },
  { label: 'Delete private note', icon: 'trash' },
];
function formatNoteTime(time?: string, createdAt?: string): string {
  if (time) return time;
  if (!createdAt) return 'No date';
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatUpdatedNoteTime(updatedAt?: string, time?: string, createdAt?: string): string {
  if (updatedAt) {
    const date = new Date(updatedAt);
    if (Number.isFinite(date.getTime())) {
      return `Updated ${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  }
  return `Updated ${formatNoteTime(time, createdAt)}`;
}

export function PrivateNotesScreen({ onBack, onRestored }: { onBack: () => void; onRestored?: () => Promise<void> }) {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'locked' | 'unlocked' | 'error'>('loading');
  const [captureProtection, setCaptureProtection] = useState<'pending' | 'ready' | 'error'>('pending');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const biometricAvailable = useMemo(() => privateBiometricKeyStore.canUse(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [privateNotes, setPrivateNotes] = useState<PrivateNotePreview[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<EditDraft | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [actionsNoteId, setActionsNoteId] = useState<string | null>(null);
  const [actionsAnchor, setActionsAnchor] = useState<MenuRect | null>(null);
  const [actionsViewport, setActionsViewport] = useState<MenuRect | null>(null);
  const [actionsMenuHeight, setActionsMenuHeight] = useState(0);
  const lifecycle = useRef({ mounted: false, busy: false });
  const sessionGuard = useRef(createPrivateSession());
  const authenticatedSession = useRef<AuthenticatedPrivateSession | null>(null);
  const bodyEditor = useRef<RichNoteEditorHandle | null>(null);
  const actionsLayer = useRef<ComponentRef<typeof View>>(null);
  const actionTriggers = useRef(new Map<string, ComponentRef<typeof View>>());
  const actionsRequest = useRef(0);
  const actionsMenuLayout = useMemo(() => actionsAnchor && actionsViewport
    ? getNoteActionsMenuLayout(actionsAnchor, actionsViewport, actionsMenuHeight)
    : null, [actionsAnchor, actionsViewport, actionsMenuHeight]);

  function clearSensitiveInputs() {
    setPassword('');
    setConfirmation('');
    setPasswordVisible(false);
    setConfirmationVisible(false);
  }

  function closeActionsMenu() {
    actionsRequest.current += 1;
    setActionsNoteId(null);
    setActionsAnchor(null);
    setActionsViewport(null);
    setActionsMenuHeight(0);
  }

  function lock() {
    sessionGuard.current.invalidate();
    authenticatedSession.current = null;
    lifecycle.current.busy = false;
    setBusy(false);
    setPhase(current => current === 'unlocked' ? 'locked' : current);
    clearSensitiveInputs();
    setPrivateNotes([]);
    setSelectedNoteId(null);
    setEditingNote(null);
    setEditorReady(false);
    closeActionsMenu();
    setError(null);
  }

  useEffect(() => {
    let active = true;
    const protection = createPrivateScreenCaptureProtection(ScreenCapture, Platform.OS === 'ios');
    void protection.activate().then(() => {
      if (active) setCaptureProtection('ready');
    }).catch(() => {
      if (active) setCaptureProtection('error');
    });
    return () => {
      active = false;
      void protection.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PRIVATE_BIOMETRIC_ENABLED_FLAG).then(value => {
      if (active) setBiometricEnabled(value === 'enabled');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

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
      authenticatedSession.current = null;
      activeGuard.setActive(false);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      sessionGuard.current.setActive(state === 'active');
      if (state !== 'active') {
        authenticatedSession.current = null;
        lifecycle.current.busy = false;
        setBusy(false);
        setBiometricBusy(false);
        setPhase(current => current === 'unlocked' ? 'locked' : current);
        clearSensitiveInputs();
        setPrivateNotes([]);
        setSelectedNoteId(null);
        setEditingNote(null);
        setEditorReady(false);
        closeActionsMenu();
        setError(null);
      }
    });
    return () => subscription.remove();
  }, []);

  async function submit() {
    const session = lifecycle.current;
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
      let unlockedSession: AuthenticatedPrivateSession | null = null;
      if (phase === 'setup') {
        await access.setup(password, confirmation);
      } else {
        unlockedSession = await access.readUnlockedSession(password);
        unlockedNotes = unlockedSession.notes;
      }
      if (!session.mounted) return;
      const valid = sessionGuard.current.valid(generation) && AppState.currentState === 'active';
      authenticatedSession.current = valid ? unlockedSession : null;
      setPrivateNotes(valid ? unlockedNotes : []);
      setSelectedNoteId(null);
      setEditingNote(null);
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

  async function unlockWithBiometric() {
    const session = lifecycle.current;
    if (!session.mounted || session.busy || AppState.currentState !== 'active' || phase !== 'locked') return;
    const generation = sessionGuard.current.begin();
    if (generation === null) return;
    session.busy = true;
    setBusy(true);
    setBiometricBusy(true);
    setError(null);
    let keyBytes: Uint8Array | null = null;
    const isCurrentAttempt = () => session.mounted && sessionGuard.current.valid(generation) && AppState.currentState === 'active';
    try {
      keyBytes = await privateBiometricKeyStore.read();
      if (!isCurrentAttempt()) return;
      if (keyBytes === null) {
        if (!password) {
          setError('Enter your Private Notes password once, then tap “Use passkey or fingerprint” to enable biometric unlock.');
          return;
        }
        keyBytes = await access.exportBiometricKey(password);
        if (!isCurrentAttempt()) return;
        await privateBiometricKeyStore.save(keyBytes);
      }
      const key = await importPrivateKey(keyBytes);
      if (!isCurrentAttempt()) return;
      keyBytes.fill(0);
      keyBytes = null;
      const unlockedSession = await access.readUnlockedSessionWithKey(key);
      if (!isCurrentAttempt()) return;
      authenticatedSession.current = unlockedSession;
      setPrivateNotes(unlockedSession.notes);
      setSelectedNoteId(null);
      setEditingNote(null);
      setPhase('unlocked');
      setBiometricEnabled(true);
      void AsyncStorage.setItem(PRIVATE_BIOMETRIC_ENABLED_FLAG, 'enabled').catch(() => undefined);
      clearSensitiveInputs();
    } catch (cause) {
      if (session.mounted && sessionGuard.current.valid(generation) && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'Biometric unlock could not be completed. Use your password instead.');
      }
    } finally {
      keyBytes?.fill(0);
      const ownsAttempt = sessionGuard.current.valid(generation);
      sessionGuard.current.finish(generation);
      if (ownsAttempt) {
        session.busy = false;
        if (session.mounted) {
          setBusy(false);
          setBiometricBusy(false);
        }
      }
    }
  }

  function confirmRemoveBiometricUnlock() {
    Alert.alert('Remove biometric unlock?', 'Your encrypted notes and password are unchanged. You can still unlock with your password.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void (async () => {
          try {
            await privateBiometricKeyStore.remove();
            await AsyncStorage.removeItem(PRIVATE_BIOMETRIC_ENABLED_FLAG).catch(() => undefined);
            setBiometricEnabled(false);
            setError(null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Biometric unlock could not be removed.');
          }
        })();
      } },
    ]);
  }

  async function performPrivateMutation<T>(operation: (session: AuthenticatedPrivateSession) => Promise<T>): Promise<T | null> {
    const lifecycleState = lifecycle.current;
    const auth = authenticatedSession.current;
    if (!lifecycleState.mounted || lifecycleState.busy || phase !== 'unlocked' ||
      !auth || AppState.currentState !== 'active') return null;
    const generation = sessionGuard.current.begin();
    if (generation === null) return null;
    lifecycleState.busy = true;
    setBusy(true);
    setError(null);
    try {
      const result = await operation(auth);
      if (!sessionGuard.current.valid(generation) || !lifecycle.current.mounted || AppState.currentState !== 'active') return null;
      return result;
    } catch (cause) {
      if (sessionGuard.current.valid(generation) && lifecycle.current.mounted && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'The private note action could not be completed.');
      }
      return null;
    } finally {
      lifecycleState.busy = false;
      sessionGuard.current.finish(generation);
      if (lifecycle.current.mounted) setBusy(false);
    }
  }

  function beginEdit(note: PrivateNotePreview) {
    closeActionsMenu();
    setSelectedNoteId(note.id);
    setEditingNote({ id: note.id, title: note.title, text: note.text, html: note.html });
    setEditorReady(false);
    setError(null);
  }

  async function saveEdit() {
    const edit = editingNote;
    const auth = authenticatedSession.current;
    const editor = bodyEditor.current;
    if (!edit || busy || lifecycle.current.busy) return;
    const current = privateNotes.find(note => note.id === edit.id);
    if (!current) { setError('This private note is no longer available.'); return; }
    if (!auth || phase !== 'unlocked' || AppState.currentState !== 'active') return;
    if (!editorReady || !editor) { setError('The note editor is still loading. Please wait and try again.'); return; }
    const generation = sessionGuard.current.begin();
    if (generation === null) return;
    lifecycle.current.busy = true;
    setBusy(true);
    setError(null);
    try {
      // WebView change events are asynchronous; snapshot the editor itself before
      // validation so a quick Save cannot persist stale React state.
      const content = await editor.getContent();
      if (!sessionGuard.current.valid(generation) || !lifecycle.current.mounted || AppState.currentState !== 'active') return;
      const snapshot = { id: edit.id, title: edit.title, text: content.text, html: content.html };
      setEditingNote(snapshot);
      const validation = validateDraft({
        title: snapshot.title, text: snapshot.text, html: snapshot.html,
        category: current.category as 'general' | 'work' | 'personal' | 'ideas' | 'important',
      });
      if (validation) { setError(validation); return; }
      const updated = await updateDevicePrivateNote(edit.id, auth, {
        title: snapshot.title, text: snapshot.text, html: snapshot.html,
      });
      if (!sessionGuard.current.valid(generation) || !lifecycle.current.mounted || AppState.currentState !== 'active') return;
      setPrivateNotes(notes => notes.map(note => note.id === updated.id ? updated : note));
      setEditingNote(null);
      setEditorReady(false);
    } catch (cause) {
      if (sessionGuard.current.valid(generation) && lifecycle.current.mounted && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'The private-note edit could not be saved.');
      }
    } finally {
      lifecycle.current.busy = false;
      sessionGuard.current.finish(generation);
      if (lifecycle.current.mounted) setBusy(false);
    }
  }

  async function togglePin(note: PrivateNotePreview) {
    const updated = await performPrivateMutation(session => updateDevicePrivateNote(note.id, session, { pinned: !note.pinned }));
    if (updated) setPrivateNotes(notes => notes.map(item => item.id === updated.id ? updated : item));
  }

  function confirmDeletePrivateNote(id: string) {
    closeActionsMenu();
    Alert.alert('Delete private note?', 'This permanently deletes the encrypted note from this device. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete permanently', style: 'destructive', onPress: () => { void deletePrivateNote(id); } },
    ]);
  }

  async function deletePrivateNote(id: string) {
    closeActionsMenu();
    const deleted = await performPrivateMutation(async session => {
      await deleteDevicePrivateNote(id, session);
      return true;
    });
    if (!deleted) return;
    setPrivateNotes(notes => notes.filter(note => note.id !== id));
    setSelectedNoteId(current => current === id ? null : current);
    setEditingNote(current => current?.id === id ? null : current);
  }

  async function restoreSelected(id: string) {
    const auth = authenticatedSession.current;
    if (!auth || busy || lifecycle.current.busy || phase !== 'unlocked' || AppState.currentState !== 'active') return;
    const generation = sessionGuard.current.begin();
    if (generation === null) return;
    lifecycle.current.busy = true;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreDevicePrivateNoteWithKey(id, auth.key);
      if (!sessionGuard.current.valid(generation) || !lifecycle.current.mounted || AppState.currentState !== 'active') return;
      if (result === 'restored') {
        setPrivateNotes(notes => notes.filter(note => note.id !== id));
        setSelectedNoteId(null);
        setEditingNote(null);
        if (onRestored) await onRestored();
      } else {
        setError('Restore needs recovery. Both copies may exist. Do not delete either copy.');
      }
    } catch (cause) {
      if (sessionGuard.current.valid(generation) && lifecycle.current.mounted && AppState.currentState === 'active') {
        setError(cause instanceof Error ? cause.message : 'Restore failed.');
      }
    } finally {
      lifecycle.current.busy = false;
      sessionGuard.current.finish(generation);
      if (lifecycle.current.mounted) setBusy(false);
    }
  }

  function confirmMoveOut(id: string) {
    closeActionsMenu();
    Alert.alert('Move out of Private Notes?', 'This restores the note to your regular notes library.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move out', style: 'destructive', onPress: () => { void restoreSelected(id); } },
    ]);
  }

  function showActions(noteId: string) {
    actionsRequest.current += 1;
    setActionsAnchor(null);
    setActionsViewport(null);
    setActionsMenuHeight(0);
    setActionsNoteId(noteId);
  }

  function measureActionsMenu() {
    const noteId = actionsNoteId;
    const revision = actionsRequest.current;
    const layer = actionsLayer.current;
    const trigger = noteId ? actionTriggers.current.get(noteId) : null;
    if (!noteId || !layer?.measureInWindow || !trigger?.measureInWindow) return;
    layer.measureInWindow((x, y, width, height) => {
      if (revision !== actionsRequest.current || width <= 0 || height <= 0) return;
      trigger.measureInWindow?.((anchorX, anchorY, anchorWidth, anchorHeight) => {
        if (revision !== actionsRequest.current || anchorWidth <= 0 || anchorHeight <= 0) return;
        setActionsViewport({ x, y, width, height });
        setActionsAnchor({ x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight });
      });
    });
  }

  const orderedNotes = useMemo(() => [...privateNotes].sort((a, b) => Number(b.pinned) - Number(a.pinned)), [privateNotes]);
  const activeActionNote = actionsNoteId ? privateNotes.find(note => note.id === actionsNoteId) : null;

  if (captureProtection !== 'ready') {
    return (
      <View style={styles.container}>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text style={styles.back}>‹ All notes</Text>
        </Pressable>
        {captureProtection === 'pending' ? <ActivityIndicator /> : (
          <Text accessibilityRole="alert" style={styles.error}>
            Screen protection could not be enabled. Private Notes are unavailable until you leave and reopen this screen.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" disabled={biometricBusy} onPress={() => { lock(); onBack(); }}>
        <Text style={styles.back}>‹ All notes</Text>
      </Pressable>
      {phase === 'locked' && <Text style={styles.privateEyebrow}>PRIVATE NOTES</Text>}
      <View testID="private-notes-title-row" style={styles.titleRow}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {phase === 'setup' ? 'Protect your notes' : phase === 'unlocked' ? 'Private Notes' : 'Unlock Private Notes'}
        </Text>
        {phase === 'unlocked' && (
          <Pressable accessibilityRole="button" accessibilityLabel="Lock Private Notes"
            accessibilityHint="Clears decrypted notes and locks the vault" accessibilityState={{ disabled: busy }}
            disabled={busy} onPress={lock}
            style={({ pressed }) => [styles.headerLockButton, pressed && styles.pressed, busy && styles.disabledButton]}>
            <MaterialCommunityIcons name="lock" size={17} color="#3b7f16" accessible={false} />
            <Text style={styles.headerLockText}>Lock</Text>
          </Pressable>
        )}
      </View>
      {phase === 'loading' ? <ActivityIndicator /> : phase === 'error' ? (
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      ) : phase === 'unlocked' ? (
        <>
          <Text style={styles.description}>Your encrypted notes are available only while this vault is unlocked.</Text>
          <Text testID="private-note-count" style={styles.description}>{orderedNotes.length} private {orderedNotes.length === 1 ? 'note' : 'notes'}</Text>
          {biometricEnabled && (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove biometric unlock"
              disabled={busy} onPress={confirmRemoveBiometricUnlock} style={styles.biometricRemoveButton}>
              <Text style={styles.biometricRemoveText}>Remove biometric unlock</Text>
            </Pressable>
          )}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <ScrollView style={styles.noteScroll} contentContainerStyle={styles.noteList} keyboardShouldPersistTaps="handled">
            {orderedNotes.length === 0 ? <Text style={styles.description}>No private notes yet.</Text> : orderedNotes.map(note => {
              const expanded = selectedNoteId === note.id;
              const editing = editingNote?.id === note.id;
              return (
                <View key={note.id} style={[styles.privateCard, note.pinned && styles.privateCardPinned]}>
                  <View style={styles.noteCardTop}>
                    <View style={[styles.noteAccent, note.pinned && styles.noteAccentPinned]} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`Open private note ${note.title || 'Untitled'}`}
                      onPress={() => setSelectedNoteId(current => current === note.id ? null : note.id)} style={styles.titlePressable}>
                      <Text style={styles.noteTitle}>{note.title || 'Untitled note'}</Text>
                    </Pressable>
                  </View>
                  {editing && editingNote ? (
                    <View style={styles.editForm}>
                      <TextInput accessibilityLabel="Edit private note title" autoCapitalize="sentences" autoCorrect
                        value={editingNote.title} onChangeText={title => setEditingNote(current => current ? { ...current, title } : current)}
                        placeholder="Note title" style={styles.titleInput} />
                      <RichNoteEditor ref={bodyEditor} accessibilityLabel="Edit private note body" text={editingNote.text} html={sanitizeNoteHtml(editingNote.html)}
                        editable={!busy} onReady={setEditorReady}
                        onChange={content => setEditingNote(current => current ? { ...current, ...content } : current)}
                        onSelection={() => undefined} />
                      <View style={styles.editButtons}>
                        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEditingNote(null); setEditorReady(false); setError(null); }} style={styles.cancelEditButton}>
                          <Text style={styles.cancelEditText}>Cancel</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" disabled={busy || !editorReady} onPress={() => void saveEdit()} style={[styles.saveEditButton, (busy || !editorReady) && styles.disabledButton]}>
                          <Text style={styles.saveEditText}>{busy ? 'Saving…' : 'Save note'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} private note ${note.title || 'Untitled'}`}
                      onPress={() => setSelectedNoteId(current => current === note.id ? null : note.id)}>
                      <Text numberOfLines={expanded ? undefined : 5} style={styles.noteText}>{note.text || 'No note text.'}</Text>
                    </Pressable>
                  )}
                  <View testID="private-note-footer" style={styles.noteFooter}>
                    <View testID="private-note-metadata" style={styles.noteMeta}>
                      <Text numberOfLines={1} style={styles.noteCategory}>{note.category || 'General'}</Text>
                      <Text numberOfLines={1} style={styles.noteTime}>{formatUpdatedNoteTime(note.updatedAt, note.time, note.createdAt)}</Text>
                    </View>
                    <View testID="private-note-footer-actions" style={styles.footerActions}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${note.pinned ? 'Unpin' : 'Pin'} private note ${note.title || 'Untitled'}`}
                        accessibilityState={{ selected: note.pinned, disabled: busy }} disabled={busy}
                        onPress={() => void togglePin(note)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                        <FontAwesome name="thumb-tack" size={18} color={note.pinned ? '#b98500' : '#8c9988'} accessible={false} />
                      </Pressable>
                      <Pressable ref={node => { if (node) actionTriggers.current.set(note.id, node); else actionTriggers.current.delete(note.id); }}
                        accessibilityRole="button" accessibilityLabel={`Note actions for ${note.title || 'Untitled'}`}
                        accessibilityState={{ expanded: actionsNoteId === note.id, disabled: busy }} disabled={busy}
                        onPress={() => showActions(note.id)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                        <FontAwesome name="ellipsis-v" size={19} color="#687567" accessible={false} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : (
        <>
          <Text style={styles.description}>
            {phase === 'setup'
              ? 'Create a password with at least 12 characters. If you forget it, encrypted private content cannot be recovered. If you cancel after starting setup, it may still finish. Keep this password to unlock later.'
              : biometricEnabled
                ? 'Enter your Private Notes password. It is never saved on this device.'
                : 'Enter your Private Notes password. It is never saved on this device. To enable biometric unlock, enter it once and tap “Use passkey or fingerprint”.'}
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
          {phase === 'locked' && (biometricAvailable || biometricEnabled) && (
            <Pressable accessibilityRole="button" accessibilityLabel="Use passkey or fingerprint"
              accessibilityHint={biometricEnabled
                ? 'Authenticate with this device to unlock Private Notes; password unlock remains available.'
                : 'Enter your password first to set up biometric unlock on this device.'}
              accessibilityState={{ disabled: busy }} disabled={busy}
              onPress={() => void unlockWithBiometric()}
              style={({ pressed }) => [styles.biometricButton, pressed && styles.pressed, busy && styles.disabledButton]}>
              <MaterialCommunityIcons name="fingerprint" size={23} color="#ffffff" accessible={false} />
              <Text style={styles.biometricButtonText}>{busy ? 'Please wait…' : 'Use passkey or fingerprint'}</Text>
            </Pressable>
          )}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" disabled={biometricBusy} style={styles.cancelButton} onPress={() => { lock(); onBack(); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, styles.submitButton]} onPress={() => void submit()}>
              <Text style={styles.buttonText}>{busy ? 'Please wait…' : phase === 'setup' ? 'Set password' : 'Unlock'}</Text>
            </Pressable>
          </View>
        </>
      )}
      <Modal visible={actionsNoteId !== null} transparent animationType="fade" onShow={measureActionsMenu}
        onRequestClose={closeActionsMenu}>
        <View ref={actionsLayer} style={styles.actionsLayer} onLayout={measureActionsMenu}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close note actions" onPress={closeActionsMenu} style={styles.actionsBackdrop} />
          <View testID="private-note-actions-menu" accessibilityLabel="Private note actions" accessibilityViewIsModal
            onAccessibilityEscape={closeActionsMenu}
            onLayout={event => setActionsMenuHeight(event.nativeEvent.layout.height)}
            style={[styles.actionsMenu, actionsMenuLayout]}>
            {activeActionNote && PRIVATE_ACTIONS.map(action => (
              <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={`${action.label}: ${activeActionNote.title || 'Untitled note'}`}
                disabled={busy} onPress={() => {
                  const note = activeActionNote;
                  if (action.label === 'Edit note') beginEdit(note);
                  else if (action.label === 'Move out of Private Notes') confirmMoveOut(note.id);
                  else confirmDeletePrivateNote(note.id);
                }} style={({ pressed }) => [styles.actionsMenuRow, pressed && styles.actionsMenuRowPressed]}>
                <FontAwesome name={action.icon} size={18} color={action.label === 'Delete private note' ? '#b3261e' : '#52634b'} accessible={false} />
                <Text style={[styles.actionsMenuText, action.label === 'Delete private note' && styles.actionsMenuDanger]}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, width: '100%', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, gap: 12, backgroundColor: '#f7f9f5' },
  back: { color: '#3b7f16', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  privateEyebrow: { color: '#4d9c25', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, color: '#20351d', fontSize: 28, fontWeight: '800' },
  headerLockButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: 10, borderWidth: 1, borderColor: '#cbd9c3', borderRadius: 12, backgroundColor: '#ffffff' },
  headerLockText: { color: '#3b7f16', fontSize: 14, fontWeight: '800' },
  description: { color: '#586851', fontSize: 15, lineHeight: 23 },
  noteScroll: { flex: 1, minHeight: 0, width: '100%' },
  noteList: { gap: 14, paddingBottom: 90, flexGrow: 1 },
  privateCard: { backgroundColor: '#ffffff', borderColor: '#dfe7d9', borderWidth: 1, borderRadius: 16, padding: 15, gap: 10, shadowColor: '#213a1b', shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  privateCardPinned: { borderColor: '#d1a722', borderWidth: 1.5 },
  noteCardTop: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  noteAccent: { width: 4, alignSelf: 'stretch', minHeight: 24, borderRadius: 4, backgroundColor: '#48a111' },
  noteAccentPinned: { backgroundColor: '#d3a600' },
  titlePressable: { flex: 1, justifyContent: 'center', minHeight: 30 },
  noteTitle: { color: '#20351d', fontSize: 18, fontWeight: '800', lineHeight: 24 },
  noteText: { color: '#485843', fontSize: 14, lineHeight: 21 },
  noteTime: { color: '#778372', fontSize: 12 },
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e4e8e1', minHeight: 42 },
  noteMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteCategory: { color: '#687b69', fontSize: 11, fontWeight: '700', textTransform: 'capitalize', backgroundColor: '#eef3ef', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, overflow: 'hidden', flexShrink: 0 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  pressed: { opacity: 0.7 },
  editForm: { gap: 10 },
  titleInput: { padding: 12, fontSize: 16, color: '#20351d', borderWidth: 1, borderColor: '#cbd9c3', borderRadius: 10 },
  editButtons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  cancelEditButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#cbd9c3' },
  cancelEditText: { color: '#3b6f25', fontWeight: '700' },
  saveEditButton: { minHeight: 44, minWidth: 108, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#3b7f16' },
  saveEditText: { color: '#fff', fontWeight: '800' },
  error: { color: '#a32b2b', fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderColor: '#cbd9c3', borderWidth: 1, borderRadius: 12, paddingLeft: 14 },
  input: { flex: 1, paddingVertical: 14, paddingRight: 8, fontSize: 16, color: '#20351d' },
  visibilityButton: { minWidth: 48, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  biometricButton: { width: '100%', minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#69bd2d' },
  biometricButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  biometricRemoveButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#cbd9c3' },
  biometricRemoveText: { color: '#3b7f16', fontSize: 14, fontWeight: '700' },
  button: { padding: 16, borderRadius: 12, backgroundColor: '#3b7f16', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cancelButton: { flex: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#d2a2a2', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  cancelText: { color: '#b3261e', fontSize: 16, fontWeight: '800' },
  submitButton: { flex: 1, minHeight: 50, justifyContent: 'center' },
  disabledButton: { opacity: 0.55 },
  actionsLayer: { flex: 1 },
  actionsBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15, 28, 12, 0.08)' },
  actionsMenu: { position: 'absolute', width: 216, backgroundColor: '#ffffff', borderColor: '#dce5d7', borderWidth: 1, borderRadius: 14, paddingVertical: 5, elevation: 8, shadowColor: '#182514', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  actionsMenuRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14 },
  actionsMenuRowPressed: { backgroundColor: '#f2f6ef' },
  actionsMenuText: { flex: 1, color: '#243521', fontSize: 15, fontWeight: '700' },
  actionsMenuDanger: { color: '#b3261e' },
});
