import { useReducer, useRef } from 'react';
import {
  Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  characterCount, hasUnsavedChanges, initialNotesState, MAX_NOTE_CHARACTERS, notesReducer,
} from '../notes';
import type { Note } from '../notes';

function Action({ label, onPress, secondary = false }: {
  label: string; onPress: () => void; secondary?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function NotesWorkspace() {
  const [state, dispatch] = useReducer(notesReducer, undefined, initialNotesState);
  const sequence = useRef(0);
  const list = useRef<FlatList<Note>>(null);
  const count = characterCount(state.draft);
  const dirty = hasUnsavedChanges(state);

  function confirmDiscard(continueAction: () => void) {
    if (!dirty) {
      continueAction();
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Your saved session notes will not be changed.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: continueAction },
    ], { cancelable: true });
  }

  function resetEditor() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      list.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }

  function editNote(id: string) {
    if (state.editingId === id) {
      list.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    confirmDiscard(() => {
      dispatch({ type: 'edit', id });
      list.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }

  function saveNote() {
    // A monotonic session counter avoids same-millisecond collisions, even after clock changes.
    sequence.current += 1;
    dispatch({ type: 'save', id: `session-note-${sequence.current}`, now: new Date().toISOString() });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={list}
        data={state.notes}
        keyExtractor={note => note.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.brand}>SnapNotes</Text>
            <Text style={styles.tagline}>Save Your Mind.</Text>
            <View style={styles.warning}>
              <Text style={styles.warningText}>Session only — notes are kept in memory and disappear when the app restarts or reloads. Nothing syncs to the PWA.</Text>
            </View>
            <View style={styles.editor}>
              <Text accessibilityRole="header" style={styles.heading}>
                {state.editingId === null ? 'New note' : 'Edit note'}
              </Text>
              <Text style={styles.label}>Title (optional)</Text>
              <TextInput
                accessibilityLabel="Note title (optional)"
                value={state.draft.title}
                onChangeText={value => dispatch({ type: 'change', field: 'title', value })}
                placeholder="Give your note a title"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
              <Text style={styles.label}>Note</Text>
              <TextInput
                accessibilityLabel="Note body"
                value={state.draft.text}
                onChangeText={value => dispatch({ type: 'change', field: 'text', value })}
                placeholder="What's on your mind?"
                placeholderTextColor="#64748b"
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.bodyInput]}
              />
              <Text style={[styles.hint, count > MAX_NOTE_CHARACTERS && styles.error]}>
                {count}/{MAX_NOTE_CHARACTERS} characters
              </Text>
              <Text style={styles.hint}>Title counts include the PWA’s “## ” marker and a line break. Plain text only for now.</Text>
              {state.error !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.error}</Text>}
              {state.notice !== null && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
              <View style={styles.actions}>
                <Action label={state.editingId === null ? 'Save note' : 'Save changes'} onPress={saveNote} />
                {(state.editingId !== null || dirty) && <Action label="Cancel" onPress={resetEditor} secondary />}
                {state.editingId !== null && <Action label="New note" onPress={resetEditor} secondary />}
              </View>
            </View>
            <Text accessibilityRole="header" style={styles.heading}>Session notes ({state.notes.length})</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No notes yet. Write a title or a note above, then tap Save note.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, state.editingId === item.id && styles.editingCard]}>
            <Text accessibilityRole="header" style={styles.noteTitle}>{item.title || 'Untitled note'}</Text>
            {item.text !== '' && <Text style={styles.noteText}>{item.text}</Text>}
            <Text style={styles.hint}>Created {new Date(item.createdAt).toLocaleString()}</Text>
            {item.updatedAt !== item.createdAt && <Text style={styles.hint}>Updated {new Date(item.updatedAt).toLocaleString()}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title || 'Untitled note'}`}
              onPress={() => editNote(item.id)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>{state.editingId === item.id ? 'Editing this note' : 'Edit note'}</Text>
            </Pressable>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  header: { gap: 16 },
  brand: { color: '#172554', fontSize: 34, fontWeight: '800' },
  tagline: { color: '#475569', fontSize: 18 },
  warning: { backgroundColor: '#fff3cc', padding: 16, borderRadius: 12 },
  warningText: { color: '#664300', fontSize: 14, lineHeight: 21 },
  editor: { backgroundColor: '#fff', borderColor: '#dce2ee', borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 },
  heading: { color: '#172554', fontSize: 22, fontWeight: '700' },
  label: { color: '#334155', fontSize: 15, fontWeight: '600' },
  input: { color: '#172554', backgroundColor: '#f8fafc', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, minHeight: 48 },
  bodyInput: { minHeight: 160, maxHeight: 280 },
  hint: { color: '#475569', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { backgroundColor: '#1e40af', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, minHeight: 48, justifyContent: 'center' },
  secondaryButton: { backgroundColor: '#edf2fc' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryText: { color: '#1e40af', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  error: { color: '#b91c1c', fontSize: 14, lineHeight: 21 },
  notice: { color: '#166534', fontSize: 14, lineHeight: 21 },
  empty: { color: '#475569', fontSize: 16, lineHeight: 24 },
  card: { backgroundColor: '#fff', borderColor: '#dce2ee', borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  editingCard: { borderColor: '#1e40af', borderWidth: 2 },
  noteTitle: { color: '#172554', fontSize: 20, fontWeight: '700' },
  noteText: { color: '#334155', fontSize: 16, lineHeight: 24 },
  editButton: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#edf2fc', borderRadius: 10 },
});
