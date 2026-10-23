import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ComponentRef } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  characterCount, hasUnsavedChanges, MAX_NOTE_CHARACTERS, MAX_NOTE_HTML_LENGTH, NOTE_CATEGORIES, normalizeCategory, sortNotesPinnedFirst, type NoteCategory,
} from '../notes';
import { createNotesController } from '../notesController';
import { FOLDERS_KEY, MAX_FOLDERS, makeFolderId, normalizeFolderName, parseFolders, validateFolderName, type Folder } from '../folders';
import { deviceNotesStorage } from '../deviceNotesStorage';
import { searchNotes } from '../noteSearch';
import { getNoteActionsMenuLayout, type MenuRect } from '../noteActionsMenu';
import { ChecklistLabel } from './ChecklistLabel';
import { getNoteHtmlLines, normalizeNoteLink, noteHtmlToText, sanitizeNoteHtml, updateChecklistHtml } from '../noteFormatting';
import { FormattedText } from './FormattedText';
import { FormattingToolbar } from './FormattingToolbar';
import { RichNoteEditor, type FormattingAction, type FormattingState, type RichContent, type RichNoteEditorHandle } from './RichNoteEditor';

type WorkspaceView = 'library' | 'editor' | 'archive' | 'trash' | 'folder';
type NoteAction = 'move-folder' | 'duplicate' | 'archive' | 'restore-archive' | 'trash' | 'restore-trash' | 'delete';
type NoteActionOption = { label: string; icon: FontAwesomeName; destructive?: boolean; action: NoteAction };
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

