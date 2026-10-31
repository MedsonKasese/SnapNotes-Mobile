import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { createAndroidAttachmentFiles } from '../androidAttachmentFiles';
import { pickAndroidAttachments } from '../androidAttachmentPicker';
import { createAttachmentManifestStorage } from '../attachmentManifestStorage';
import { createAttachmentService } from '../attachmentService';
import type { StoredAttachment } from '../attachmentManifest';
import { attachmentPreviewKind } from '../attachmentRules';
import { deviceNotesStorage } from '../deviceNotesStorage';
import { privateSharedCoordinator } from '../privateSharedCoordinator';
import { createPrivateVaultStorage } from '../privateVaultStorage';
import { AttachmentPreview } from './AttachmentPreview';

const files = createAndroidAttachmentFiles();
const manifest = createAttachmentManifestStorage(AsyncStorage);
const vault = createPrivateVaultStorage(AsyncStorage);
async function assertOrdinaryNote(noteId: string): Promise<void> {
  const [notes, privateNotes] = await Promise.all([deviceNotesStorage.load(), vault.load()]);
  if (privateNotes.some(entry => entry.id === noteId)) {
    throw new Error('Attachments are not available in Private Notes.');
  }
  if (!notes.some(note => note.id === noteId)) {
    throw new Error('This note is no longer available in ordinary notes.');
  }
}

const service = createAttachmentService(
  files,
  manifest,
  () => Crypto.randomUUID().replace(/-/g, ''),
  privateSharedCoordinator,
  assertOrdinaryNote,
);

function AttachmentRow({ item, onOpenActions }: {
  item: StoredAttachment;
  onOpenActions: (item: StoredAttachment) => void;
}) {
  const kind = attachmentPreviewKind(item.mimeType);
  const icon = kind === 'pdf' ? 'file-pdf-o' : kind === 'image' ? 'file-image-o' : kind === 'text' ? 'file-text-o' : 'file-o';
  const previewFile = kind === 'image' ? files.fileForPreview(item.fileKey) : null;
  const imageUri = previewFile?.exists ? previewFile.uri : null;
  return (
    <View style={attachmentStyles.row}>
      <View style={attachmentStyles.iconBox}>
        {imageUri !== null
          ? <Image source={{ uri: imageUri }} resizeMode="cover" style={attachmentStyles.thumbnail} accessibilityLabel={'Thumbnail for ' + item.name} />
          : <FontAwesome name={icon} size={26} color="#25392b" />}
      </View>
      <View style={attachmentStyles.details}>
        <Text style={attachmentStyles.name} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
        <Text style={attachmentStyles.meta}>{Math.max(1, Math.ceil(item.size / 1024))} KB</Text>
        <Text style={attachmentStyles.status} numberOfLines={1}>Stored on this device</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Attachment actions for ' + item.name}
        accessibilityHint="Shows Preview, Share, Rename, and Remove actions."
        onPress={() => onOpenActions(item)}
        style={attachmentStyles.moreButton}
      >
        <FontAwesome name="ellipsis-v" size={18} color="#2e6a18" accessible={false} />
      </Pressable>
    </View>
  );
}

