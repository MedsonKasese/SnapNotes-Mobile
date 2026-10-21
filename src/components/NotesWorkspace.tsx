import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  characterCount, hasUnsavedChanges, MAX_NOTE_CHARACTERS, NOTE_CATEGORIES, normalizeCategory, type NoteCategory,
} from '../notes';
import { createNotesController } from '../notesController';
import { deviceNotesStorage } from '../deviceNotesStorage';
import { searchNotes } from '../noteSearch';
import { ChecklistLabel } from './ChecklistLabel';

type WorkspaceView = 'library' | 'editor';
const categoryLabel = (category: NoteCategory) => category.charAt(0).toUpperCase() + category.slice(1);

const EDITOR_DRAFT_KEY = '@snapnotes-mobile/editor-draft';
const EDITOR_DRAFT_VERSION = 1;

function Action({ label, onPress, secondary = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button, secondary && styles.secondaryButton,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

function MenuRow({ label, detail, onPress, active = false }: {
  label: string; detail: string; onPress: () => void; active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, active && styles.menuRowActive, pressed && styles.pressed]}
    >
      <View style={styles.menuRowCopy}>
        <Text style={[styles.menuRowTitle, active && styles.menuRowTitleActive]}>{label}</Text>
        <Text style={styles.menuRowDetail}>{detail}</Text>
      </View>
      <Text style={styles.menuChevron} accessibilityElementsHidden>›</Text>
    </Pressable>
  );
}