function NoteActionsMenuContent({ title, canOpen, saving, options, onOpen, onAction }: {
  title: string; canOpen: boolean; saving: boolean; options: NoteActionOption[];
  onOpen: () => void; onAction: (action: NoteAction) => void;
}) {
  return (
    <ScrollView style={styles.actionsMenuScroll} keyboardShouldPersistTaps="handled">
      {canOpen && (
        <Pressable accessibilityRole="button" accessibilityLabel={'Open note: ' + title}
          disabled={saving} accessibilityState={{ disabled: saving }} onPress={onOpen}
          style={({ pressed }) => [styles.actionsMenuRow, pressed && styles.actionsMenuRowPressed]}>
          <FontAwesome name="file-text-o" size={19} color="#52634b" style={styles.actionsMenuIcon} accessible={false} />
          <Text style={styles.actionsMenuText}>Open note</Text>
        </Pressable>
      )}
      {options.map(option => (
        <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label + ': ' + title}
          disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => onAction(option.action)}
          style={({ pressed }) => [styles.actionsMenuRow, pressed && styles.actionsMenuRowPressed]}>
          <FontAwesome name={option.icon} size={19} color={option.destructive ? '#b3261e' : '#52634b'} style={styles.actionsMenuIcon} accessible={false} />
          <Text style={[styles.actionsMenuText, option.destructive && styles.actionsMenuDanger]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function NotesWorkspace() {
  const [controller] = useState(() => createNotesController(deviceNotesStorage));
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>('library');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [foldersReady, setFoldersReady] = useState(false);
  const [foldersSaving, setFoldersSaving] = useState(false);
  const foldersRef = useRef<Folder[]>([]);
  const folderMutationInFlight = useRef(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: 'create' | 'rename'; id?: string } | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderMoveNoteId, setFolderMoveNoteId] = useState<string | null>(null);
  const [actionsNoteId, setActionsNoteId] = useState<string | null>(null);
  const [actionsAnchor, setActionsAnchor] = useState<MenuRect | null>(null);
  const [actionsViewport, setActionsViewport] = useState<MenuRect | null>(null);
  const [actionsMenuHeight, setActionsMenuHeight] = useState(0);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [formattingState, setFormattingState] = useState<FormattingState>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const bodyEditor = useRef<RichNoteEditorHandle>(null);
  const editorSession = useRef(0);
  const saveInFlight = useRef(false);
  const actionTriggers = useRef(new Map<string, ComponentRef<typeof View>>());
  const actionsLayer = useRef<ComponentRef<typeof View> | null>(null);
  const actionsRequest = useRef<{ id: string | null; revision: number }>({ id: null, revision: 0 });
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
    claimEditorDraft(draftHydrated || action.type === 'change' || action.type === 'rich-change' || action.type === 'edit' ||
      Boolean(current.title.trim() || current.text.trim()));
    if (action.type === 'reset' || action.type === 'edit' || action.type === 'restore-draft') {
      editorSession.current += 1;
      setFormattingState({});
      setLinkOpen(false);
    }
    controller.dispatch(action);
  };
  const saving = status === 'saving' || flushing;
  const count = characterCount(state.draft);
  const dirty = hasUnsavedChanges(state);
  const activeNotes = state.notes.filter(note => !note.archived && note.deletedAt === null);
  const categoryNotes = activeNotes.filter(note => categoryFilter === 'all' || normalizeCategory(note.category) === categoryFilter);
  const archiveNotes = state.notes.filter(note => note.archived && note.deletedAt === null);
  const trashNotes = state.notes.filter(note => note.deletedAt !== null);
  const sourceNotes = view === 'trash' ? trashNotes : view === 'archive' ? archiveNotes : view === 'folder' ? activeNotes.filter(note => note.folderId === activeFolderId) : categoryNotes;
  const visibleNotes = sortNotesPinnedFirst(searchNotes(sourceNotes, searchQuery));
  const searching = searchQuery.trim().length > 0;

  const selected = state.notes.find(note => note.id === actionsNoteId);
  const inTrash = selected !== undefined && selected.deletedAt !== null;
  const inArchive = selected?.archived && !inTrash;
  const options: NoteActionOption[] = !selected ? [] : inTrash
    ? [
        { label: 'Restore note', icon: 'undo', action: 'restore-trash' },
        { label: 'Delete forever', icon: 'trash', destructive: true, action: 'delete' },
      ]
    : [
        { label: 'Duplicate note', icon: 'clone', action: 'duplicate' },
        { label: 'Move to folder', icon: 'folder-o', action: 'move-folder' },
        { label: inArchive ? 'Restore from archive' : 'Archive note', icon: inArchive ? 'undo' : 'archive', action: inArchive ? 'restore-archive' : 'archive' },
        { label: 'Move to Trash', icon: 'trash-o', destructive: true, action: 'trash' },
      ];

  const actionsMenuLayout = actionsAnchor && actionsViewport
    ? getNoteActionsMenuLayout(actionsAnchor, actionsViewport, actionsMenuHeight)
    : null;
  const actionsMenuReady = actionsMenuLayout !== null && actionsMenuLayout.width > 0 &&
    actionsMenuLayout.maxHeight > 0 && actionsMenuHeight > 0;

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
          (record.html !== undefined && (typeof record.html !== 'string' || record.html.length > MAX_NOTE_HTML_LENGTH)) ||
          (record.category !== undefined && !NOTE_CATEGORIES.includes(record.category as NoteCategory)) ||
          !(record.editingId === null || typeof record.editingId === 'string')
        ) {
          throw new Error('Unsupported draft record');
        }
        if (typeof record.html === 'string' && noteHtmlToText(record.html).trim() !== record.text.replace(/\r/g, '').trim()) {
          throw new Error('Rich draft text does not match its formatting');
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
            draft: { title: record.title, text: record.text, category: normalizeCategory(record.category),
              ...(typeof record.html === 'string' ? { html: sanitizeNoteHtml(record.html) } : {}) },
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
          ...(state.draft.html !== undefined ? { html: state.draft.html } : {}),
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
  }, [draftHydrated, status, dirty, state.draft.title, state.draft.text, state.draft.html, state.draft.category, state.editingId]);

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

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(FOLDERS_KEY).then(raw => {
      const loaded = parseFolders(raw);
      if (active) { foldersRef.current = loaded; setFolders(loaded); setFoldersReady(true); setFolderError(null); }
    }).catch(() => {
      if (active) { setFoldersReady(false); setFolderError('Folders could not be loaded. Existing folders have not been changed.'); }
    });
    return () => { active = false; };
  }, []);

  async function persistFolders(next: Folder[], failureMessage = 'Could not save folders. No folder changes were applied.'): Promise<boolean> {
    if (!foldersReady) return false;
    try {
      await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
      foldersRef.current = next;
      setFolders(next);
      setFolderError(null);
      return true;
    } catch {
      setFolderError(failureMessage);
      return false;
    }
  }

  function selectFolder(id: string) {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setActiveFolderId(id);
      setDrawerOpen(false);
      setView('folder');
    });
  }

  function openFolderDialog(mode: 'create' | 'rename', folder?: Folder) {
    if (!foldersReady || folderMutationInFlight.current) return;
    setDrawerOpen(false);
    setFolderName(folder?.name ?? '');
    setFolderDialog({ mode, id: folder?.id });
  }

  async function submitFolder() {
    if (!folderDialog || !foldersReady || folderMutationInFlight.current) return;
    const current = foldersRef.current;
    if (folderDialog.mode === 'rename' && !current.some(folder => folder.id === folderDialog.id)) return;
    const name = normalizeFolderName(folderName);
    const error = validateFolderName(current, name, folderDialog.id);
    if (error) { Alert.alert('Folder name', error); return; }
    const now = new Date().toISOString();
    const next = folderDialog.mode === 'create'
      ? [...current, { id: makeFolderId(current, now), name, icon: 'folder', color: '', createdAt: now, updatedAt: now }]
      : current.map(folder => folder.id === folderDialog.id ? { ...folder, name, updatedAt: now } : folder);
    // A ref closes the pre-render double-tap window; state also disables controls.
    folderMutationInFlight.current = true;
    setFoldersSaving(true);
    try {
      if (await persistFolders(next)) setFolderDialog(null);
    } finally {
      folderMutationInFlight.current = false;
      setFoldersSaving(false);
    }
  }

  function confirmDeleteFolder(folder: Folder) {
    if (!foldersReady || folderMutationInFlight.current || controller.getSnapshot().status !== 'ready') return;
    const count = state.notes.filter(note => note.folderId === folder.id).length;
    Alert.alert('Delete folder?', `Delete "${folder.name}"? ${count} ${count === 1 ? 'note' : 'notes'} will remain in SnapNotes, without a folder.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete folder', style: 'destructive', onPress: () => {
        void (async () => {
          if (!foldersReady || folderMutationInFlight.current || controller.getSnapshot().status !== 'ready' ||
            !foldersRef.current.some(item => item.id === folder.id)) return;
          folderMutationInFlight.current = true;
          setFoldersSaving(true);
          try {
            // Hold the lock across both writes so no move can refile a note in
            // the gap after unfiling commits and before folder deletion commits.
            const unfiled = await controller.clearFolder(folder.id);
            if (!unfiled) return;
            const ok = await persistFolders(foldersRef.current.filter(item => item.id !== folder.id),
              'Could not delete the folder. The folder remains, but its notes are safely unfiled. Please try again.');
            if (ok && activeFolderId === folder.id) { setActiveFolderId(null); setView('library'); }
          } finally {
            folderMutationInFlight.current = false;
            setFoldersSaving(false);
          }
        })();
      } },
    ]);
  }

  function chooseFolder(noteId: string) {
    if (folderMutationInFlight.current) return;
    if (!foldersReady) { Alert.alert('Folders unavailable', folderError ?? 'Wait for folders to load.'); return; }
    setFolderMoveNoteId(noteId);
  }

  function moveNoteToFolder(folderId: string | null) {
    if (!foldersReady || folderMutationInFlight.current || controller.getSnapshot().status !== 'ready') return;
    if (folderId !== null && !foldersRef.current.some(folder => folder.id === folderId)) return;
    const id = folderMoveNoteId;
    setFolderMoveNoteId(null);
    if (id) void controller.moveNoteToFolder(id, folderId);
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

  function measureActionsMenu(id: string | null) {
    if (id === null || actionsRequest.current.id !== id) return;
    const trigger = actionTriggers.current.get(id);
    const layer = actionsLayer.current;
    if (!trigger || !layer) return;
    const revision = ++actionsRequest.current.revision;
    // Both rectangles use native window coordinates. The measured safe-area
    // layer origin is subtracted by the placement helper, not guessed from bars.
    layer.measureInWindow((x, y, width, height) => {
      if (revision !== actionsRequest.current.revision || width <= 0 || height <= 0 ||
        ![x, y, width, height].every(Number.isFinite)) return;
      trigger.measureInWindow((anchorX, anchorY, anchorWidth, anchorHeight) => {
        if (revision !== actionsRequest.current.revision || anchorWidth <= 0 || anchorHeight <= 0 ||
          ![anchorX, anchorY, anchorWidth, anchorHeight].every(Number.isFinite)) return;
        setActionsViewport({ x, y, width, height });
        setActionsAnchor({ x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight });
      });
    });
  }

  function showNoteActions(id: string) {
    actionsRequest.current = { id, revision: actionsRequest.current.revision + 1 };
    setActionsAnchor(null);
    setActionsViewport(null);
    setActionsMenuHeight(0);
    Keyboard.dismiss();
    setActionsNoteId(id);
    measureActionsMenu(id);
  }

  function closeNoteActions() {
    // Late native measurements must never move or revive a dismissed menu.
    actionsRequest.current = { id: null, revision: actionsRequest.current.revision + 1 };
    setActionsNoteId(null);
    setActionsAnchor(null);
    setActionsViewport(null);
    setActionsMenuHeight(0);
  }

  function handleNoteAction(id: string, action: NoteAction) {
    const snapshot = controller.getSnapshot();
    if (snapshot.status !== 'ready') return;
    const selected = snapshot.state.notes.find(note => note.id === id);
    closeNoteActions();
    if (!selected) return;
    const now = new Date().toISOString();
    switch (action) {
      case 'move-folder': chooseFolder(id); break;
      case 'duplicate': void controller.duplicateNote(id, now); break;
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
    if (view === 'editor' || view === 'archive' || view === 'trash' || view === 'folder') {
      openLibrary();
      return true;
    }
    return false;
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => subscription.remove();
  });

  function changeRichDraft(content: RichContent) {
    dispatch({ type: 'rich-change', ...content });
  }

  function formatNote(action: FormattingAction) {
    if (saving || !editorReady) return;
    if (action === 'link') {
      bodyEditor.current?.rememberSelection();
      setLinkUrl('');
      setLinkError(null);
      setLinkOpen(true);
    } else bodyEditor.current?.command(action);
  }

  function insertLink() {
    const url = normalizeNoteLink(linkUrl);
    if (!url) {
      setLinkError('Enter a complete https://, http://, or mailto: link.');
      return;
    }
    if (saving || !editorReady) return;
    setLinkOpen(false);
    bodyEditor.current?.command('link', url);
  }

  function toggleChecklistItem(noteId: string, lineIndex: number) {
    if (status !== 'ready') return;
    const note = state.notes.find(item => item.id === noteId);
    if (!note) return;
    const lines = note.text.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;
    const match = /^(\s*)(☐|☑)(\s|$)/.exec(line);
    if (!match) return;
    const replacement = match[2] === '☐' ? '☑' : '☐';
    lines[lineIndex] = match[1] + replacement + line.slice(match[1].length + match[2].length);
    const html = note.html !== undefined ? updateChecklistHtml(note.html, lineIndex, replacement === '☑') : undefined;
    void controller.updateNoteText(noteId, lines.join('\n'), new Date().toISOString(), html);
  }

  async function saveNote() {
    if (saveInFlight.current || controller.getSnapshot().status !== 'ready') return;
    saveInFlight.current = true;
    setFlushing(true);
    const session = editorSession.current;
    try {
      const content = await bodyEditor.current?.getContent();
      if (!content) throw new Error('The editor is not ready. Please try saving again.');
      if (session !== editorSession.current) return;
      const current = controller.getSnapshot().state.draft;
      // A blank Save is validation, not consent to replace an unreadable recovery record.
      if (content.text.trim() || current.text.trim() || current.title.trim() || current.html !== undefined) {
        changeRichDraft(content);
      }
      await controller.save(new Date().toISOString());
    } catch (error) {
      Alert.alert('Could not save note', error instanceof Error ? error.message : 'Your draft is still here. Please try again.');
    } finally {
      saveInFlight.current = false;
      setFlushing(false);
    }
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

      {folderError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{folderError}</Text>}
      {foldersSaving && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saving folders on this device…</Text>}

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
                <FormattingToolbar disabled={saving || !editorReady} active={formattingState} onAction={formatNote} />
              </View>
              <RichNoteEditor
                key={state.editingId ?? 'new-note'}
                ref={bodyEditor}
                editable={!saving}
                accessibilityLabel="Note body"
                text={state.draft.text}
                html={state.draft.html}
                onChange={changeRichDraft}
                onReady={setEditorReady}
                onSelection={setFormattingState}
              />
              <Text style={[styles.hint, count > MAX_NOTE_CHARACTERS && styles.error]}>
                {count}/{MAX_NOTE_CHARACTERS} characters
              </Text>
              <Text style={styles.hint}>Select text to format it, or choose a tool before typing. The PWA’s “## ” title marker is included in the character count.</Text>
              {storageError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{storageError}</Text>}
              {draftStorageError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{draftStorageError}</Text>}
              {saving && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saving on this device…</Text>}
              {state.error !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.error}</Text>}
              {state.notice !== null && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
              <View style={styles.actions}>
                <Action disabled={saving || !editorReady} label={saving ? 'Saving…' : state.editingId === null ? 'Save note' : 'Save changes'} onPress={() => { void saveNote(); }} />
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
              <Text accessibilityRole="header" style={styles.screenTitle}>{view === 'trash' ? 'Trash' : view === 'archive' ? 'Archived' : view === 'folder' ? folders.find(folder => folder.id === activeFolderId)?.name ?? 'Folder' : categoryFilter === 'all' ? 'All notes' : categoryLabel(categoryFilter)}</Text>
            </View>
            {view === 'trash' ? <Action label="Empty Trash" destructive onPress={confirmEmptyTrash} disabled={saving || trashNotes.length === 0} /> : <Action label="+ New note" onPress={openNewNote} />}
          </View>
          <Text style={styles.libraryHint}>{view === 'trash' ? `${trashNotes.length} trashed notes. Restore within 15 days or they are permanently deleted.` : view === 'folder' ? `${sourceNotes.length} notes in this folder.` : view === 'archive' ? `${archiveNotes.length} archived ${archiveNotes.length === 1 ? 'note' : 'notes'}. Restore a note to return it to your library.` : categoryFilter === 'all' ? 'Your saved notes, all in one place.' : `${categoryNotes.length} notes in ${categoryLabel(categoryFilter)}.`}</Text>
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
            renderItem={({ item }) => {
              const formattedLines = item.html ? getNoteHtmlLines(item.html) : undefined;
              return (
              // Keep nested checkboxes/menu independently reachable by screen readers.
              // The contextual menu provides their explicit Open note control.
              <Pressable style={styles.card} accessible={false} disabled={view === 'trash'} onPress={() => editNote(item.id)} accessibilityRole="button" accessibilityLabel={`Open ${item.title || 'Untitled note'}`}>
                <View style={styles.noteCardTop}>
                  <View style={styles.noteAccent} />
                  <Text accessibilityRole="header" style={styles.noteTitle}>{item.title || 'Untitled note'}</Text>
                </View>
                {item.text !== '' && (
                  <View style={styles.notePreview}>
                    {item.text.split('\n').slice(0, 6).map((line, index) => {
                      const checklist = /^(\s*)(☐|☑)(\s|$)(.*)$/.exec(line);
                      const formatted = formattedLines?.[index];
                      if (!checklist) return <Text key={index} style={styles.noteText}><FormattedText line={formatted} fallback={line || ' '} /></Text>;
                      const checked = checklist[2] === '☑';
                      return (
                        <Pressable key={index} accessibilityRole="checkbox"
                          accessibilityState={{ checked, disabled: saving || view === 'trash' }}
                          accessibilityLabel={checklist[4] || 'Checklist item'}
                          onPress={() => toggleChecklistItem(item.id, index)}
                          disabled={saving || view === 'trash'}
                          style={styles.checklistRow}>
                          <Text style={styles.checkboxGlyph}>{checked ? '☑' : '☐'}</Text>
                          <ChecklistLabel text={checklist[4]} checked={checked}>
                            <FormattedText line={formatted} fallback={checklist[4]} skipChecklistMarker />
                          </ChecklistLabel>
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
                      ref={node => {
                        if (node) actionTriggers.current.set(item.id, node);
                        else actionTriggers.current.delete(item.id);
                      }}
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
              );
            }}
          />
        </View>
      )}

      <Modal visible={actionsNoteId !== null} transparent animationType="fade"
        onShow={() => measureActionsMenu(actionsNoteId)} onRequestClose={closeNoteActions}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.flex}>
            <View ref={actionsLayer} style={styles.actionsModalLayer} testID="note-actions-layer"
              onLayout={() => measureActionsMenu(actionsNoteId)}>
              <Pressable style={styles.actionsBackdrop} accessibilityRole="button" accessibilityLabel="Close note actions" onPress={closeNoteActions} />
              <View testID="note-actions-menu" accessibilityLabel="Note actions" accessibilityViewIsModal
                onAccessibilityEscape={closeNoteActions}
                accessibilityElementsHidden={!actionsMenuReady} importantForAccessibility={actionsMenuReady ? 'auto' : 'no-hide-descendants'}
                pointerEvents={actionsMenuReady ? 'auto' : 'none'}
                onLayout={event => setActionsMenuHeight(event.nativeEvent.layout.height)}
                style={[styles.actionsMenu, actionsMenuLayout, !actionsMenuReady && styles.actionsMenuMeasuring]}>
                {selected && <NoteActionsMenuContent title={selected.title || 'Untitled note'} canOpen={selected.deletedAt === null}
                  saving={saving} options={options}
                  onOpen={() => {
                    if (controller.getSnapshot().status !== 'ready') return;
                    closeNoteActions();
                    editNote(selected.id);
                  }}
                  onAction={action => handleNoteAction(selected.id, action)} />}
              </View>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={folderDialog !== null} transparent animationType="fade" onRequestClose={() => { if (!folderMutationInFlight.current) setFolderDialog(null); }}>
        <KeyboardAvoidingView style={styles.folderModalLayer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.folderModalCard} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.label}>{folderDialog?.mode === 'rename' ? 'Rename folder' : 'New folder'}</Text>
          <TextInput accessibilityLabel="Folder name" autoFocus editable={!foldersSaving} maxLength={32} value={folderName} onChangeText={setFolderName} placeholder="Folder name" style={styles.input} />
          {folderError !== null && <Text accessibilityRole="alert" style={styles.error}>{folderError}</Text>}
          <View style={styles.folderControls}><Action label="Cancel" secondary disabled={foldersSaving} onPress={() => setFolderDialog(null)} /><Action label="Save folder" disabled={foldersSaving || !foldersReady} onPress={() => { void submitFolder(); }} /></View>
        </View></KeyboardAvoidingView>
      </Modal>
      <Modal visible={folderMoveNoteId !== null} transparent animationType="fade" onRequestClose={() => setFolderMoveNoteId(null)}>
        <View style={styles.folderModalLayer}><ScrollView style={styles.folderModalCard} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.label}>Move note to folder</Text>
          {[{ id: null, name: 'No folder' }, ...folders].map(folder => <Pressable key={folder.id ?? 'none'} accessibilityRole="button" disabled={saving || foldersSaving} accessibilityState={{ disabled: saving || foldersSaving }} onPress={() => moveNoteToFolder(folder.id)} style={styles.folderControl}><Text style={styles.folderControlText}>{folder.name}</Text></Pressable>)}
          <Action label="Cancel" secondary onPress={() => setFolderMoveNoteId(null)} />
        </ScrollView></View>
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
            <ScrollView style={styles.flex} contentContainerStyle={styles.drawerNavigation} keyboardShouldPersistTaps="handled">
              <MenuRow label="All notes" icon="inbox" detail={`${activeNotes.length} saved ${activeNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'library' && categoryFilter === 'all'} onPress={() => selectLibraryCategory('all')} />
              {NOTE_CATEGORIES.map(category => <MenuRow key={category} icon={({ general: "sticky-note-o", work: "briefcase", personal: "user", ideas: "lightbulb-o", important: "star" } as const)[category]} label={categoryLabel(category)} detail={`${activeNotes.filter(note => normalizeCategory(note.category) === category).length} notes`} active={categoryFilter === category && view === 'library'} onPress={() => selectLibraryCategory(category)} />)}
              <View style={styles.folderSectionHeading}>
                <Text style={styles.drawerEyebrow}>FOLDERS</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Create new folder"
                  disabled={!foldersReady || foldersSaving || folders.length >= MAX_FOLDERS}
                  accessibilityState={{ disabled: !foldersReady || foldersSaving || folders.length >= MAX_FOLDERS }}
                  onPress={() => openFolderDialog('create')}
                  style={({ pressed }) => [styles.folderAddButton, (pressed || !foldersReady || foldersSaving || folders.length >= MAX_FOLDERS) && styles.pressed]}>
                  <Text style={styles.folderAddText}>+ New Folder</Text>
                </Pressable>
              </View>
              {(foldersExpanded ? folders : folders.slice(0, 3)).map(folder =>
                <MenuRow key={folder.id} label={folder.name} icon="folder-o"
                  detail={`${activeNotes.filter(note => note.folderId === folder.id).length} notes`}
                  active={view === 'folder' && activeFolderId === folder.id} onPress={() => selectFolder(folder.id)} />)}
              {folders.length > 3 && <Pressable accessibilityRole="button"
                accessibilityLabel={foldersExpanded ? 'Show fewer folders' : `View all folders, ${folders.length}`}
                accessibilityState={{ expanded: foldersExpanded }}
                onPress={() => setFoldersExpanded(value => !value)}
                style={({ pressed }) => [styles.folderExpandButton, pressed && styles.pressed]}>
                <Text style={styles.folderExpandText}>{foldersExpanded ? 'Show fewer' : `View all folders (${folders.length})`}</Text>
                <FontAwesome name={foldersExpanded ? 'chevron-up' : 'chevron-down'} size={12} color="#3b7f16" accessible={false} />
              </Pressable>}
              {view === 'folder' && activeFolderId && folders.some(folder => folder.id === activeFolderId) && <View style={styles.folderControls}><Pressable accessibilityRole="button" disabled={foldersSaving} accessibilityState={{ disabled: foldersSaving }} onPress={() => openFolderDialog('rename', folders.find(folder => folder.id === activeFolderId))} style={styles.folderControl}><Text style={styles.folderControlText}>Rename folder</Text></Pressable><Pressable accessibilityRole="button" disabled={saving || foldersSaving} accessibilityState={{ disabled: saving || foldersSaving }} onPress={() => { setDrawerOpen(false); const folder = folders.find(item => item.id === activeFolderId); if (folder) confirmDeleteFolder(folder); }} style={styles.folderControl}><Text style={styles.folderDanger}>Delete folder</Text></Pressable></View>}
              <MenuRow label="Archived" icon="archive" detail={`${archiveNotes.length} archived ${archiveNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'archive'} onPress={selectArchive} />
              <MenuRow label="Trash" icon="trash" detail={`${trashNotes.length} trashed notes`} active={view === 'trash'} onPress={selectTrash} />
               <MenuRow label="New note" icon="plus" detail="Capture a new thought" active={view === 'editor' && state.editingId === null} onPress={openNewNote} />
            </ScrollView>
            <View style={styles.drawerNotice}>
              <Text style={styles.drawerNoticeTitle}>More of SnapNotes is on the way</Text>
              <Text style={styles.drawerNoticeText}>Settings and account features will appear here as they are migrated and tested.</Text>
            </View>
            <View style={styles.drawerFooter}>
              <Text style={styles.drawerFooterBrand}>SnapNotes Mobile</Text>
              <Text style={styles.drawerFooterText}>Save Your Mind.</Text>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={linkOpen} transparent animationType="fade" onRequestClose={() => setLinkOpen(false)}>
        <KeyboardAvoidingView style={styles.linkLayer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.linkDialog} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.label}>Insert link</Text>
            <Text style={styles.hint}>The selected text becomes a link. With no selection, the URL is inserted.</Text>
            <TextInput accessibilityLabel="Link URL" value={linkUrl} onChangeText={value => { setLinkUrl(value); setLinkError(null); }}
              autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done"
              placeholder="https://example.com" placeholderTextColor="#64748b" onSubmitEditing={insertLink} style={styles.input} />
            {linkError !== null && <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text>}
            <View style={styles.actions}>
              <Action label="Cancel link" secondary onPress={() => setLinkOpen(false)} />
              <Action label="Insert link" disabled={saving || !editorReady} onPress={insertLink} />
            </View>
          </View>
        </KeyboardAvoidingView>
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
  editorTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  linkLayer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(20,35,15,0.35)' },
  linkDialog: { padding: 20, borderRadius: 16, backgroundColor: '#ffffff', gap: 14 },
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
  folderModalLayer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.45)' },
  folderModalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '75%', gap: 12 },
  folderControl: { paddingVertical: 10, paddingHorizontal: 12, minHeight: 40 },
  folderControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  folderControlText: { color: '#3b7f16', fontWeight: '700' },
  folderDanger: { color: '#b3261e', fontWeight: '700' },
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e4e8e1', minHeight: 42 },
  noteFooterActions: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  noteMenuTrigger: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  actionsModalLayer: { flex: 1 },
  actionsBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15, 28, 12, 0.08)' },
  actionsMenu: { position: 'absolute', width: 216, maxWidth: '100%', paddingVertical: 6, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dce4d7', borderRadius: 14, shadowColor: '#172712', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  actionsMenuMeasuring: { opacity: 0 },
  actionsMenuScroll: { flexGrow: 0, flexShrink: 1 },
  actionsMenuRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  actionsMenuRowPressed: { backgroundColor: '#eff4eb' },
  actionsMenuIcon: { width: 20, flexShrink: 0, textAlign: 'center' },
  actionsMenuText: { flex: 1, flexShrink: 1, minWidth: 0, color: '#293d23', fontSize: 15, fontWeight: '600' },
  actionsMenuDanger: { color: '#b3261e' },
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
  folderSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  folderAddButton: { minHeight: 40, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff7e9' },
  folderAddText: { color: '#3b7f16', fontSize: 12, fontWeight: '800' },
  folderExpandButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 15 },
  folderExpandText: { color: '#3b7f16', fontSize: 13, fontWeight: '700' },
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