function AttachmentActionsMenu({ attachment, onClose, onPreview, onShare, onRename, onRemove, busy, sharing }: {
  attachment: StoredAttachment | null;
  onClose: () => void;
  onPreview: (item: StoredAttachment) => void;
  onShare: (item: StoredAttachment) => void;
  onRename: (item: StoredAttachment) => void;
  onRemove: (item: StoredAttachment) => void;
  busy: boolean;
  sharing: boolean;
}) {
  if (attachment === null) return null;

  const actions = [
    { label: 'Preview', icon: 'eye' as const, run: onPreview, destructive: false, disabled: busy },
    { label: sharing ? 'Sharing…' : 'Share', icon: 'share-alt' as const, run: onShare, destructive: false, disabled: busy || sharing },
    { label: 'Rename', icon: 'pencil' as const, run: onRename, destructive: false, disabled: busy },
    { label: 'Remove', icon: 'trash-o' as const, run: onRemove, destructive: true, disabled: busy },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={attachmentStyles.menuOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close attachment actions" onPress={onClose} style={attachmentStyles.menuBackdrop} />
        <View accessibilityLabel={'Attachment actions for ' + attachment.name} style={attachmentStyles.menu}>
          <Text numberOfLines={1} style={attachmentStyles.menuTitle}>{attachment.name}</Text>
          {actions.map(action => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label.replace('…', '') + ' ' + attachment.name}
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              onPress={() => { onClose(); action.run(attachment); }}
              style={({ pressed }) => [attachmentStyles.menuAction, pressed && attachmentStyles.menuActionPressed]}
            >
              <FontAwesome name={action.icon} size={17} color={action.destructive ? '#b3261e' : '#52634b'} accessible={false} />
              <Text style={[attachmentStyles.menuActionText, action.destructive && attachmentStyles.menuActionDanger]}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={attachmentStyles.menuCancel}>
            <Text style={attachmentStyles.menuCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AttachmentRenameDialog({ visible, value, busy, onChange, onCancel, onSave }: {
  visible: boolean;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={attachmentStyles.dialogOverlay}>
        <View style={attachmentStyles.dialog}>
          <Text style={attachmentStyles.dialogTitle}>Rename attachment</Text>
          <TextInput accessibilityLabel="Attachment file name" value={value} onChangeText={onChange} autoFocus selectTextOnFocus maxLength={120} editable={!busy} returnKeyType="done" onSubmitEditing={onSave} style={attachmentStyles.input} />
          <View style={attachmentStyles.dialogButtons}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={attachmentStyles.dialogButton}><Text style={attachmentStyles.dialogButtonText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onSave} style={attachmentStyles.dialogButton}><Text style={attachmentStyles.dialogButtonText}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const attachmentStyles = StyleSheet.create({
  row: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: '#dce3dc', borderRadius: 16, backgroundColor: '#fff', minHeight: 88 },
  iconBox: { width: 58, height: 64, flexShrink: 0, borderRadius: 12, backgroundColor: '#f0f4f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  details: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: '#1f2c21', fontWeight: '700', fontSize: 15 },
  meta: { color: '#687568', fontSize: 13 },
  status: { color: '#42862d', fontSize: 12 },
  moreButton: { width: 42, height: 42, flexShrink: 0, borderRadius: 12, backgroundColor: '#f0f4f0', alignItems: 'center', justifyContent: 'center' },
  menuOverlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  menuBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  menu: { width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 4, elevation: 8 },
  menuTitle: { color: '#263b22', fontSize: 16, fontWeight: '700', paddingHorizontal: 10, paddingBottom: 8 },
  menuAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: 10 },
  menuActionPressed: { backgroundColor: '#f0f4ed' },
  menuActionText: { color: '#2e6a18', fontSize: 15, fontWeight: '600' },
  menuActionDanger: { color: '#b3261e' },
  menuCancel: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 12, marginTop: 4 },
  menuCancelText: { color: '#52634b', fontWeight: '700' },
  dialogOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: '#263b22' },
  input: { borderWidth: 1, borderColor: '#aebcad', borderRadius: 8, padding: 12, color: '#1f2c21' },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  dialogButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#e7f2e1' },
  dialogButtonText: { color: '#263b22', fontWeight: '700' },
});

async function requireAvailableAttachment(noteId: string, attachmentId: string): Promise<StoredAttachment> {
  const item = (await service.list(noteId)).find(candidate => candidate.id === attachmentId);
  if (!item) throw new Error('This attachment is no longer available.');
  return item;
}

async function shareAttachment(noteId: string, item: StoredAttachment): Promise<void> {
  const current = await requireAvailableAttachment(noteId, item.id);
  const file = files.fileForPreview(current.fileKey);
  if (!file.exists) throw new Error('This attachment is missing from this device.');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Android file sharing is unavailable on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: current.mimeType,
    dialogTitle: current.name,
    UTI: current.mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
  });
}

function attachmentError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Local-only attachments for SAVED ordinary notes. No cloud sync or private vault. */
export function NoteAttachments({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredAttachment | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredAttachment | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<StoredAttachment | null>(null);
  const refresh = useCallback(async () => {
    try { setItems(await service.list(noteId)); setError(null); }
    catch (reason) { setError(attachmentError(reason, 'Unable to read attachments.')); }
  }, [noteId]);
  useEffect(() => {
    let active = true;
    void service.list(noteId).then(attachments => {
      if (active) { setItems(attachments); setError(null); }
    }).catch(reason => {
      if (active) setError(attachmentError(reason, 'Unable to read attachments.'));
    });
    return () => { active = false; };
  }, [noteId]);

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      const selected = await pickAndroidAttachments((await service.list(noteId)).length);
      try {
        for (const file of selected) await service.add(noteId, file);
      } finally {
        await refresh();
      }
    } catch (reason) {
      Alert.alert('Attachment not added', attachmentError(reason, 'Please try again.'));
    } finally { setBusy(false); }
  }

  async function share(item: StoredAttachment) {
    if (busy || sharingId !== null) return;
    setSharingId(item.id);
    try { await shareAttachment(noteId, item); }
    catch (reason) { Alert.alert('Unable to share attachment', attachmentError(reason, 'Please try again.')); }
    finally { setSharingId(null); }
  }

  async function openPreview(item: StoredAttachment) {
    try { setPreview(await requireAvailableAttachment(noteId, item.id)); }
    catch (reason) { Alert.alert('Unable to preview attachment', attachmentError(reason, 'Please try again.')); }
  }

  function beginRename(item: StoredAttachment) {
    setRenameTarget(item);
    setRenameValue(item.name);
  }

  async function saveRename() {
    if (!renameTarget || busy) return;
    setBusy(true);
    try {
      await service.rename(noteId, renameTarget.id, renameValue);
      await refresh();
      setRenameTarget(null);
    } catch (reason) {
      Alert.alert('Unable to rename attachment', attachmentError(reason, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function remove(item: StoredAttachment) {
    Alert.alert('Remove attachment?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void (async () => {
          setBusy(true);
          try { await service.remove(noteId, item.id); await refresh(); }
          catch (reason) { Alert.alert('Unable to remove', attachmentError(reason, 'Please try again.')); }
          finally { setBusy(false); }
        })();
      } },
    ]);
  }

  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <Text style={{ fontWeight: '700', color: '#263b22' }}>Attachments ({items.length}/5)</Text>
      <Text style={{ color: '#596b55' }}>Stored on this device only. Not synced to the web app.</Text>
      {error !== null && <Text accessibilityRole="alert" style={{ color: '#a32222' }}>{error}</Text>}
      {items.map(item => (
        <AttachmentRow key={item.id} item={item} onOpenActions={setActionsTarget} />
      ))}
      <AttachmentActionsMenu
        attachment={actionsTarget}
        onClose={() => setActionsTarget(null)}
        onPreview={item => { void openPreview(item); }}
        onShare={item => { void share(item); }}
        onRename={beginRename}
        onRemove={remove}
        busy={busy}
        sharing={sharingId === actionsTarget?.id}
      />
      {preview !== null && <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
      <AttachmentRenameDialog visible={renameTarget !== null} value={renameValue} busy={busy}
        onChange={setRenameValue} onCancel={() => setRenameTarget(null)} onSave={() => { void saveRename(); }} />
      <Pressable accessibilityRole="button" disabled={busy || items.length >= 5}
        onPress={() => { void add(); }} style={{ padding: 12, backgroundColor: '#e7f2e1', borderRadius: 8 }}>
        <Text style={{ color: '#263b22', fontWeight: '700' }}>{busy ? 'Working…' : 'Add attachment'}</Text>
      </Pressable>
    </View>
  );
}

