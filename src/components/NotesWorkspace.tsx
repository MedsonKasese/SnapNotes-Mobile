import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  characterCount, hasUnsavedChanges, MAX_NOTE_CHARACTERS, NOTE_CATEGORIES, normalizeCategory, sortNotesPinnedFirst, type NoteCategory,
} from '../notes';
import { createNotesController } from '../notesController';
import { deviceNotesStorage } from '../deviceNotesStorage';
import { searchNotes } from '../noteSearch';
import { ChecklistLabel } from './ChecklistLabel';

type WorkspaceView = 'library' | 'editor' | 'archive' | 'trash';
type NoteAction = 'pin' | 'archive' | 'restore-archive' | 'trash' | 'restore-trash' | 'delete';
const categoryLabel = (category: NoteCategory) => category.charAt(0).toUpperCase() + category.slice(1);

const EDITOR_DRAFT_KEY = '@snapnotes-mobile/editor-draft';
const EDITOR_DRAFT_VERSION = 1;

function Action({ label, onPress, secondary = false, destructive = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; destructive?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button, secondary && styles.secondaryButton, destructive && styles.destructiveButton,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText, destructive && styles.destructiveButtonText]}>{label}</Text>
    </Pressable>
  );
}

type FontAwesomeName = ComponentProps<typeof FontAwesome>['name'];