export function NotesWorkspace() {
  const [controller] = useState(() => createNotesController(deviceNotesStorage));
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>('library');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const draftWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const { state, status, storageError } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const dispatch = controller.dispatch;
  const saving = status === 'saving';
  const count = characterCount(state.draft);
  const dirty = hasUnsavedChanges(state);
  const visibleNotes = searchNotes(state.notes.filter(note => categoryFilter === 'all' || normalizeCategory(note.category) === categoryFilter), searchQuery);
  const searching = searchQuery.trim().length > 0;

  const restoreEditorDraft = useCallback(async () => {
    if (controller.getSnapshot().status !== 'ready') return;

    try {
      const raw = await AsyncStorage.getItem(EDITOR_DRAFT_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Invalid draft record');
        }
        const record = parsed as Record<string, unknown>;
        if (
          record.version !== EDITOR_DRAFT_VERSION ||
          typeof record.title !== 'string' ||
          typeof record.text !== 'string' ||
          (record.category !== undefined && !NOTE_CATEGORIES.includes(record.category as NoteCategory)) ||
          !(record.editingId === null || typeof record.editingId === 'string')
        ) {
          throw new Error('Unsupported draft record');
        }

        if (record.title.trim() || record.text.trim()) {
          controller.dispatch({
            type: 'restore-draft',
            draft: { title: record.title, text: record.text, category: normalizeCategory(record.category) },
            editingId: record.editingId,
          });
          setView('editor');
        } else {
          await AsyncStorage.removeItem(EDITOR_DRAFT_KEY);
        }
      }
      setDraftStorageError(null);
      setDraftHydrated(true);
    } catch {
      // Keep an unreadable recovery record intact. A user can still edit and
      // deliberately replace it by starting to type into the editor.
      setDraftStorageError('An earlier recovery draft could not be read. Your saved notes are safe; start editing to replace the unreadable draft.');
      setDraftHydrated(false);
    }
  }, [controller]);

  useEffect(() => {
    // Restore React state from the storage completion callback, not the effect body.
    void controller.load().then(restoreEditorDraft);
  }, [controller, restoreEditorDraft]);

  useEffect(() => {
    if (!draftHydrated || status !== 'ready') return;
    const hasDraftContent = dirty && Boolean(state.draft.title.trim() || state.draft.text.trim());
    const serialized = hasDraftContent
      ? JSON.stringify({
          version: EDITOR_DRAFT_VERSION,
          title: state.draft.title,
          text: state.draft.text,
          category: normalizeCategory(state.draft.category),
          editingId: state.editingId,
          savedAt: new Date().toISOString(),
        })
      : null;

    const timer = setTimeout(() => {
      draftWriteQueue.current = draftWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (serialized === null) await AsyncStorage.removeItem(EDITOR_DRAFT_KEY);
          else await AsyncStorage.setItem(EDITOR_DRAFT_KEY, serialized);
          setDraftStorageError(null);
        })
        .catch(() => {
          setDraftStorageError('Your latest draft could not be saved for recovery. Keep the app open and save the note manually.');
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [draftHydrated, status, dirty, state.draft.title, state.draft.text, state.draft.category, state.editingId]);

  function changeDraft(field: 'title' | 'text', value: string) {
    if (!draftHydrated) {
      setDraftHydrated(true);
      setDraftStorageError(null);
    }
    dispatch({ type: 'change', field, value });
  }

  function selectDraftCategory(category: NoteCategory) {
    if (!draftHydrated) { setDraftHydrated(true); setDraftStorageError(null); }
    dispatch({ type: 'category', category });
    setCategoryPickerOpen(false);
  }

  function selectLibraryCategory(category: NoteCategory | 'all') {
    setCategoryFilter(category);
    setDrawerOpen(false);
    setView('library');
  }

  function confirmDiscard(continueAction: () => void) {
    if (!dirty) {
      continueAction();
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Your saved notes will not be changed.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: continueAction },
    ], { cancelable: true });
  }

  function openLibrary() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setDrawerOpen(false);
      setView('library');
    });
  }

  function openNewNote() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      setDrawerOpen(false);
      setView('editor');
    });
  }

  function editNote(id: string) {
    if (state.editingId === id) {
      setView('editor');
      return;
    }
    confirmDiscard(() => {
      dispatch({ type: 'edit', id });
      setView('editor');
    });
  }

  function handleBack() {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (view === 'editor') {
      openLibrary();
      return true;
    }
    return false;
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => subscription.remove();
  });

  function insertChecklistItem() {
    const current = state.draft.text;
    const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    const next = current + separator + '☐ ';
    if (characterCount({ ...state.draft, text: next }) > MAX_NOTE_CHARACTERS) {
      Alert.alert('Note is too long', 'Remove some text before adding a checklist item.');
      return;
    }
    changeDraft('text', next);
  }

  function toggleChecklistItem(noteId: string, lineIndex: number) {
    if (status !== 'ready') return;
    const note = state.notes.find(item => item.id === noteId);
    if (!note) return;
    const lines = note.text.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;
    const match = /^(\s*)(☐|☑)(\s)/.exec(line);
    if (!match) return;
    const replacement = match[2] === '☐' ? '☑' : '☐';
    lines[lineIndex] = match[1] + replacement + line.slice(match[1].length + match[2].length);
    void controller.updateNoteText(noteId, lines.join('\n'), new Date().toISOString());
  }

  function saveNote() {
    void controller.save(new Date().toISOString());
  }

  if (status === 'loading' || status === 'load-error') {
    return (
      <View style={styles.loadingScreen}>
        <Text accessibilityRole="header" style={styles.brand}>SnapNotes</Text>
        {status === 'loading'
          ? <Text accessibilityLiveRegion="polite" style={styles.hint}>Loading notes from this device…</Text>
          : <>
              <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>
              <Action label="Retry loading notes" onPress={() => { void controller.load().then(restoreEditorDraft); }} />
            </>}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.appHeader}>
        <View style={styles.headerTopRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open notes navigation"
            accessibilityState={{ expanded: drawerOpen }}
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Text style={styles.menuGlyph}>☰</Text>
          </Pressable>
          <View style={styles.brandGroup}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>S</Text></View>
            <View style={styles.brandCopy}>
              <Text accessibilityRole="header" style={styles.brand}>SnapNotes</Text>
              <Text style={styles.tagline}>Save Your Mind.</Text>
            </View>
          </View>
          <View style={styles.countPill} accessibilityLiveRegion="polite">
            <Text style={styles.countText}>{state.notes.length}</Text>
            <Text style={styles.countLabel}>{state.notes.length === 1 ? 'note' : 'notes'}</Text>
          </View>
        </View>
        <View style={styles.searchRow}>
          <Text style={styles.searchGlyph} accessibilityElementsHidden>⌕</Text>
          <TextInput
            accessibilityLabel="Search saved notes"
            autoCorrect={false}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search titles and note text"
            placeholderTextColor="#64748b"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearchQuery('')}
              style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}
            >
              <Text style={styles.clearSearchText}>×</Text>
            </Pressable>
          )}
        </View>
        {searching && view === 'library' && (
          <Text accessibilityLiveRegion="polite" style={styles.searchSummary}>
            {visibleNotes.length} of {state.notes.length} notes match
          </Text>
        )}
      </View>

      {view === 'editor' ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.viewHeading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>WRITE SOMETHING DOWN</Text>
                <Text accessibilityRole="header" style={styles.screenTitle}>
                  {state.editingId === null ? 'New note' : 'Edit note'}
                </Text>
              </View>
              <Action label="All notes" secondary onPress={openLibrary} disabled={saving} />
            </View>
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>Stored on this device</Text>
              <Text style={styles.warningText}>Saved notes survive app restarts, but are not encrypted, backed up to the cloud, or synced with the PWA. Clearing app data or uninstalling can remove them.</Text>
            </View>
            <View style={styles.editor}>
              <Text style={styles.label}>Category</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Choose note category" accessibilityState={{ expanded: categoryPickerOpen }} onPress={() => setCategoryPickerOpen(!categoryPickerOpen)} style={styles.categoryButton}>
                <Text style={styles.categoryButtonText}>{categoryLabel(normalizeCategory(state.draft.category))}  ▾</Text>
              </Pressable>
              {categoryPickerOpen && <View style={styles.categoryOptions}>{NOTE_CATEGORIES.map(category => (
                <Pressable key={category} accessibilityRole="button" accessibilityLabel={`Set category ${categoryLabel(category)}`} accessibilityState={{ selected: normalizeCategory(state.draft.category) === category }} onPress={() => selectDraftCategory(category)} style={styles.categoryOption}>
                  <Text style={styles.categoryButtonText}>{categoryLabel(category)}</Text>
                </Pressable>
              ))}</View>}
              <Text style={styles.label}>Title (optional)</Text>
              <TextInput
                editable={!saving}
                accessibilityLabel="Note title (optional)"
                value={state.draft.title}
                onChangeText={value => changeDraft('title', value)}
                placeholder="Give your note a title"
                placeholderTextColor="#64748b"
                style={styles.input}
                returnKeyType="next"
              />
              <View style={styles.editorTools}>
                <Text style={styles.label}>Note</Text>
                <Action label="+ Checklist item" secondary disabled={saving} onPress={insertChecklistItem} />
              </View>
              <TextInput
                editable={!saving}
                accessibilityLabel="Note body"
                value={state.draft.text}
                onChangeText={value => changeDraft('text', value)}
                placeholder="What's on your mind?"
                placeholderTextColor="#64748b"
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.bodyInput]}
              />
              <Text style={[styles.hint, count > MAX_NOTE_CHARACTERS && styles.error]}>
                {count}/{MAX_NOTE_CHARACTERS} characters
              </Text>
              <Text style={styles.hint}>Plain text only for now. The PWA’s “## ” title marker is included in the character count.</Text>
              {storageError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{storageError}</Text>}
              {draftStorageError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{draftStorageError}</Text>}
              {saving && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saving on this device…</Text>}
              {state.error !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.error}</Text>}
              {state.notice !== null && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
              <View style={styles.actions}>
                <Action disabled={saving} label={saving ? 'Saving…' : state.editingId === null ? 'Save note' : 'Save changes'} onPress={saveNote} />
                {(state.editingId !== null || dirty) && <Action disabled={saving} label="Cancel" onPress={openLibrary} secondary />}
                {state.editingId !== null && <Action disabled={saving} label="New note" onPress={openNewNote} secondary />}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.flex}>
          <View style={styles.libraryHeading}>
            <View>
              <Text style={styles.eyebrow}>YOUR WORKSPACE</Text>
              <Text accessibilityRole="header" style={styles.screenTitle}>{categoryFilter === 'all' ? 'All notes' : categoryLabel(categoryFilter)}</Text>
            </View>
            <Action label="+ New note" onPress={openNewNote} />
          </View>
          <Text style={styles.libraryHint}>{categoryFilter === 'all' ? 'Your saved notes, all in one place.' : `${visibleNotes.length} notes in ${categoryLabel(categoryFilter)}.`}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryFilterBar} contentContainerStyle={styles.categoryFilterItems}>
            {(['all', ...NOTE_CATEGORIES] as const).map(category => <Pressable key={category} accessibilityRole="button" accessibilityState={{ selected: categoryFilter === category }} onPress={() => setCategoryFilter(category)} style={[styles.categoryChip, categoryFilter === category && styles.categoryChipActive]}><Text style={[styles.categoryChipText, categoryFilter === category && styles.categoryChipTextActive]}>{category === 'all' ? 'All' : categoryLabel(category)}</Text></Pressable>)}
          </ScrollView>
          {storageError !== null && <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>}
          <FlatList
            data={visibleNotes}
            keyExtractor={note => note.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>{searching ? '⌕' : '+'}</Text></View>
                <Text accessibilityRole="header" style={styles.emptyTitle}>{searching ? 'No matching notes' : 'Your space is ready'}</Text>
                <Text style={styles.emptyText}>{searching ? 'Try another search or clear your query.' : 'Capture a thought before it slips away. Your first note starts here.'}</Text>
                {!searching && <Action label="Create your first note" onPress={openNewNote} />}
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.noteCardTop}>
                  <View style={styles.noteAccent} />
                  <Text accessibilityRole="header" style={styles.noteTitle}>{item.title || 'Untitled note'}</Text>
                </View>
                {item.text !== '' && (
                  <View style={styles.notePreview}>
                    {item.text.split('\n').slice(0, 6).map((line, index) => {
                      const checklist = /^(\s*)(☐|☑)(\s)(.*)$/.exec(line);
                      if (!checklist) return <Text key={index} style={styles.noteText}>{line || ' '}</Text>;
                      const checked = checklist[2] === '☑';
                      return (
                        <Pressable key={index} accessibilityRole="checkbox"
                          accessibilityState={{ checked, disabled: saving }}
                          accessibilityLabel={checklist[4] || 'Checklist item'}
                          onPress={() => toggleChecklistItem(item.id, index)}
                          disabled={saving}
                          style={styles.checklistRow}>
                          <Text style={styles.checkboxGlyph}>{checked ? '☑' : '☐'}</Text>
                          <ChecklistLabel text={checklist[4]} checked={checked} />
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <View style={styles.noteFooter}>
                  <Text style={styles.hint}>Updated {new Date(item.updatedAt).toLocaleDateString()}</Text>
                  <Pressable
                    disabled={saving}
                    accessibilityState={{ disabled: saving }}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.title || 'Untitled note'}`}
                    onPress={() => editNote(item.id)}
                    style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.editButtonText}>Open note ›</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </View>
      )}

      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.drawerLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            style={styles.drawerBackdrop}
            onPress={() => setDrawerOpen(false)}
          />
          <View style={styles.drawerPanel} accessibilityViewIsModal>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrand}>
                <View style={styles.brandMark}><Text style={styles.brandMarkText}>S</Text></View>
                <View>
                  <Text style={styles.drawerEyebrow}>LIBRARY</Text>
                  <Text accessibilityRole="header" style={styles.drawerTitle}>My notes</Text>
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notes navigation" onPress={() => setDrawerOpen(false)} style={styles.iconButton}>
                <Text style={styles.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <View style={styles.drawerNavigation}>
              <MenuRow label="All notes" detail={`${state.notes.length} saved ${state.notes.length === 1 ? 'note' : 'notes'}`} active={view === 'library'} onPress={openLibrary} />
              {NOTE_CATEGORIES.map(category => <MenuRow key={category} label={categoryLabel(category)} detail={`${state.notes.filter(note => normalizeCategory(note.category) === category).length} notes`} active={categoryFilter === category && view === 'library'} onPress={() => selectLibraryCategory(category)} />)}
              <MenuRow label="New note" detail="Capture a new thought" active={view === 'editor' && state.editingId === null} onPress={openNewNote} />
            </View>
            <View style={styles.drawerNotice}>
              <Text style={styles.drawerNoticeTitle}>More of SnapNotes is on the way</Text>
              <Text style={styles.drawerNoticeText}>Folders, archive, trash, settings, and account features will appear here as they are migrated and tested. They are not shown as active destinations yet.</Text>
            </View>
            <View style={styles.drawerFooter}>
              <Text style={styles.drawerFooterBrand}>SnapNotes Mobile</Text>
              <Text style={styles.drawerFooterText}>Save Your Mind.</Text>
            </View>
          </View>
        </View>
      </Modal>

      {view === 'library' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a new note"
          onPress={openNewNote}
          style={({ pressed }) => [styles.floatingAdd, pressed && styles.pressed]}
        >
          <Text style={styles.floatingAddText}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minHeight: 0 },
  screen: { flex: 1, backgroundColor: '#f7f9f5' },
  loadingScreen: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#f7f9f5' },
  appHeader: {
    backgroundColor: '#ffffff', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#e4eadf',
  },
  headerTopRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f3f7ef' },
  menuGlyph: { fontSize: 22, color: '#263b22' },
  brandGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#48a111' },
  brandMarkText: { color: '#ffffff', fontSize: 23, fontWeight: '900' },
  brandCopy: { minWidth: 0 },
  brand: { color: '#20351d', fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  tagline: { color: '#64715e', fontSize: 11, marginTop: 1 },
  countPill: { minWidth: 58, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: '#eef7e7' },
  countText: { color: '#347b0a', fontSize: 17, fontWeight: '800', lineHeight: 20 },
  countLabel: { color: '#55734a', fontSize: 10, fontWeight: '600' },
  searchRow: { minHeight: 44, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: '#dce5d5', borderRadius: 13, backgroundColor: '#f8faf6' },
  searchGlyph: { color: '#60715a', fontSize: 25, lineHeight: 30 },
  searchInput: { flex: 1, minWidth: 0, color: '#20351d', fontSize: 15, paddingVertical: 9 },
  clearSearch: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e8efe3' },
  clearSearchText: { color: '#3b5731', fontSize: 24, lineHeight: 26 },
  searchSummary: { marginTop: 7, marginLeft: 3, color: '#5d6e55', fontSize: 12 },
  libraryHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 5 },
  headingCopy: { flex: 1, gap: 4 },
  viewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: '#478f1b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  screenTitle: { color: '#20351d', fontSize: 27, fontWeight: '800', letterSpacing: -0.7, marginTop: 2 },
  libraryHint: { color: '#64715e', fontSize: 13, paddingHorizontal: 18, paddingBottom: 8 },
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 100, gap: 12, flexGrow: 1 },
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 45, gap: 12 },
  emptyMark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#eaf5e1', marginBottom: 3 },
  emptyMarkText: { color: '#48a111', fontSize: 34, fontWeight: '500' },
  emptyTitle: { color: '#20351d', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: '#64715e', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 290, marginBottom: 6 },
  warning: { padding: 14, borderRadius: 13, backgroundColor: '#fff6db', borderWidth: 1, borderColor: '#f1e1ad', gap: 4 },
  warningTitle: { color: '#79520a', fontSize: 13, fontWeight: '800' },
  warningText: { color: '#79520a', fontSize: 12, lineHeight: 18 },
  editorContent: { padding: 18, paddingBottom: 40, gap: 16 },
  editor: { backgroundColor: '#ffffff', borderColor: '#e0e8da', borderWidth: 1, borderRadius: 18, padding: 17, gap: 12 },
  label: { color: '#344b2d', fontSize: 14, fontWeight: '700' },
  input: { color: '#20351d', backgroundColor: '#f8faf6', borderColor: '#d5dfcd', borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  categoryButton: { padding: 12, borderRadius: 11, backgroundColor: '#eff7e9', borderWidth: 1, borderColor: '#dce6d4' },
  categoryButtonText: { color: '#304728', fontSize: 14, fontWeight: '700' },
  categoryOptions: { gap: 2, borderRadius: 11, borderWidth: 1, borderColor: '#dce6d4' },
  categoryOption: { padding: 12, minHeight: 42 },
  categoryFilterBar: { flexGrow: 0, maxHeight: 55 },
  categoryFilterItems: { paddingHorizontal: 18, paddingVertical: 7, gap: 7 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#edf2e9' },
  categoryChipActive: { backgroundColor: '#48a111' },
  categoryChipText: { color: '#3b5731', fontSize: 13 },
  categoryChipTextActive: { color: '#fff', fontWeight: '700' },
  editorTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  notePreview: { gap: 0 },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 28, paddingVertical: 2, gap: 8 },
  checkboxGlyph: { fontSize: 20, lineHeight: 24, includeFontPadding: false, flexShrink: 0, color: '#347b0a' },
  bodyInput: { minHeight: 190, maxHeight: 360, textAlignVertical: 'top' },
  hint: { color: '#687763', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 2 },
  button: { backgroundColor: '#48a111', borderRadius: 11, paddingHorizontal: 15, paddingVertical: 12, minHeight: 46, justifyContent: 'center', alignItems: 'center' },
  secondaryButton: { backgroundColor: '#f0f5eb', borderWidth: 1, borderColor: '#dce6d4' },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  secondaryText: { color: '#3b6f25' },
  pressed: { opacity: 0.7 },
  error: { color: '#b91c1c', fontSize: 14, lineHeight: 21 },
  notice: { color: '#26723b', fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: '#ffffff', borderColor: '#e2e9dc', borderWidth: 1, borderRadius: 16, padding: 15, gap: 10, shadowColor: '#213a1b', shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  noteCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  noteAccent: { width: 4, alignSelf: 'stretch', minHeight: 22, borderRadius: 4, backgroundColor: '#48a111' },
  noteTitle: { flex: 1, color: '#20351d', fontSize: 17, fontWeight: '800', lineHeight: 23 },
  noteText: { color: '#485843', fontSize: 14, lineHeight: 21 },
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: '#edf1e9' },
  editButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 10, backgroundColor: '#eff7e9' },
  editButtonText: { color: '#3b7f16', fontSize: 13, fontWeight: '800' },
  drawerLayer: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15, 28, 12, 0.42)' },
  drawerPanel: { width: '86%', maxWidth: 340, height: '100%', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 38 : 22, paddingBottom: 20, backgroundColor: '#ffffff', borderRightWidth: 1, borderRightColor: '#e1e9db' },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#e8eee3' },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerEyebrow: { color: '#478f1b', fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 3 },
  drawerTitle: { color: '#20351d', fontSize: 23, fontWeight: '800' },
  closeGlyph: { color: '#344b2d', fontSize: 29, lineHeight: 32 },
  drawerNavigation: { paddingTop: 15, gap: 7 },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 62, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  menuRowActive: { backgroundColor: '#eff7e9', borderColor: '#e0efd5' },
  menuRowCopy: { flex: 1, gap: 3 },
  menuRowTitle: { color: '#293d23', fontSize: 15, fontWeight: '700' },
  menuRowTitleActive: { color: '#3b7f16' },
  menuRowDetail: { color: '#6a7764', fontSize: 12 },
  menuChevron: { color: '#6a7764', fontSize: 25 },
  drawerNotice: { marginTop: 25, padding: 14, gap: 7, borderRadius: 14, backgroundColor: '#f7f9f5', borderWidth: 1, borderColor: '#e6ecdf' },
  drawerNoticeTitle: { color: '#334b2b', fontSize: 13, fontWeight: '800' },
  drawerNoticeText: { color: '#64715e', fontSize: 12, lineHeight: 18 },
  drawerFooter: { marginTop: 'auto', paddingTop: 18, borderTopWidth: 1, borderTopColor: '#e8eee3' },
  drawerFooterBrand: { color: '#304728', fontSize: 13, fontWeight: '800' },
  drawerFooterText: { color: '#73816d', fontSize: 12, marginTop: 3 },
  floatingAdd: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#48a111', elevation: 6, shadowColor: '#27600a', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  floatingAddText: { color: '#ffffff', fontSize: 34, lineHeight: 38, fontWeight: '400', marginTop: -2 },
});