/** Attachment list and file actions for saved ordinary-note cards. Files stay local. */
export function NoteAttachmentSummary({ noteId, onPreviewVisibilityChange }: { noteId: string; onPreviewVisibilityChange?: (visible: boolean) => void }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<StoredAttachment | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<StoredAttachment | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredAttachment | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setItems(await service.list(noteId)); setError(null); }
    catch (reason) { setError(attachmentError(reason, 'Attachments are unavailable on this device.')); }
  }, [noteId]);
  useEffect(() => {
    let active = true;
    void service.list(noteId).then(attachments => {
      if (active) setItems(attachments);
    }).catch(() => {
      if (active) setError('Attachments are unavailable on this device.');
    }).finally(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, [noteId]);

  async function share(item: StoredAttachment) {
    if (busy || sharingId !== null) return;
    setSharingId(item.id);
    try { await shareAttachment(noteId, item); }
    catch (reason) { Alert.alert('Unable to share attachment', attachmentError(reason, 'Please try again.')); }
    finally { setSharingId(null); }
  }

  async function openPreview(item: StoredAttachment) {
    try {
      setPreview(await requireAvailableAttachment(noteId, item.id));
      onPreviewVisibilityChange?.(true);
    } catch (reason) {
      Alert.alert('Unable to preview attachment', attachmentError(reason, 'Please try again.'));
    }
  }

  function beginRename(item: StoredAttachment) {
    setRenameTarget(item);
    setRenameValue(item.name);
  }

  async function saveRename() {
    if (!renameTarget || busy) return;
    setBusy(true);
    try {
      await service.rename(noteId, renameTarget.id, renameValue);
      await refresh();
      setRenameTarget(null);
    } catch (reason) {
      Alert.alert('Unable to rename attachment', attachmentError(reason, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function remove(item: StoredAttachment) {
    Alert.alert('Remove attachment?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void (async () => {
          setBusy(true);
          try { await service.remove(noteId, item.id); await refresh(); }
          catch (reason) { Alert.alert('Unable to remove', attachmentError(reason, 'Please try again.')); }
          finally { setBusy(false); }
        })();
      } },
    ]);
  }

  if (!loaded || (items.length === 0 && error === null)) return null;
  if (error !== null) {
    return <Text accessibilityRole="alert" style={{ color: '#7a4b00', marginTop: 8 }}>{error}</Text>;
  }
  return (
    <View accessibilityLabel="Note attachments" style={{ gap: 6, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e6ebdf' }}>
      <Text style={{ color: '#34452f', fontWeight: '700' }}>Attachments ({items.length})</Text>
      {items.map(item => <AttachmentRow key={item.id} item={item} onOpenActions={setActionsTarget} />)}
      <AttachmentActionsMenu
        attachment={actionsTarget}
        onClose={() => setActionsTarget(null)}
        onPreview={item => { void openPreview(item); }}
        onShare={item => { void share(item); }}
        onRename={beginRename}
        onRemove={remove}
        busy={busy}
        sharing={sharingId === actionsTarget?.id}
      />
      {preview !== null && <AttachmentPreview attachment={preview} onClose={() => { setPreview(null); onPreviewVisibilityChange?.(false); }} />}
      <AttachmentRenameDialog visible={renameTarget !== null} value={renameValue} busy={busy}
        onChange={setRenameValue} onCancel={() => setRenameTarget(null)} onSave={() => { void saveRename(); }} />
      <Text style={{ color: '#596b55', fontSize: 12 }}>Stored on this device only. Not synced to the web app.</Text>
    </View>
  );
}
