import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ComponentRef } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Alert, AppState, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  characterCount, hasUnsavedChanges, MAX_NOTE_CHARACTERS, MAX_NOTE_HTML_LENGTH, NOTE_CATEGORIES, normalizeCategory, sortNotesPinnedFirst, type Note, type NoteCategory,
} from '../notes';
import { createNotesController } from '../notesController';
import { privateSharedCoordinator } from '../privateSharedCoordinator';
import { createPrivateOrdinarySaveGuard } from '../privateOrdinarySaveGuard';
import { createPrivateVaultStorage } from '../privateVaultStorage';
import { countPrivateVaultNotes } from '../privateNoteReader';
import { DRAFT_LIBRARY_KEY, newDraftId, parseDraftLibrary, removeDraft, upsertDraft, type SavedDraft } from '../draftLibrary';
import { FOLDERS_KEY, FOLDER_ICON_NAMES, FOLDER_COLOR_VALUES, normalizeFolderIcon, normalizeFolderColor, type FolderIcon, type FolderColor, MAX_FOLDERS, makeFolderId, normalizeFolderName, parseFolders, validateFolderName, type Folder } from '../folders';
import { deviceNotesStorage } from '../deviceNotesStorage';
import { searchNotes } from '../noteSearch';
import { mergeImportedFolders, parsePwaImport, serializeNotesForExport, type TransferFormat } from '../noteTransfer';
import { getNoteActionsMenuLayout, type MenuRect } from '../noteActionsMenu';
import { ChecklistLabel } from './ChecklistLabel';
import { getNoteHtmlLines, normalizeNoteLink, noteHtmlToText, sanitizeNoteHtml, updateChecklistHtml } from '../noteFormatting';
import { FormattedText } from './FormattedText';
import { FormattingToolbar } from './FormattingToolbar';
import { getRandomAccountAvatarColor } from './drawerAvatar';
import { PrivateNotesScreen } from './PrivateNotesScreen';
import { moveDeviceNoteToPrivate } from '../privateMoveService';
import { NoteAttachmentSummary, NoteAttachments } from './NoteAttachments';
import { RichNoteEditor, type FormattingAction, type FormattingState, type RichContent, type RichNoteEditorHandle } from './RichNoteEditor';
import { ReminderControls } from './ReminderControls';
import { addReminderReceivedListener, localReminderScheduler } from '../reminders/nativeNotifications';
import { isValidReminderAt, normalizeReminderRepeat } from '../reminders/recurrence';
import { reminderTargetKey, type PrivateReminderNavigationTarget, type ReminderNotificationTarget } from '../reminders/notificationResponse';

type WorkspaceView = 'library' | 'editor' | 'archive' | 'trash' | 'folder' | 'drafts' | 'private';
type NoteAction = 'move-private' | 'move-folder' | 'duplicate' | 'archive' | 'restore-archive' | 'trash' | 'restore-trash' | 'delete';
type NoteActionOption = { label: string; icon: FontAwesomeName; destructive?: boolean; action: NoteAction };
type FolderAction = 'rename' | 'customize' | 'delete';
const FOLDER_ACTIONS: { action: FolderAction; label: string; icon: FontAwesomeName }[] = [
  { action: 'rename', label: 'Rename folder', icon: 'pencil' },
  { action: 'customize', label: 'Customize folder', icon: 'paint-brush' },
  { action: 'delete', label: 'Delete folder', icon: 'trash' },
];
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

function MenuRow({ label, detail, icon, onPress, active = false, iconColor, fill = false }: {
  icon: FontAwesomeName;
  label: string; detail: string; onPress: () => void; active?: boolean; iconColor?: string; fill?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={fill ? 'Open folder ' + label : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, fill && styles.folderNavigationButton, active && styles.menuRowActive, pressed && styles.pressed]}
    >
      <FontAwesome name={icon} size={18} color={iconColor ?? (active ? '#3b7f16' : '#65775c')} accessible={false} />
      <Text numberOfLines={1} style={[styles.menuRowTitle, active && styles.menuRowTitleActive]}>{label}</Text>
      {/^\d/.test(detail) ? <View style={styles.menuCountBadge}><Text style={styles.menuCountText}>{detail.split(' ')[0]}</Text></View> : <FontAwesome name="chevron-right" size={12} color="#6a7764" accessible={false} />}
    </Pressable>
  );
}