function MenuRow({ label, detail, icon, onPress, active = false }: {
  icon: FontAwesomeName;
  label: string; detail: string; onPress: () => void; active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, active && styles.menuRowActive, pressed && styles.pressed]}
    >
      <FontAwesome name={icon} size={18} color={active ? '#3b7f16' : '#65775c'} accessible={false} />
      <Text numberOfLines={1} style={[styles.menuRowTitle, active && styles.menuRowTitleActive]}>{label}</Text>
      {/^\d/.test(detail) ? <View style={styles.menuCountBadge}><Text style={styles.menuCountText}>{detail.split(' ')[0]}</Text></View> : <FontAwesome name="chevron-right" size={12} color="#6a7764" accessible={false} />}
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
  const [actionsNoteId, setActionsNoteId] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const draftWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const draftRecoveryRevision = useRef(0);
  const { state, status, storageError } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  // User intent takes ownership synchronously, before React can render again.
  // This also covers reset/edit actions that leave the editor clean or blank.
  function claimEditorDraft(hydrate: boolean) {
    draftRecoveryRevision.current += 1;
    if (hydrate) {
      setDraftHydrated(true);
      setDraftStorageError(null);
    }
  }
  const dispatch: typeof controller.dispatch = action => {
    const current = controller.getSnapshot().state.draft;
    // Merely choosing a category/navigation destination must not delete an
    // unreadable or still-pending recovery record from an otherwise empty editor.
    claimEditorDraft(draftHydrated || action.type === 'change' || action.type === 'edit' ||
      Boolean(current.title.trim() || current.text.trim()));
    controller.dispatch(action);
  };
  const saving = status === 'saving';
  const count = characterCount(state.draft);
  const dirty = hasUnsavedChanges(state);
  const activeNotes = state.notes.filter(note => !note.archived && note.deletedAt === null);
  const categoryNotes = activeNotes.filter(note => categoryFilter === 'all' || normalizeCategory(note.category) === categoryFilter);
  const archiveNotes = state.notes.filter(note => note.archived && note.deletedAt === null);
  const trashNotes = state.notes.filter(note => note.deletedAt !== null);
  const sourceNotes = view === 'trash' ? trashNotes : view === 'archive' ? archiveNotes : categoryNotes;
  const visibleNotes = sortNotesPinnedFirst(searchNotes(sourceNotes, searchQuery));
  const searching = searchQuery.trim().length > 0;

  const selected = state.notes.find(note => note.id === actionsNoteId);
  const inTrash = selected !== undefined && selected.deletedAt !== null;
  const inArchive = selected?.archived && !inTrash;
  const options: { label: string; icon: FontAwesomeName; destructive?: boolean; action: NoteAction }[] = !selected ? [] : inTrash
    ? [
        { label: 'Restore note', icon: 'undo', action: 'restore-trash' },
        { label: 'Delete forever', icon: 'trash', destructive: true, action: 'delete' },
      ]
    : [
        ...(!inArchive ? [{ label: selected.pinned ? 'Unpin note' : 'Pin note', icon: 'thumb-tack' as FontAwesomeName, action: 'pin' as NoteAction }] : []),
        { label: inArchive ? 'Restore from archive' : 'Archive note', icon: inArchive ? 'undo' : 'archive', action: inArchive ? 'restore-archive' : 'archive' },
        { label: 'Move to Trash', icon: 'trash-o', destructive: true, action: 'trash' },
      ];

  const restoreEditorDraft = useCallback(async () => {
    if (controller.getSnapshot().status !== 'ready') return;

    const revision = ++draftRecoveryRevision.current;
    try {
      const raw = await AsyncStorage.getItem(EDITOR_DRAFT_KEY);
      // A later recovery attempt or editor action supersedes this read, including
      // its error/cleanup paths. Never restore or delete storage from a stale read.
      if (revision !== draftRecoveryRevision.current) return;
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
          // A checklist save changes the saved collection, not the editor.
          // Its controller temporarily rejects dispatches, so wait rather than
          // losing this recovery record or pretending it was restored.
          if (controller.getSnapshot().status === 'saving') {
            await new Promise<void>(resolve => {
              const unsubscribe = controller.subscribe(() => {
                if (controller.getSnapshot().status !== 'saving') {
                  unsubscribe();
                  resolve();
                }
              });
            });
          }
          if (revision !== draftRecoveryRevision.current || controller.getSnapshot().status !== 'ready') return;
          controller.dispatch({
            type: 'restore-draft',
            draft: { title: record.title, text: record.text, category: normalizeCategory(record.category) },
            editingId: record.editingId,
          });
          setView('editor');
        }
      }
      // Empty records are cleared by the debounced write queue below, so a
      // slow recovery cleanup cannot overtake a newer user-owned draft write.
      if (revision !== draftRecoveryRevision.current) return;
      setDraftStorageError(null);
      setDraftHydrated(true);
    } catch {
      if (revision !== draftRecoveryRevision.current) return;
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
    dispatch({ type: 'change', field, value });
  }

  function selectDraftCategory(category: NoteCategory) {
    dispatch({ type: 'category', category });
    setCategoryPickerOpen(false);
  }

  function selectLibraryCategory(category: NoteCategory | 'all') {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter(category);
      setDrawerOpen(false);
      setView('library');
    });
  }

  function selectArchive() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter('all');
      setDrawerOpen(false);
      setView('archive');
    });
  }

  function selectTrash() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter('all');
      setDrawerOpen(false);
      setView('trash');
    });
  }
  function confirmTrash(id: string, title: string) {
    Alert.alert('Move to Trash?', 'Move "' + (title || 'Untitled note') + '" to Trash?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Trash', style: 'destructive', onPress: () => { void controller.moveToTrash(id, new Date().toISOString()); } },
    ]);
  }
  function confirmEmptyTrash() {
    if (trashNotes.length === 0 || saving) return;
    Alert.alert('Empty Trash?', `Permanently delete all ${trashNotes.length} trashed ${trashNotes.length === 1 ? 'note' : 'notes'}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Empty Trash', style: 'destructive', onPress: () => { void controller.emptyTrash(); } },
    ]);
  }
  function confirmPermanentDelete(id: string, title: string) {
    Alert.alert('Delete forever?', 'Permanently delete "' + (title || 'Untitled note') + '"? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete forever', style: 'destructive', onPress: () => { void controller.permanentlyDelete(id); } },
    ]);
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
    if (controller.getSnapshot().status !== 'ready') return;
    if (state.editingId === id) {
      setView('editor');
      return;
    }
    confirmDiscard(() => {
      dispatch({ type: 'edit', id });
      setView('editor');
    });
  }

  function showNoteActions(id: string) {
    setActionsNoteId(id);
  }

  function closeNoteActions() {
    setActionsNoteId(null);
  }

  function handleNoteAction(id: string, action: NoteAction) {
    const snapshot = controller.getSnapshot();
    if (snapshot.status !== 'ready') return;
    const selected = snapshot.state.notes.find(note => note.id === id);
    closeNoteActions();
    if (!selected) return;
    const now = new Date().toISOString();
    switch (action) {
      case 'pin': void controller.togglePin(id, now); break;
      case 'archive': void controller.setArchived(id, true, now); break;
      case 'restore-archive': void controller.setArchived(id, false, now); break;
      case 'trash': confirmTrash(id, selected.title); break;
      case 'restore-trash': void controller.restoreFromTrash(id, now); break;
      case 'delete': confirmPermanentDelete(id, selected.title); break;
    }
  }

  function handleBack() {
    if (actionsNoteId !== null) {
      closeNoteActions();
      return true;
    }
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (view === 'editor' || view === 'archive' || view === 'trash') {
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
    claimEditorDraft(draftHydrated || Boolean(state.draft.title.trim() || state.draft.text.trim()));
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
            <Text style={styles.countText}>{view === 'trash' ? trashNotes.length : view === 'archive' ? archiveNotes.length : activeNotes.length}</Text>
            <Text style={styles.countLabel}>{(view === 'trash' ? trashNotes.length : view === 'archive' ? archiveNotes.length : activeNotes.length) === 1 ? 'note' : 'notes'}</Text>
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
            {visibleNotes.length} of {categoryNotes.length} notes match
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
              <Action label="All notes" secondary onPress={() => selectLibraryCategory('all')} disabled={saving} />
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
              <Text accessibilityRole="header" style={styles.screenTitle}>{view === 'trash' ? 'Trash' : view === 'archive' ? 'Archived' : categoryFilter === 'all' ? 'All notes' : categoryLabel(categoryFilter)}</Text>
            </View>
            {view === 'trash' ? <Action label="Empty Trash" destructive onPress={confirmEmptyTrash} disabled={saving || trashNotes.length === 0} /> : <Action label="+ New note" onPress={openNewNote} />}
          </View>
          <Text style={styles.libraryHint}>{view === 'trash' ? `${trashNotes.length} trashed notes. Restore within 15 days or they are permanently deleted.` : view === 'archive' ? `${archiveNotes.length} archived ${archiveNotes.length === 1 ? 'note' : 'notes'}. Restore a note to return it to your library.` : categoryFilter === 'all' ? 'Your saved notes, all in one place.' : `${categoryNotes.length} notes in ${categoryLabel(categoryFilter)}.`}</Text>
          {view === 'library' && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryFilterBar} contentContainerStyle={styles.categoryFilterItems}>
            {(['all', ...NOTE_CATEGORIES] as const).map(category => <Pressable key={category} accessibilityRole="button" accessibilityState={{ selected: categoryFilter === category }} onPress={() => setCategoryFilter(category)} style={[styles.categoryChip, categoryFilter === category && styles.categoryChipActive]}><Text style={[styles.categoryChipText, categoryFilter === category && styles.categoryChipTextActive]}>{category === 'all' ? 'All' : categoryLabel(category)}</Text></Pressable>)}
          </ScrollView>}
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
                <Text accessibilityRole="header" style={styles.emptyTitle}>{searching ? 'No matching notes' : view === 'trash' ? 'Trash is empty' : view === 'archive' ? 'Your archive is empty' : categoryFilter !== 'all' ? `No notes in ${categoryLabel(categoryFilter)} yet` : 'Your space is ready'}</Text>
                <Text style={styles.emptyText}>{searching ? 'Try another search or clear your query.' : view === 'trash' ? 'Deleted notes appear here until you restore or permanently delete them.' : view === 'archive' ? 'Notes you archive will appear here. You can restore them at any time.' : categoryFilter !== 'all' ? 'Choose another category or create a note and assign it to this category.' : 'Capture a thought before it slips away. Your first note starts here.'}</Text>
                {!searching && view === 'library' && <Action label={categoryFilter === 'all' ? 'Create your first note' : 'Create a note'} onPress={openNewNote} />}
              </View>
            }
            renderItem={({ item }) => (
              // Keep nested checkboxes/menu independently reachable by screen readers.
              // The actions sheet provides their explicit Open note control.
              <Pressable style={styles.card} accessible={false} disabled={view === 'trash'} onPress={() => editNote(item.id)} accessibilityRole="button" accessibilityLabel={`Open ${item.title || 'Untitled note'}`}>
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
                          accessibilityState={{ checked, disabled: saving || view === 'trash' }}
                          accessibilityLabel={checklist[4] || 'Checklist item'}
                          onPress={() => toggleChecklistItem(item.id, index)}
                          disabled={saving || view === 'trash'}
                          style={styles.checklistRow}>
                          <Text style={styles.checkboxGlyph}>{checked ? '☑' : '☐'}</Text>
                          <ChecklistLabel text={checklist[4]} checked={checked} />
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <View style={styles.noteFooter}>
                  <View style={styles.noteMeta}>
                    <Text numberOfLines={1} style={styles.noteCategoryBadge}>{categoryLabel(normalizeCategory(item.category))}</Text>
                    <Text numberOfLines={1} style={styles.noteTime}>Updated {new Date(item.updatedAt).toLocaleDateString()} · {new Date(item.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                  </View>
                  <View style={styles.noteFooterActions}>
                    {view === 'library' && <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={(item.pinned ? 'Unpin ' : 'Pin ') + (item.title || 'Untitled note')}
                      accessibilityState={{ selected: item.pinned, disabled: saving }}
                      disabled={saving}
                      onPress={() => { void controller.togglePin(item.id, new Date().toISOString()); }}
                      style={({ pressed }) => [styles.pinButton, pressed && styles.pressed]}
                    >
                      <FontAwesome name="thumb-tack" size={18} color={item.pinned ? '#b98500' : '#8c9988'} accessible={false} />
                    </Pressable>}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={'Note actions for ' + (item.title || 'Untitled note')}
                      accessibilityState={{ expanded: actionsNoteId === item.id }}
                      onPress={() => showNoteActions(item.id)}
                      style={({ pressed }) => [styles.noteMenuTrigger, pressed && styles.pressed]}
                    >
                      <FontAwesome name="ellipsis-v" size={19} color="#687567" accessible={false} />
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            )}
          />
        </View>
      )}

      <Modal visible={actionsNoteId !== null} transparent animationType="fade" onRequestClose={closeNoteActions}>
        <View style={styles.actionsModalLayer}>
          <Pressable style={styles.actionsBackdrop} accessibilityRole="button" accessibilityLabel="Close note actions" onPress={closeNoteActions} />
          <View style={styles.actionsSheet} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.actionsSheetTitle}>Note actions</Text>
            {selected && selected.deletedAt === null && (
              <Pressable accessibilityRole="button" accessibilityLabel={'Open note: ' + (selected.title || 'Untitled note')}
                disabled={saving} accessibilityState={{ disabled: saving }}
                onPress={() => {
                  if (controller.getSnapshot().status !== 'ready') return;
                  closeNoteActions();
                  editNote(selected.id);
                }}
                style={({ pressed }) => [styles.actionsSheetRow, pressed && styles.pressed]}>
                <FontAwesome name="file-text-o" size={19} color="#52634b" accessible={false} />
                <Text style={styles.actionsSheetRowText}>Open note</Text>
              </Pressable>
            )}
            {selected && options.map(option => (
              <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label + ': ' + (selected.title || 'Untitled note')}
                disabled={saving} accessibilityState={{ disabled: saving }}
                onPress={() => handleNoteAction(selected.id, option.action)}
                style={({ pressed }) => [styles.actionsSheetRow, pressed && styles.pressed]}>
                <FontAwesome name={option.icon} size={19} color={option.destructive ? '#b3261e' : '#52634b'} accessible={false} />
                <Text style={[styles.actionsSheetRowText, option.destructive && styles.actionsSheetDanger]}>{option.label}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={closeNoteActions} style={styles.actionsSheetCancel}><Text style={styles.actionsSheetCancelText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

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
              <MenuRow label="All notes" icon="inbox" detail={`${activeNotes.length} saved ${activeNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'library' && categoryFilter === 'all'} onPress={() => selectLibraryCategory('all')} />
              {NOTE_CATEGORIES.map(category => <MenuRow key={category} icon={({ general: "sticky-note-o", work: "briefcase", personal: "user", ideas: "lightbulb-o", important: "star" } as const)[category]} label={categoryLabel(category)} detail={`${activeNotes.filter(note => normalizeCategory(note.category) === category).length} notes`} active={categoryFilter === category && view === 'library'} onPress={() => selectLibraryCategory(category)} />)}
              <MenuRow label="Archived" icon="archive" detail={`${archiveNotes.length} archived ${archiveNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'archive'} onPress={selectArchive} />
              <MenuRow label="Trash" icon="trash" detail={`${trashNotes.length} trashed notes`} active={view === 'trash'} onPress={selectTrash} />
               <MenuRow label="New note" icon="plus" detail="Capture a new thought" active={view === 'editor' && state.editingId === null} onPress={openNewNote} />
            </View>
            <View style={styles.drawerNotice}>
              <Text style={styles.drawerNoticeTitle}>More of SnapNotes is on the way</Text>
              <Text style={styles.drawerNoticeText}>Folders, settings, and account features will appear here as they are migrated and tested.</Text>
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
  categoryFilterBar: { flexGrow: 0, height: 55, maxHeight: 55 },
  categoryFilterItems: { paddingHorizontal: 18, paddingVertical: 7, gap: 7, alignItems: 'center' },
  categoryChip: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#edf2e9', alignItems: 'center', justifyContent: 'center' },
  categoryChipActive: { backgroundColor: '#48a111' },
  categoryChipText: { color: '#3b5731', fontSize: 13, lineHeight: 18, includeFontPadding: false, textAlign: 'center' },
  categoryChipTextActive: { color: '#fff', fontWeight: '700' },
  editorTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  notePreview: { gap: 0 },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 28, paddingVertical: 2, gap: 8 },
  checkboxGlyph: { fontSize: 20, lineHeight: 24, includeFontPadding: false, flexShrink: 0, color: '#347b0a' },
  bodyInput: { minHeight: 190, maxHeight: 360, textAlignVertical: 'top' },
  hint: { color: '#687763', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 2 },
  button: { backgroundColor: '#48a111', borderRadius: 11, paddingHorizontal: 15, paddingVertical: 12, minHeight: 46, justifyContent: 'center', alignItems: 'center' },
  destructiveButton: { backgroundColor: '#b3261e' },
  destructiveButtonText: { color: '#ffffff' },
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
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e4e8e1', minHeight: 42 },
  noteFooterActions: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  noteMenuTrigger: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  actionsModalLayer: { flex: 1, justifyContent: 'flex-end' },
  actionsBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15, 28, 12, 0.45)' },
  actionsSheet: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 30, backgroundColor: '#ffffff', borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 3 },
  actionsSheetTitle: { fontSize: 18, fontWeight: '800', color: '#20351d', marginBottom: 12 },
  actionsSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 50, paddingHorizontal: 12, borderRadius: 10 },
  actionsSheetRowText: { color: '#293d23', fontSize: 15, fontWeight: '600' },
  actionsSheetDanger: { color: '#b3261e' },
  actionsSheetCancel: { minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 12, backgroundColor: '#f0f5eb', borderRadius: 12 },
  actionsSheetCancelText: { color: '#344b2d', fontWeight: '800' },
  pinButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'transparent' },
  pinButtonActive: { backgroundColor: 'transparent' },
  archiveButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'transparent' },

  noteMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteCategoryBadge: { color: '#687b69', fontSize: 11, fontWeight: '700', backgroundColor: '#eef3ef', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, overflow: 'hidden', flexShrink: 0 },
  noteTime: { color: '#7a857c', fontSize: 11, flexShrink: 1 },
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
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  menuRowActive: { backgroundColor: '#eff7e9', borderColor: '#e0efd5' },

  menuCountBadge: { marginLeft: 'auto', minWidth: 32, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, alignItems: 'center', backgroundColor: '#edf3eb' },
  menuCountText: { color: '#61705b', fontSize: 12, fontWeight: '700' },
  menuRowTitle: { flex: 1, color: '#293d23', fontSize: 15, fontWeight: '700' },
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