function NoteActionsMenuContent({ title, canEdit, saving, options, onEdit, onAction }: {
  title: string; canEdit: boolean; saving: boolean; options: NoteActionOption[];
  onEdit: () => void; onAction: (action: NoteAction) => void;
}) {
  return (
    <ScrollView style={styles.actionsMenuScroll} keyboardShouldPersistTaps="handled">
      {canEdit && (
        <Pressable accessibilityRole="button" accessibilityLabel={'Edit note: ' + title}
          disabled={saving} accessibilityState={{ disabled: saving }} onPress={onEdit}
          style={({ pressed }) => [styles.actionsMenuRow, pressed && styles.actionsMenuRowPressed]}>
          <FontAwesome name="file-text-o" size={19} color="#52634b" style={styles.actionsMenuIcon} accessible={false} />
          <Text style={styles.actionsMenuText}>Edit note</Text>
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

// One queue for this workspace's ordinary-note mutations. The encrypted vault
// must join this same queue before Move to Private can be enabled.
const privateVaultStorage = createPrivateVaultStorage(AsyncStorage);
const coordinatedDeviceNotesStorage = createPrivateOrdinarySaveGuard(
  privateSharedCoordinator, deviceNotesStorage, privateVaultStorage,
);

export function NotesWorkspace({ onOpenAccount, accountInitials, notificationTarget, onReminderTargetHandled }: {
  onOpenAccount?: () => void;
  accountInitials?: string | null;
  notificationTarget?: ReminderNotificationTarget | null;
  onReminderTargetHandled?: () => void;
} = {}) {
  const [controller] = useState(() => createNotesController(coordinatedDeviceNotesStorage));
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>('library');
  const [privateReminderTarget, setPrivateReminderTarget] = useState<PrivateReminderNavigationTarget | null>(null);
  const handledNotificationTarget = useRef<string | null>(null);
  const reminderTargetActions = useRef<{
    openRegularNote: (noteId: string) => void;
    openPrivateNote: (target: PrivateReminderNavigationTarget) => void;
    unavailable: () => void;
  } | null>(null);
  const onReminderTargetHandledRef = useRef(onReminderTargetHandled);
  const handlePrivateReminderTargetHandled = useCallback(() => setPrivateReminderTarget(null), []);
  const [storageInfoOpen, setStorageInfoOpen] = useState(false);
  const [privateNoteCount, setPrivateNoteCount] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountAvatarColor] = useState(getRandomAccountAvatarColor);
  const [transferBusy, setTransferBusy] = useState(false);
  const [folderActionsMenu, setFolderActionsMenu] = useState<{ id: string; revision: number } | null>(null);
  const folderActionsTarget = useRef<{ id: string | null; revision: number }>({ id: null, revision: 0 });
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
  const [appearanceFolderId, setAppearanceFolderId] = useState<string | null>(null);
  const [appearanceIcon, setAppearanceIcon] = useState<FolderIcon>('folder');
  const [appearanceColor, setAppearanceColor] = useState<FolderColor>('');
  const [folderMoveNoteId, setFolderMoveNoteId] = useState<string | null>(null);
  const [actionsNoteId, setActionsNoteId] = useState<string | null>(null);
  const [privateMoveId, setPrivateMoveId] = useState<string | null>(null);
  const [privateMovePassword, setPrivateMovePassword] = useState('');
  const [privateMovePasswordVisible, setPrivateMovePasswordVisible] = useState(false);
  const [privateMoveBusy, setPrivateMoveBusy] = useState(false);
  const [actionsAnchor, setActionsAnchor] = useState<MenuRect | null>(null);
  const [actionsViewport, setActionsViewport] = useState<MenuRect | null>(null);
  const [actionsMenuHeight, setActionsMenuHeight] = useState(0);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [draftLibraryReady, setDraftLibraryReady] = useState(false);
  const [draftLibraryError, setDraftLibraryError] = useState<string | null>(null);
  const draftLibraryRef = useRef<SavedDraft[]>([]);
  const draftLibraryBusy = useRef(false);
  const [draftLibrarySaving, setDraftLibrarySaving] = useState(false);
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const openedDraftIdRef = useRef<string | null>(null);
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
  const draftSaveInFlight = useRef(false);
  const actionTriggers = useRef(new Map<string, ComponentRef<typeof View>>());
  const actionsLayer = useRef<ComponentRef<typeof View> | null>(null);
  const actionsRequest = useRef<{ id: string | null; revision: number }>({ id: null, revision: 0 });
  const draftWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const draftRecoveryRevision = useRef(0);
  const { state, status, storageError } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const syncOrdinaryReminders = useCallback(async (notes: Note[]) => {
    try {
      const vaultEntries = await privateVaultStorage.load();
      const privateIds = vaultEntries.map(entry => entry.id);
      const result = await localReminderScheduler.reconcileNotes(notes, privateIds);
      if (result.stateUpdates.length) await controller.updateReminderState(result.stateUpdates);
      return result;
    } catch {
      // If vault state cannot be verified, do not leave cleartext previews queued.
      try { await localReminderScheduler.reconcileNotes([]); } catch { /* Keep the error generic and fail closed. */ }
      return null;
    }
  }, [controller]);
  useEffect(() => {
    if (status === 'ready') void syncOrdinaryReminders(state.notes);
  }, [status, state.notes, syncOrdinaryReminders]);
  useEffect(() => {
    const reconcileCurrentNotes = () => {
      const snapshot = controller.getSnapshot();
      if (snapshot.status === 'ready') void syncOrdinaryReminders(snapshot.state.notes);
    };
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') reconcileCurrentNotes();
    });
    const removeNotificationListener = addReminderReceivedListener(reconcileCurrentNotes);
    return () => { appState.remove(); removeNotificationListener(); };
  }, [controller, syncOrdinaryReminders]);
  const refreshPrivateNoteCount = useCallback(async () => {
    try {
      setPrivateNoteCount(countPrivateVaultNotes(await privateVaultStorage.load()));
    } catch {
      setPrivateNoteCount(null);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void privateVaultStorage.load().then(entries => {
      if (active) setPrivateNoteCount(countPrivateVaultNotes(entries));
    }).catch(() => {
      if (active) setPrivateNoteCount(null);
    });
    return () => { active = false; };
  }, []);
  function trackOpenedDraft(id: string | null) {
    openedDraftIdRef.current = id;
    setOpenedDraftId(id);
  }
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
    claimEditorDraft(draftHydrated || action.type === 'change' || action.type === 'rich-change' || action.type === 'reminder' || action.type === 'edit' ||
      Boolean(current.title.trim() || current.text.trim()));
    if (action.type === 'reset' || action.type === 'edit' || action.type === 'restore-draft') {
      if (action.type !== 'restore-draft') trackOpenedDraft(null);
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
  const folderActionsId = folderActionsMenu?.id ?? null;
  const folderActionsFolder = folders.find(folder => folder.id === folderActionsId);
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
        ...(!inArchive ? [{ label: 'Move to Private', icon: 'lock' as FontAwesomeName, action: 'move-private' as NoteAction }] : []),
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
          (record.openedDraftId !== undefined && !(record.openedDraftId === null || typeof record.openedDraftId === 'string')) ||
          !(record.editingId === null || typeof record.editingId === 'string')
        ) {
          throw new Error('Unsupported draft record');
        }
        if (typeof record.html === 'string' && noteHtmlToText(record.html).trim() !== record.text.replace(/\r/g, '').trim()) {
          throw new Error('Rich draft text does not match its formatting');
        }
        if ((record.reminderAt !== undefined && !isValidReminderAt(record.reminderAt)) ||
          (record.reminderNotified !== undefined && typeof record.reminderNotified !== 'boolean')) {
          throw new Error('Invalid reminder state in recovery draft');
        }
        let reminderRepeat: ReturnType<typeof normalizeReminderRepeat> | undefined;
        if (record.reminderRepeat === null) reminderRepeat = null;
        else if (record.reminderRepeat !== undefined) {
          reminderRepeat = record.reminderAt == null ? null : normalizeReminderRepeat(record.reminderRepeat, record.reminderAt);
          if (reminderRepeat === null) throw new Error('Invalid repeat schedule in recovery draft');
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
          openedDraftIdRef.current = typeof record.openedDraftId === 'string' ? record.openedDraftId : null;
          setOpenedDraftId(openedDraftIdRef.current);
          controller.dispatch({
            type: 'restore-draft',
            draft: { title: record.title, text: record.text, category: normalizeCategory(record.category),
              ...(typeof record.html === 'string' ? { html: sanitizeNoteHtml(record.html) } : {}),
              ...(record.reminderAt === undefined ? {} : { reminderAt: record.reminderAt as string | null }),
              ...(record.reminderNotified === undefined ? {} : { reminderNotified: record.reminderNotified as boolean }),
              ...(record.reminderRepeat === undefined ? {} : { reminderRepeat }),
            },
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
          ...(state.draft.reminderAt === undefined ? {} : { reminderAt: state.draft.reminderAt }),
          ...(state.draft.reminderNotified === undefined ? {} : { reminderNotified: state.draft.reminderNotified }),
          ...(state.draft.reminderRepeat === undefined ? {} : { reminderRepeat: state.draft.reminderRepeat }),
          ...(openedDraftId === null ? {} : { openedDraftId }),
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
  }, [draftHydrated, status, dirty, state.draft.title, state.draft.text, state.draft.html, state.draft.category,
    state.draft.reminderAt, state.draft.reminderNotified, state.draft.reminderRepeat, state.editingId, openedDraftId]);

  function changeDraft(field: 'title' | 'text', value: string) {
    if (saveInFlight.current) return;
    dispatch({ type: 'change', field, value });
  }

  function selectDraftCategory(category: NoteCategory) {
    if (saveInFlight.current) return;
    dispatch({ type: 'category', category });
    setCategoryPickerOpen(false);
  }

  function selectLibraryCategory(category: NoteCategory | 'all') {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter(category);
      closeDrawer();
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

  function closeFolderActions() {
    folderActionsTarget.current = { id: null, revision: folderActionsTarget.current.revision + 1 };
    setFolderActionsMenu(null);
  }

  function closeDrawer() {
    closeFolderActions();
    setDrawerOpen(false);
  }

  function dismissDrawer() {
    if (folderActionsTarget.current.id !== null) closeFolderActions();
    else closeDrawer();
  }

  function openFolderActions(id: string) {
    if (!foldersReady || folderMutationInFlight.current || saving || controller.getSnapshot().status !== 'ready' ||
      !foldersRef.current.some(folder => folder.id === id)) return;
    const request = { id, revision: folderActionsTarget.current.revision + 1 };
    folderActionsTarget.current = request;
    setFolderActionsMenu(request);
  }

  function handleFolderAction(id: string, revision: number, action: FolderAction) {
    if (folderActionsTarget.current.id !== id || folderActionsTarget.current.revision !== revision || !foldersReady || folderMutationInFlight.current ||
      saving || controller.getSnapshot().status !== 'ready') return;
    const folder = foldersRef.current.find(item => item.id === id);
    closeFolderActions();
    if (!folder) return;
    // Use the menu's folder, not the currently open folder. Claim the action
    // synchronously so a stale or double-tapped menu callback cannot run twice.
    if (action === 'rename') openFolderDialog('rename', folder);
    else if (action === 'customize') openFolderAppearance(folder);
    else { closeDrawer(); confirmDeleteFolder(folder); }
  }

  function selectFolder(id: string) {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setActiveFolderId(id);
      closeDrawer();
      setView('folder');
    });
  }

  function openFolderDialog(mode: 'create' | 'rename', folder?: Folder) {
    if (!foldersReady || folderMutationInFlight.current) return;
    closeDrawer();
    setFolderName(folder?.name ?? '');
    setFolderDialog({ mode, id: folder?.id });
  }

  function openFolderAppearance(folder: Folder) {
    if (!foldersReady || folderMutationInFlight.current) return;
    closeDrawer();
    setAppearanceFolderId(folder.id);
    setAppearanceIcon(normalizeFolderIcon(folder.icon));
    setAppearanceColor(normalizeFolderColor(folder.color));
  }

  function closeFolderAppearance() {
    if (!folderMutationInFlight.current) setAppearanceFolderId(null);
  }

  async function saveFolderAppearance() {
    if (!appearanceFolderId || !foldersReady || folderMutationInFlight.current) return;
    const current = foldersRef.current;
    if (!current.some(folder => folder.id === appearanceFolderId)) { setAppearanceFolderId(null); return; }
    folderMutationInFlight.current = true;
    setFoldersSaving(true);
    try {
      const now = new Date().toISOString();
      const next = current.map(folder => folder.id === appearanceFolderId
        ? { ...folder, icon: appearanceIcon, color: appearanceColor, updatedAt: now } : folder);
      if (await persistFolders(next, 'Could not save folder appearance. Please try again.')) setAppearanceFolderId(null);
    } finally {
      folderMutationInFlight.current = false;
      setFoldersSaving(false);
    }
  }

  async function submitFolder() {
    if (!folderDialog || !foldersReady || folderMutationInFlight.current) return;
    const current = foldersRef.current;
    if (folderDialog.mode === 'rename' && !current.some(folder => folder.id === folderDialog.id)) return;
    const name = normalizeFolderName(folderName);
    const error = validateFolderName(current, name, folderDialog.id);
    if (error) { Alert.alert('Folder name', error); return; }
    const now = new Date().toISOString();
    const next: Folder[] = folderDialog.mode === 'create'
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

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(DRAFT_LIBRARY_KEY).then(raw => {
      const drafts = parseDraftLibrary(raw);
      if (active) { draftLibraryRef.current = drafts; setSavedDrafts(drafts); setDraftLibraryReady(true); setDraftLibraryError(null); }
    }).catch(() => {
      if (active) { setDraftLibraryReady(false); setDraftLibraryError('Could not read saved drafts. Existing drafts have not been changed.'); }
    });
    return () => { active = false; };
  }, []);

  async function writeDraftLibrary(next: SavedDraft[]): Promise<boolean> {
    if (!draftLibraryReady || draftLibraryBusy.current) return false;
    draftLibraryBusy.current = true;
    setDraftLibrarySaving(true);
    try {
      await AsyncStorage.setItem(DRAFT_LIBRARY_KEY, JSON.stringify(next));
      draftLibraryRef.current = next;
      setSavedDrafts(next);
      setDraftLibraryError(null);
      return true;
    } catch {
      setDraftLibraryError('Could not save drafts. Your previous drafts remain unchanged.');
      return false;
    } finally {
      draftLibraryBusy.current = false;
      setDraftLibrarySaving(false);
    }
  }

  function selectPrivate() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      closeDrawer();
      setView('private');
    });
  }

  function selectDrafts() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      closeDrawer();
      setView('drafts');
    });
  }

  async function saveToDrafts() {
    if (!draftLibraryReady || draftLibraryBusy.current || saveInFlight.current || controller.getSnapshot().status !== 'ready') return;
    // Both save destinations share a synchronous lock, including the WebView
    // snapshot await before React has had a chance to disable the buttons.
    saveInFlight.current = true;
    draftSaveInFlight.current = true;
    const session = editorSession.current;
    setFlushing(true);
    try {
      const content = await bodyEditor.current?.getContent();
      if (!content) throw Error('Editor is not ready. Please try again.');
      if (session !== editorSession.current || controller.getSnapshot().status !== 'ready') return;
      if (content.html.length > MAX_NOTE_HTML_LENGTH) throw Error('Draft formatting is too large. Simplify the formatting before saving.');
      // Keep the authoritative snapshot in the editor/recovery even if the
      // library write fails; never fall back to an older onChange message.
      dispatch({ type: 'rich-change', ...content });
      const current = controller.getSnapshot().state;
      const title = current.draft.title;
      if (!title.trim() && !current.draft.text.trim()) { Alert.alert('Empty draft', 'Write something before saving a draft.'); return; }
      const now = new Date().toISOString();
      const draft: SavedDraft = {
        id: openedDraftIdRef.current ?? newDraftId(draftLibraryRef.current, now),
        title, text: current.draft.text, html: current.draft.html,
        category: normalizeCategory(current.draft.category), editingId: current.editingId, savedAt: now,
        ...(current.draft.reminderAt === undefined ? {} : { reminderAt: current.draft.reminderAt }),
        ...(current.draft.reminderNotified === undefined ? {} : { reminderNotified: current.draft.reminderNotified }),
        ...(current.draft.reminderRepeat === undefined ? {} : { reminderRepeat: current.draft.reminderRepeat }),
      };
      if (await writeDraftLibrary(upsertDraft(draftLibraryRef.current, draft)) && session === editorSession.current) {
        dispatch({ type: 'reset' });
        Keyboard.dismiss();
        closeDrawer();
        setView('drafts');
      }
    } catch (error) {
      Alert.alert('Could not save draft', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      draftSaveInFlight.current = false;
      saveInFlight.current = false;
      setFlushing(false);
    }
  }

  function openSavedDraft(draft: SavedDraft) {
    confirmDiscard(() => {
      // Stored drafts are untrusted input just like the recovery record. Do not
      // open HTML that would silently replace a different stored plain-text body.
      if (draft.html !== undefined && (draft.html.length > MAX_NOTE_HTML_LENGTH ||
        noteHtmlToText(draft.html).trim() !== draft.text.replace(/\r/g, '').trim())) {
        Alert.alert('Could not open draft', 'This draft has invalid formatting. Its stored content has not been changed.');
        return;
      }
      const editingId = draft.editingId && controller.getSnapshot().state.notes.some(note => note.id === draft.editingId && note.deletedAt === null) ? draft.editingId : null;
      dispatch({ type: 'restore-draft', draft: { title: draft.title, text: draft.text,
        ...(draft.html === undefined ? {} : { html: draft.html }), category: normalizeCategory(draft.category),
        ...(draft.reminderAt === undefined ? {} : { reminderAt: draft.reminderAt }),
        ...(draft.reminderNotified === undefined ? {} : { reminderNotified: draft.reminderNotified }),
        ...(draft.reminderRepeat === undefined ? {} : { reminderRepeat: draft.reminderRepeat }),
      }, editingId });
      trackOpenedDraft(draft.id);
      setView('editor');
    });
  }

  function confirmDeleteDraft(draft: SavedDraft) {
    Alert.alert('Delete draft?', `Delete "${draft.title || 'Untitled draft'}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete draft', style: 'destructive', onPress: () => { void writeDraftLibrary(removeDraft(draftLibraryRef.current, draft.id)); } },
    ]);
  }

  function selectArchive() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter('all');
      closeDrawer();
      setView('archive');
    });
  }

  function selectTrash() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      setCategoryFilter('all');
      closeDrawer();
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

  function openExportFormatPicker() {
    closeDrawer();
    const snapshot = controller.getSnapshot();
    if (snapshot.status !== 'ready') {
      Alert.alert('Export unavailable', 'Wait for notes to finish loading before exporting.');
      return;
    }
    if (snapshot.state.notes.length === 0) {
      Alert.alert('No notes to export', 'There are no saved notes on this device.');
      return;
    }
    if (!foldersReady) {
      Alert.alert('Folders unavailable', 'Folders could not be loaded, so an export cannot safely preserve your folder setup.');
      return;
    }
    Alert.alert('Export notes', 'Private Notes are never included in exports. Local attachment files stay on this device and are not included.', [
      { text: 'JSON', onPress: () => { void exportNotes('json'); } },
      { text: 'Markdown', onPress: () => { void exportNotes('markdown'); } },
      { text: 'TXT', onPress: () => { void exportNotes('txt'); } },
    ]);
  }

  async function exportNotes(format: TransferFormat) {
    if (transferBusy) return;
    if (controller.getSnapshot().status !== 'ready') {
      Alert.alert('Export unavailable', 'Wait for notes to finish loading before exporting.');
      return;
    }
    setTransferBusy(true);
    try {
      const now = new Date();
      const serialized = serializeNotesForExport(format, controller.getSnapshot().state.notes, foldersRef.current, now.toISOString());
      const filename = `snapnotes-export-${now.toISOString().slice(0, 10)}.${serialized.extension}`;
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true, intermediates: true });
      await file.write(serialized.content);
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device cannot open the system sharing menu right now. Your saved notes were not changed.');
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: serialized.mimeType, dialogTitle: filename });
    } catch {
      Alert.alert('Could not export notes', 'The export file could not be prepared. Your saved notes have not been changed.');
    } finally {
      setTransferBusy(false);
    }
  }

  async function applyParsedImport(parsed: ReturnType<typeof parsePwaImport>) {
    if (transferBusy) return;
    setTransferBusy(true);
    const previousFolders = [...foldersRef.current];
    try {
      const merged = mergeImportedFolders(previousFolders, parsed.folders, new Date().toISOString());
      const importedNotes = parsed.notes.map(note => ({
        ...note,
        folderId: note.folderId ? merged.idMap.get(note.folderId) ?? null : null,
      }));
      const foldersChanged = JSON.stringify(previousFolders) !== JSON.stringify(merged.folders);
      if (foldersChanged && !(await persistFolders(merged.folders, 'Imported folders could not be saved. No notes were imported.'))) {
        Alert.alert('Could not import notes', 'Imported folders could not be saved. Your existing notes have not been changed.');
        return;
      }
      if (!(await controller.importNotes(importedNotes))) {
        let rollbackSucceeded = true;
        if (foldersChanged) rollbackSucceeded = await persistFolders(previousFolders, 'Imported folders could not be rolled back.');
        const storageMessage = controller.getSnapshot().storageError ?? 'The device did not confirm the note import.';
        Alert.alert('Could not import notes', `${storageMessage}${rollbackSucceeded ? '' : ' Imported folders may remain, but no notes were added.'}`);
        return;
      }
      const skipped = parsed.privateNotesSkipped;
      Alert.alert('Import complete', `${importedNotes.length} ${importedNotes.length === 1 ? 'note was' : 'notes were'} added. Existing notes were kept.${skipped ? ` ${skipped} Private ${skipped === 1 ? 'Note was' : 'Notes were'} skipped.` : ''} Attachment files were not imported.`);
    } finally {
      setTransferBusy(false);
    }
  }

  async function openImportPicker() {
    closeDrawer();
    if (transferBusy) return;
    if (controller.getSnapshot().status !== 'ready' || !foldersReady) {
      Alert.alert('Import unavailable', 'Wait for notes and folders to finish loading before importing.');
      return;
    }
    setTransferBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('No file was selected.');
      if (typeof asset.size === 'number' && asset.size > 25 * 1024 * 1024) {
        throw new Error('Choose a JSON export smaller than 25 MB.');
      }
      const parsed = parsePwaImport(await new File(asset.uri).text(), new Date().toISOString());
      if (parsed.notes.length === 0) {
        const message = parsed.privateNotesSkipped
          ? `This file contains no ordinary notes. ${parsed.privateNotesSkipped} Private ${parsed.privateNotesSkipped === 1 ? 'Note was' : 'Notes were'} skipped.`
          : 'This file contains no notes that can be imported.';
        Alert.alert('Nothing to import', `${message} Attachment files are not imported.`);
        return;
      }
      const skipped = parsed.privateNotesSkipped;
      const privacyNote = skipped ? ` ${skipped} Private ${skipped === 1 ? 'Note will' : 'Notes will'} be skipped.` : ' Private Notes are never imported.';
      Alert.alert('Import notes', `${parsed.notes.length} ${parsed.notes.length === 1 ? 'note will' : 'notes will'} be added without replacing existing notes.${privacyNote} Attachment files are not imported.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', onPress: () => { void applyParsedImport(parsed); } },
      ]);
    } catch (error) {
      Alert.alert('Could not import notes', error instanceof Error ? error.message : 'Choose a SnapNotes JSON export. Your existing notes have not been changed.');
    } finally {
      setTransferBusy(false);
    }
  }

  function confirmDiscard(continueAction: () => void) {
    // A normal note's pending snapshot remains cancellable via editorSession.
    // A draft write must not later reset a different editor after committing.
    const canLeave = () => !draftSaveInFlight.current && !draftLibraryBusy.current;
    if (!canLeave()) return;
    if (!dirty) {
      continueAction();
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Your saved notes will not be changed.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: () => { if (canLeave()) continueAction(); } },
    ], { cancelable: true });
  }

  function openLibrary() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      closeDrawer();
      setStorageInfoOpen(false);
      setView('library');
    });
  }

  function openNewNote() {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      closeDrawer();
      setStorageInfoOpen(false);
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
      setStorageInfoOpen(false);
      setView('editor');
    });
  }

  function openPrivateReminder(target: PrivateReminderNavigationTarget) {
    confirmDiscard(() => {
      dispatch({ type: 'reset' });
      Keyboard.dismiss();
      closeDrawer();
      setStorageInfoOpen(false);
      setPrivateReminderTarget(target);
      setView('private');
    });
    onReminderTargetHandledRef.current?.();
  }

  function openRegularReminder(noteId: string) {
    const note = controller.getSnapshot().state.notes.find(item => item.id === noteId);
    if (!note) {
      reminderTargetActions.current?.unavailable();
      return;
    }
    editNote(note.id);
    onReminderTargetHandledRef.current?.();
  }

  function reminderUnavailable() {
    Alert.alert('Reminder unavailable', 'SnapNotes could not safely open this note. No note content was shown.');
    onReminderTargetHandledRef.current?.();
  }

  useEffect(() => {
    onReminderTargetHandledRef.current = onReminderTargetHandled;
  }, [onReminderTargetHandled]);

  useEffect(() => {
    reminderTargetActions.current = {
      openRegularNote: openRegularReminder,
      openPrivateNote: openPrivateReminder,
      unavailable: reminderUnavailable,
    };
  });

  useEffect(() => {
    if (!notificationTarget) {
      handledNotificationTarget.current = null;
      return;
    }
    const targetKey = reminderTargetKey(notificationTarget);
    if (handledNotificationTarget.current === targetKey) return;
    if (notificationTarget.kind === 'note' && status !== 'ready') return;
    handledNotificationTarget.current = targetKey;

    if (notificationTarget.kind !== 'note') {
      reminderTargetActions.current?.openPrivateNote(notificationTarget);
      return;
    }

    const noteId = notificationTarget.noteId;
    void privateVaultStorage.load().then(entries => {
      if (handledNotificationTarget.current !== targetKey) return;
      if (entries.some(entry => entry.id === noteId)) {
        // A stale ordinary reminder must not open a duplicate that now belongs to the vault.
        reminderTargetActions.current?.openPrivateNote({ kind: 'private-note', noteId });
        return;
      }
      reminderTargetActions.current?.openRegularNote(noteId);
    }).catch(() => {
      if (handledNotificationTarget.current === targetKey) reminderTargetActions.current?.unavailable();
    });
  }, [notificationTarget, status]);

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
      case 'move-private':
        setPrivateMovePassword('');
        setPrivateMovePasswordVisible(false);
        setPrivateMoveId(id);
        break;
      case 'move-folder': chooseFolder(id); break;
      case 'duplicate': void controller.duplicateNote(id, now); break;
      case 'archive': void controller.setArchived(id, true, now); break;
      case 'restore-archive': void controller.setArchived(id, false, now); break;
      case 'trash': confirmTrash(id, selected.title); break;
      case 'restore-trash': void controller.restoreFromTrash(id, now); break;
      case 'delete': confirmPermanentDelete(id, selected.title); break;
    }
  }

  async function confirmPrivateMove() {
    if (!privateMoveId || privateMoveBusy || controller.getSnapshot().status !== 'ready') return;
    const id = privateMoveId;
    setPrivateMoveBusy(true);
    let ordinaryReminderCancelled = false;
    let transferOutcome: 'not-committed' | 'moved' | 'needs-recovery' = 'not-committed';
    let transferRecoveryMessage = '';
    try {
      // Remove any cleartext title/body notification before the encrypted move.
      // If this cannot be confirmed, leave the ordinary note untouched.
      await localReminderScheduler.cancelNoteReminder(id);
      ordinaryReminderCancelled = true;
      const result = await moveDeviceNoteToPrivate(id, privateMovePassword);
      transferOutcome = result.status;
      if (result.status === 'needs-recovery') transferRecoveryMessage = result.reason;
      setPrivateMovePassword('');
      setPrivateMovePasswordVisible(false);
      setPrivateMoveId(null);
      await controller.refreshAfterPrivateTransfer();
      if (result.status === 'needs-recovery') {
        Alert.alert('Private transfer needs attention', result.reason + ' Do not delete either copy. Its reminder was paused to prevent showing note details.');
      } else {
        let privateReminderMessage = '';
        if (result.privateReminder) {
          try {
            const permissionGranted = await localReminderScheduler.requestPermission();
            if (permissionGranted) {
              await localReminderScheduler.schedulePrivateSummary(result.privateReminder);
            } else {
              privateReminderMessage = ' Notifications are not allowed; enable them in device settings to receive this private reminder.';
            }
          } catch {
            privateReminderMessage = ' The reminder could not be scheduled on this device; open Private Notes after notifications are enabled to retry.';
          }
        }
        Alert.alert('Moved to Private', 'Your note was encrypted and moved into Private Notes.' + privateReminderMessage);
      }
    } catch (cause) {
      if (ordinaryReminderCancelled && transferOutcome === 'not-committed') {
        const snapshot = controller.getSnapshot();
        if (snapshot.status === 'ready' && snapshot.state.notes.some(note => note.id === id)) {
          void syncOrdinaryReminders(snapshot.state.notes);
        }
      }
      if (transferOutcome === 'moved') {
        Alert.alert('Moved to Private', 'The note was encrypted and moved, but the regular notes list could not refresh. Its private reminder may need to be retried after reopening Private Notes.');
      } else if (transferOutcome === 'needs-recovery') {
        Alert.alert('Private transfer needs attention', transferRecoveryMessage + ' Do not delete either copy. Its reminder was paused to prevent showing note details.');
      } else {
        Alert.alert('Could not move note', cause instanceof Error ? cause.message : 'Your note was not moved.');
      }
    } finally {
      void refreshPrivateNoteCount();
      setPrivateMoveBusy(false);
    }
  }

  function handleBack() {
    if (actionsNoteId !== null) {
      closeNoteActions();
      return true;
    }
    if (drawerOpen) {
      dismissDrawer();
      return true;
    }
    if (view === 'editor' || view === 'archive' || view === 'trash' || view === 'folder' || view === 'drafts' || view === 'private') {
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
    if (saveInFlight.current) return;
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
    if (saveInFlight.current || draftLibraryBusy.current || controller.getSnapshot().status !== 'ready') return;
    if (openedDraftIdRef.current !== null && !draftLibraryReady) {
      Alert.alert('Saved drafts unavailable', 'Wait until saved drafts can be read before converting this draft to a note.');
      return;
    }
    saveInFlight.current = true;
    setFlushing(true);
    const session = editorSession.current;
    const draftId = openedDraftIdRef.current;
    try {
      const content = await bodyEditor.current?.getContent();
      if (!content) throw new Error('The editor is not ready. Please try saving again.');
      if (session !== editorSession.current) return;
      const current = controller.getSnapshot().state.draft;
      const beforeState = controller.getSnapshot().state;
      const previousNotes = beforeState.notes;
      const previousNote = beforeState.editingId === null ? undefined : previousNotes.find(note => note.id === beforeState.editingId);
      // A blank Save is validation, not consent to replace an unreadable recovery record.
      if (content.text.trim() || current.text.trim() || current.title.trim() || current.html !== undefined) {
        dispatch({ type: 'rich-change', ...content });
      }
      await controller.save(new Date().toISOString());
      const saved = controller.getSnapshot();
      if (saved.state.notes !== previousNotes && saved.status === 'ready' && saved.storageError === null && saved.state.error === null) {
        const savedNote = beforeState.editingId === null
          ? saved.state.notes.find(note => !previousNotes.some(previous => previous.id === note.id))
          : saved.state.notes.find(note => note.id === beforeState.editingId);
        const beforeReminder = JSON.stringify({ at: previousNote?.reminderAt ?? null, repeat: previousNote?.reminderRepeat ?? null });
        const afterReminder = JSON.stringify({ at: savedNote?.reminderAt ?? null, repeat: savedNote?.reminderRepeat ?? null });
        // Notes and drafts are separate storage keys. Commit the note first;
        // a cleanup failure must retain both copies, never lose the only one.
        trackOpenedDraft(null);
        editorSession.current += 1;
        if (draftId !== null && !await writeDraftLibrary(removeDraft(draftLibraryRef.current, draftId))) {
          setDraftLibraryError('Your note was saved, but its saved draft could not be removed. Both copies are safe. Delete the extra draft from Drafts when storage is available.');
        }
        if (savedNote?.reminderAt && beforeReminder !== afterReminder) {
          let permissionGranted = false;
          try { permissionGranted = await localReminderScheduler.requestPermission(); }
          catch { /* The note itself has already been committed locally. */ }
          if (!permissionGranted) {
            Alert.alert('Reminders are off', 'Your note is saved on this device, but this reminder cannot appear until notifications are allowed in device settings.');
          }
          const syncResult = await syncOrdinaryReminders(saved.state.notes);
          if (permissionGranted && syncResult === null) {
            Alert.alert('Reminder unavailable', 'Your note is saved, but SnapNotes could not schedule this reminder on the device.');
          }
        }
      }
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
            onPress={() => { closeFolderActions(); setDrawerOpen(true); }}
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
        {view !== 'private' && <View style={styles.searchRow}>
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
        </View>}
        {searching && view === 'library' && (
          <Text accessibilityLiveRegion="polite" style={styles.searchSummary}>
            {visibleNotes.length} of {categoryNotes.length} notes match
          </Text>
        )}
      </View>

      {folderError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{folderError}</Text>}
      {foldersSaving && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saving folders on this device…</Text>}
      {draftLibraryError !== null && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{draftLibraryError}</Text>}

      {view === 'private' ? (
        <PrivateNotesScreen
          reminderTarget={privateReminderTarget}
          onReminderTargetHandled={handlePrivateReminderTargetHandled}
          onBack={() => { setPrivateReminderTarget(null); void refreshPrivateNoteCount(); openLibrary(); }}
          onRestored={async () => { await controller.refreshAfterPrivateTransfer(); await refreshPrivateNoteCount(); }} />
      ) : view === 'editor' ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.editorHeadingGroup}>
              <View style={styles.viewHeading}>
                <View style={styles.headingCopy}>
                  <Text style={styles.eyebrow}>WRITE SOMETHING DOWN</Text>
                  <View testID="editor-title-with-storage-info" style={styles.editorTitleRow}>
                    <Text accessibilityRole="header" style={styles.screenTitle}>
                      {state.editingId === null ? 'New note' : 'Edit note'}
                    </Text>
                    <Pressable
                      testID="editor-storage-info-button"
                      accessibilityRole="button"
                      accessibilityLabel={storageInfoOpen ? 'Hide note storage information' : 'Show note storage information'}
                      accessibilityHint="Explains where notes are stored and whether they are encrypted, backed up, or synced."
                      accessibilityState={{ expanded: storageInfoOpen }}
                      hitSlop={6}
                      onPress={() => setStorageInfoOpen(current => !current)}
                      style={({ pressed }) => [styles.editorStorageInfoButton, pressed && styles.pressed]}
                    >
                      <FontAwesome name="info-circle" size={17} color="#79520a" accessible={false} />
                    </Pressable>
                  </View>
                </View>
                <Action label="All notes" secondary onPress={() => selectLibraryCategory('all')} disabled={saving} />
              </View>
              {storageInfoOpen && (
                <View testID="editor-storage-info-tooltip" style={styles.storageInfoTooltip}>
                  <Text style={styles.storageInfoTooltipText}>
                    <Text style={styles.storageInfoTooltipTitle}>Stored on this device. </Text>
                    {'Saved notes survive app restarts, but are not encrypted, backed up to the cloud, or synced with the PWA. Clearing app data or uninstalling can remove them.'}
                  </Text>
                </View>
              )}
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
                key={`note-editor:${state.editingId ?? 'new-note'}`}
                ref={bodyEditor}
                editable={!saving}
                accessibilityLabel="Note body"
                text={state.draft.text}
                html={state.draft.html}
                onChange={changeRichDraft}
                onReady={setEditorReady}
                onSelection={setFormattingState}
              />
              <ReminderControls
                reminderAt={state.draft.reminderAt}
                reminderRepeat={state.draft.reminderRepeat}
                disabled={saving}
                onChange={value => dispatch({ type: 'reminder', ...value })}
              />
              {state.editingId !== null
                ? <NoteAttachments key={`note-attachments:${state.editingId}`} noteId={state.editingId} />
                : <Text style={styles.hint}>Save this note first to add local attachments. Then reopen it from your notes and tap Add attachment.</Text>}
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
                <Action disabled={saving || !editorReady || draftLibrarySaving || !draftLibraryReady} label="Save to Drafts" onPress={() => { void saveToDrafts(); }} secondary />
                {(state.editingId !== null || dirty) && <Action disabled={saving} label="Cancel" onPress={openLibrary} secondary />}
                {state.editingId !== null && <Action disabled={saving} label="New note" onPress={openNewNote} secondary />}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : view === 'drafts' ? (
        <View style={styles.flex}>
          <View style={styles.libraryHeading}><View><Text style={styles.eyebrow}>UNFINISHED WORK</Text><Text accessibilityRole="header" style={styles.screenTitle}>Drafts</Text></View><Action label="+ New note" onPress={openNewNote} /></View>
          <Text style={styles.libraryHint}>Saved on this device only. Drafts are not synced or backed up.</Text>
          {!draftLibraryReady ? <Text style={styles.libraryHint}>Drafts unavailable until storage can be read.</Text> : <ScrollView contentContainerStyle={styles.editorContent}>
            {savedDrafts.length === 0 && <Text style={styles.libraryHint}>No saved drafts yet. Open the editor and tap Save to Drafts.</Text>}
            {savedDrafts.map(draft => <View key={draft.id} style={styles.editor}>
              <Text style={styles.label} numberOfLines={2}>{draft.title || 'Untitled draft'}</Text>
              <Text numberOfLines={3}>{draft.text}</Text>
              <Text style={styles.hint}>Saved {new Date(draft.savedAt).toLocaleString()}</Text>
              <View style={styles.folderControls}><Action label="Open draft" disabled={draftLibrarySaving} onPress={() => openSavedDraft(draft)} /><Action label="Delete" destructive disabled={draftLibrarySaving} onPress={() => confirmDeleteDraft(draft)} /></View>
            </View>)}
          </ScrollView>}
        </View>
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
              // Cards are informational; edit actions stay explicit in the note menu.
              // Keep nested checkboxes and menu controls independently reachable.
              <View style={styles.card} accessible={false}>
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
                <NoteAttachmentSummary key={`note-attachment-summary:${item.id}`} noteId={item.id} />
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
              </View>
              );
            }}
          />
        </View>
      )}

      <Modal testID="move-private-modal" visible={privateMoveId !== null} transparent animationType="fade"
        onRequestClose={() => { if (!privateMoveBusy) { setPrivateMoveId(null); setPrivateMovePassword(''); setPrivateMovePasswordVisible(false); } }}>
        <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 14 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#20351d' }}>Move to Private</Text>
            <Text>Enter your Private Notes password to encrypt and move this note.</Text>
            <View style={styles.movePasswordRow}>
              <TextInput accessibilityLabel="Private Notes password for transfer" secureTextEntry={!privateMovePasswordVisible}
                autoCapitalize="none" autoCorrect={false} placeholder="Private Notes password"
                value={privateMovePassword} onChangeText={setPrivateMovePassword}
                style={styles.movePasswordInput} />
              <Pressable accessibilityRole="button"
                accessibilityLabel={`${privateMovePasswordVisible ? 'Hide' : 'Show'} Private Notes transfer password`}
                accessibilityHint={privateMovePasswordVisible ? 'Hides the password on screen' : 'Shows the password on screen'}
                disabled={privateMoveBusy} hitSlop={8} style={styles.movePasswordVisibilityButton}
                onPress={() => setPrivateMovePasswordVisible(visible => !visible)}>
                <FontAwesome name={privateMovePasswordVisible ? 'eye-slash' : 'eye'} size={19} color="#3b7f16" accessible={false} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" disabled={privateMoveBusy} onPress={() => void confirmPrivateMove()}
              style={{ backgroundColor: '#3b7f16', padding: 14, borderRadius: 10 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{privateMoveBusy ? 'Encrypting…' : 'Move to Private'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={privateMoveBusy}
              onPress={() => { setPrivateMoveId(null); setPrivateMovePassword(''); setPrivateMovePasswordVisible(false); }}>
              <Text style={{ textAlign: 'center', color: '#a32b2b', padding: 8 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
                {selected && <NoteActionsMenuContent title={selected.title || 'Untitled note'} canEdit={selected.deletedAt === null}
                  saving={saving} options={options}
                  onEdit={() => {
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

      <Modal visible={appearanceFolderId !== null} transparent animationType="fade" onRequestClose={closeFolderAppearance}>
        <View style={styles.folderModalLayer}><ScrollView style={styles.folderModalCard} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.label}>Customize folder</Text>
          <Text style={styles.label}>Icon</Text>
          <View style={styles.folderAppearanceChoices}>
            {FOLDER_ICON_NAMES.map(icon => <Pressable key={icon} accessibilityRole="button"
              accessibilityLabel={icon + ' folder icon'} accessibilityState={{ selected: appearanceIcon === icon }}
              disabled={foldersSaving} onPress={() => setAppearanceIcon(icon)}
              style={[styles.folderAppearanceOption, appearanceIcon === icon && styles.folderAppearanceSelected]}>
              <Text style={styles.folderControlText}>{icon}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.label}>Color</Text>
          <View style={styles.folderAppearanceChoices}>
            {(['', ...Object.keys(FOLDER_COLOR_VALUES)] as FolderColor[]).map(color => <Pressable key={color || 'none'} accessibilityRole="button"
              accessibilityLabel={(color || 'None') + ' folder color'} accessibilityState={{ selected: appearanceColor === color }}
              disabled={foldersSaving} onPress={() => setAppearanceColor(color)}
              style={[styles.folderAppearanceOption, appearanceColor === color && styles.folderAppearanceSelected]}>
              <Text style={[styles.folderControlText, color ? { color: FOLDER_COLOR_VALUES[color] } : undefined]}>{color || 'None'}</Text>
            </Pressable>)}
          </View>
          {folderError !== null && <Text accessibilityRole="alert" style={styles.error}>{folderError}</Text>}
          <View style={styles.folderControls}><Action label="Cancel" secondary disabled={foldersSaving} onPress={closeFolderAppearance} /><Action label="Save appearance" disabled={foldersSaving} onPress={() => { void saveFolderAppearance(); }} /></View>
        </ScrollView></View>
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
        onRequestClose={dismissDrawer}
        statusBarTranslucent
      >
        <View style={styles.drawerLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            accessibilityElementsHidden={folderActionsFolder !== undefined}
            importantForAccessibility={folderActionsFolder ? 'no-hide-descendants' : 'auto'}
            style={styles.drawerBackdrop}
            onPress={closeDrawer}
          />
          <View style={styles.drawerPanel} accessibilityViewIsModal
            accessibilityElementsHidden={folderActionsFolder !== undefined}
            importantForAccessibility={folderActionsFolder ? 'no-hide-descendants' : 'auto'}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrand}>
                <View style={styles.brandMark}><Text style={styles.brandMarkText}>S</Text></View>
                <View>
                  <Text style={styles.drawerEyebrow}>LIBRARY</Text>
                  <Text accessibilityRole="header" style={styles.drawerTitle}>My notes</Text>
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notes navigation" onPress={closeDrawer} style={styles.iconButton}>
                <Text style={styles.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.flex} contentContainerStyle={styles.drawerNavigation} keyboardShouldPersistTaps="handled">
              <MenuRow label="All notes" icon="inbox" detail={`${activeNotes.length} saved ${activeNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'library' && categoryFilter === 'all'} onPress={() => selectLibraryCategory('all')} />
              {NOTE_CATEGORIES.map(category => <MenuRow key={category} icon={({ general: "sticky-note-o", work: "briefcase", personal: "user", ideas: "lightbulb-o", important: "star" } as const)[category]} label={categoryLabel(category)} detail={`${activeNotes.filter(note => normalizeCategory(note.category) === category).length} notes`} active={categoryFilter === category && view === 'library'} onPress={() => selectLibraryCategory(category)} />)}
              <View testID="drawer-section-divider" style={styles.drawerDivider} accessible={false} />
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
                <View key={folder.id} style={styles.folderNavigationRow} testID={'folder-row-' + folder.id}>
                  <MenuRow fill label={folder.name} icon={(({ folder: 'folder-o', book: 'book', flask: 'flask', code: 'code', lightbulb: 'lightbulb-o', briefcase: 'briefcase', heart: 'heart', star: 'star', cloud: 'cloud' } as const)[folder.icon])} iconColor={folder.color ? FOLDER_COLOR_VALUES[folder.color] : undefined}
                    detail={`${activeNotes.filter(note => note.folderId === folder.id).length} notes`}
                    active={view === 'folder' && activeFolderId === folder.id} onPress={() => selectFolder(folder.id)} />
                  <Pressable accessibilityRole="button" accessibilityLabel={'Folder actions for ' + folder.name}
                    accessibilityState={{ expanded: folderActionsId === folder.id, disabled: !foldersReady || saving || foldersSaving }}
                    disabled={!foldersReady || saving || foldersSaving} onPress={() => openFolderActions(folder.id)}
                    style={({ pressed }) => [styles.folderMenuTrigger, (pressed || saving || foldersSaving) && styles.pressed]}>
                    <FontAwesome name="ellipsis-v" size={18} color="#65775c" accessible={false} />
                  </Pressable>
                </View>)}
              {folders.length > 3 && <Pressable accessibilityRole="button"
                accessibilityLabel={foldersExpanded ? 'Show fewer folders' : `View all folders, ${folders.length}`}
                accessibilityState={{ expanded: foldersExpanded }}
                onPress={() => setFoldersExpanded(value => !value)}
                style={({ pressed }) => [styles.folderExpandButton, pressed && styles.pressed]}>
                <Text style={styles.folderExpandText}>{foldersExpanded ? 'Show fewer' : `View all folders (${folders.length})`}</Text>
                <FontAwesome name={foldersExpanded ? 'chevron-up' : 'chevron-down'} size={12} color="#3b7f16" accessible={false} />
              </Pressable>}
              <View testID="drawer-section-divider" style={styles.drawerDivider} accessible={false} />
              <MenuRow label="Archived" icon="archive" detail={`${archiveNotes.length} archived ${archiveNotes.length === 1 ? 'note' : 'notes'}`} active={view === 'archive'} onPress={selectArchive} />
              <MenuRow label="Drafts" icon="file-text-o" detail={`${savedDrafts.length} drafts`} active={view === 'drafts'} onPress={selectDrafts} />
              <MenuRow label="Private Notes" icon="lock"
                detail={privateNoteCount === null ? 'Protected vault' : `${privateNoteCount} private ${privateNoteCount === 1 ? 'note' : 'notes'}`}
                active={view === 'private'} onPress={selectPrivate} />
              <MenuRow label="Trash" icon="trash" detail={`${trashNotes.length} trashed notes`} active={view === 'trash'} onPress={selectTrash} />
              <View testID="drawer-section-divider" style={styles.drawerDivider} accessible={false} />
              <Pressable accessibilityRole="button" accessibilityLabel="Export notes" disabled={transferBusy}
                accessibilityState={{ disabled: transferBusy }} onPress={openExportFormatPicker}
                style={({ pressed }) => [styles.drawerTransferRow, (pressed || transferBusy) && styles.pressed]}>
                <FontAwesome name="download" size={18} color="#65775c" accessible={false} />
                <Text style={styles.menuRowTitle}>Export notes</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Import notes" disabled={transferBusy}
                accessibilityState={{ disabled: transferBusy }} onPress={() => { void openImportPicker(); }}
                style={({ pressed }) => [styles.drawerTransferRow, (pressed || transferBusy) && styles.pressed]}>
                <FontAwesome name="upload" size={18} color="#65775c" accessible={false} />
                <Text style={styles.menuRowTitle}>Import notes</Text>
              </Pressable>
            </ScrollView>
            <View testID="drawer-actions-footer" style={styles.drawerActionsFooter}>
              <Pressable
                testID="drawer-account-button"
                accessibilityRole="button"
                accessibilityLabel="Account access"
                onPress={() => { closeDrawer(); onOpenAccount?.(); }}
                style={({ pressed }) => [
                  styles.drawerAccountAvatar,
                  { backgroundColor: accountInitials ? accountAvatarColor : '#ed8a37' },
                  pressed && styles.pressed,
                ]}
              >
                {accountInitials
                  ? <Text style={styles.drawerAccountInitials} accessible={false}>{accountInitials}</Text>
                  : <FontAwesome name="user" size={20} color="#ffffff" accessible={false} />}
              </Pressable>
              <Pressable
                testID="drawer-new-note-button"
                accessibilityRole="button"
                accessibilityLabel="New note, Capture New Thought"
                accessibilityHint="Opens a blank note."
                accessibilityState={{ selected: view === 'editor' && state.editingId === null }}
                onPress={openNewNote}
                style={({ pressed }) => [styles.drawerNewNoteButton, pressed && styles.pressed]}
              >
                <Text style={styles.drawerNewNoteTitle}>+ New Note</Text>
                <Text style={styles.drawerNewNoteDescription}>Capture New Thought</Text>
              </Pressable>
            </View>
          </View>
          {folderActionsFolder && folderActionsMenu && <View style={styles.folderActionsLayer}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close folder actions"
              style={styles.actionsBackdrop} onPress={closeFolderActions} />
            <ScrollView style={styles.folderActionsCard} contentContainerStyle={styles.folderActionsContent}
              keyboardShouldPersistTaps="handled" accessibilityViewIsModal onAccessibilityEscape={closeFolderActions}
              accessibilityLabel={'Actions for folder ' + folderActionsFolder.name} testID="folder-actions-menu">
              <Text accessibilityRole="header" style={styles.label}>{folderActionsFolder.name}</Text>
              {FOLDER_ACTIONS.map(option => <Pressable key={option.action} accessibilityRole="button"
                accessibilityLabel={option.label + ': ' + folderActionsFolder.name}
                disabled={saving || foldersSaving} accessibilityState={{ disabled: saving || foldersSaving }}
                onPress={() => handleFolderAction(folderActionsFolder.id, folderActionsMenu.revision, option.action)}
                style={({ pressed }) => [styles.actionsMenuRow, pressed && styles.actionsMenuRowPressed]}>
                <FontAwesome name={option.icon} size={18} color={option.action === 'delete' ? '#b3261e' : '#52634b'} accessible={false} />
                <Text style={[styles.actionsMenuText, option.action === 'delete' && styles.actionsMenuDanger]}>{option.label}</Text>
              </Pressable>)}
              <Action label="Cancel folder actions" secondary onPress={closeFolderActions} />
            </ScrollView>
          </View>}
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
  editorHeadingGroup: { gap: 8 },
  editorTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editorStorageInfoButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, top: 1 },
  storageInfoTooltip: { padding: 12, borderRadius: 12, backgroundColor: '#fffaf0', borderWidth: 1, borderColor: '#f1e1ad' },
  storageInfoTooltipTitle: { color: '#79520a', fontSize: 13, fontWeight: '800' },
  storageInfoTooltipText: { color: '#685d3c', fontSize: 12, lineHeight: 18 },
  eyebrow: { color: '#478f1b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  screenTitle: { color: '#20351d', fontSize: 27, fontWeight: '800', letterSpacing: -0.7, marginTop: 2 },
  libraryHint: { color: '#64715e', fontSize: 13, paddingHorizontal: 18, paddingBottom: 8 },
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 100, gap: 12, flexGrow: 1 },
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 45, gap: 12 },
  emptyMark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#eaf5e1', marginBottom: 3 },
  emptyMarkText: { color: '#48a111', fontSize: 34, fontWeight: '500' },
  emptyTitle: { color: '#20351d', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: '#64715e', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 290, marginBottom: 6 },
  editorContent: { padding: 18, paddingBottom: 40, gap: 16 },
  editor: { backgroundColor: '#ffffff', borderColor: '#e0e8da', borderWidth: 1, borderRadius: 18, padding: 17, gap: 12 },
  label: { color: '#344b2d', fontSize: 14, fontWeight: '700' },
  input: { color: '#20351d', backgroundColor: '#f8faf6', borderColor: '#d5dfcd', borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  movePasswordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#cbd9c3', borderRadius: 10 },
  movePasswordInput: { flex: 1, minWidth: 0, padding: 12, color: '#20351d', fontSize: 16 },
  movePasswordVisibilityButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
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
  drawerNavigation: { paddingTop: 15, paddingBottom: 20, gap: 7 },
  drawerDivider: { width: '100%', height: 1, marginHorizontal: 12, marginTop: 10, marginBottom: 8, backgroundColor: '#e1e8dc' },
  folderNavigationRow: { flexDirection: 'row', alignItems: 'center' },
  folderNavigationButton: { flex: 1, minWidth: 0 },
  folderMenuTrigger: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  folderActionsLayer: { ...StyleSheet.absoluteFill, padding: 20, alignItems: 'center', justifyContent: 'center' },
  folderActionsCard: { flexGrow: 0, width: '100%', maxWidth: 320, maxHeight: '80%', borderRadius: 16, backgroundColor: '#ffffff' },
  folderActionsContent: { padding: 16, gap: 8 },
  folderAppearanceChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 8 },
  folderAppearanceOption: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: '#dce6d4' },
  folderAppearanceSelected: { borderColor: '#3b7f16', backgroundColor: '#eff7e9' },
  folderSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  folderAddButton: { minHeight: 40, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff7e9' },
  folderAddText: { color: '#3b7f16', fontSize: 12, fontWeight: '800' },
  folderExpandButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 15 },
  folderExpandText: { color: '#3b7f16', fontSize: 13, fontWeight: '700' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  drawerTransferRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 13 },
  menuRowActive: { backgroundColor: '#eff7e9', borderColor: '#e0efd5' },

  menuCountBadge: { marginLeft: 'auto', minWidth: 32, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, alignItems: 'center', backgroundColor: '#edf3eb' },
  menuCountText: { color: '#61705b', fontSize: 12, fontWeight: '700' },
  menuRowTitle: { flex: 1, color: '#293d23', fontSize: 15, fontWeight: '700' },
  menuRowTitleActive: { color: '#3b7f16' },
  menuRowDetail: { color: '#6a7764', fontSize: 12 },
  menuChevron: { color: '#6a7764', fontSize: 25 },
  drawerActionsFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#e8eee3' },
  drawerAccountAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  drawerAccountInitials: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  drawerNewNoteButton: { flexShrink: 0, minHeight: 48, justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#dbe9d3', backgroundColor: '#eff7e9' },
  drawerNewNoteTitle: { color: '#315b21', fontSize: 13, fontWeight: '800' },
  drawerNewNoteDescription: { color: '#61705b', fontSize: 11, marginTop: 2 },
  floatingAdd: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: '#48a111', elevation: 6, shadowColor: '#27600a', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  floatingAddText: { color: '#ffffff', fontSize: 34, lineHeight: 38, fontWeight: '400', marginTop: -2 },
});
