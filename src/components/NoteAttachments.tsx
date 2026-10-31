import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
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


function AttachmentRow({ item, action, onAction, onPreview, onRename }: {
  item: StoredAttachment;
  action?: string;
  onAction?: () => void;
  onPreview?: () => void;
  onRename?: () => void;
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
        <Text style={attachmentStyles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={attachmentStyles.meta}>{Math.max(1, Math.ceil(item.size / 1024))} KB</Text>
        <Text style={attachmentStyles.status}>Stored on this device</Text>
      </View>
      {onPreview && <Pressable accessibilityRole="button" accessibilityLabel={'Preview ' + item.name} onPress={onPreview} style={attachmentStyles.action}><Text style={attachmentStyles.actionText}>Preview</Text></Pressable>}
      {onRename && <Pressable accessibilityRole="button" accessibilityLabel={'Rename ' + item.name} onPress={onRename} style={attachmentStyles.action}><Text style={attachmentStyles.actionText}>Rename</Text></Pressable>}
      {action && onAction && (
        <Pressable accessibilityRole="button" accessibilityLabel={action + ' ' + item.name}
          onPress={onAction} style={attachmentStyles.action}>
          <Text style={attachmentStyles.actionText}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const attachmentStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: '#dce3dc', borderRadius: 16, backgroundColor: '#fff', minHeight: 94 },
  iconBox: { width: 62, height: 68, borderRadius: 12, backgroundColor: '#f0f4f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  details: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: '#1f2c21', fontWeight: '700', fontSize: 15 },
  meta: { color: '#687568', fontSize: 13 },
  status: { color: '#42862d', fontSize: 12 },
  action: { paddingHorizontal: 6, paddingVertical: 12 },
  actionText: { color: '#2e6a18', fontWeight: '700', fontSize: 13 },
  dialogOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: '#263b22' },
  input: { borderWidth: 1, borderColor: '#aebcad', borderRadius: 8, padding: 12, color: '#1f2c21' },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  dialogButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#e7f2e1' },
  dialogButtonText: { color: '#263b22', fontWeight: '700' },
});

/** Local-only attachments for SAVED ordinary notes. No cloud sync or private vault. */
export function NoteAttachments({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StoredAttachment | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredAttachment | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setItems(await service.list(noteId)); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to read attachments.'); }
  }, [noteId]);
  useEffect(() => {
    let active = true;
    void service.list(noteId).then(items => {
      if (active) { setItems(items); setError(null); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to read attachments.');
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
      Alert.alert('Attachment not added', reason instanceof Error ? reason.message : 'Please try again.');
    } finally { setBusy(false); }
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
      Alert.alert('Unable to rename attachment', reason instanceof Error ? reason.message : 'Please try again.');
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
          catch (reason) { Alert.alert('Unable to remove', reason instanceof Error ? reason.message : 'Please try again.'); }
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
        <AttachmentRow key={item.id} item={item} action="Remove" onAction={() => { if (!busy) remove(item); }} onRename={() => { if (!busy) beginRename(item); }} onPreview={() => setPreview(item)} />
      ))}
      {preview !== null && <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
      <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={attachmentStyles.dialogOverlay}>
          <View style={attachmentStyles.dialog}>
            <Text style={attachmentStyles.dialogTitle}>Rename attachment</Text>
            <TextInput accessibilityLabel="Attachment file name" value={renameValue} onChangeText={setRenameValue} autoFocus selectTextOnFocus maxLength={120} editable={!busy} returnKeyType="done" onSubmitEditing={() => { void saveRename(); }} style={attachmentStyles.input} />
            <View style={attachmentStyles.dialogButtons}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setRenameTarget(null)} style={attachmentStyles.dialogButton}><Text style={attachmentStyles.dialogButtonText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void saveRename(); }} style={attachmentStyles.dialogButton}><Text style={attachmentStyles.dialogButtonText}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Pressable accessibilityRole="button" disabled={busy || items.length >= 5}
        onPress={() => { void add(); }} style={{ padding: 12, backgroundColor: '#e7f2e1', borderRadius: 8 }}>
        <Text style={{ color: '#263b22', fontWeight: '700' }}>{busy ? 'Working…' : 'Add attachment'}</Text>
      </Pressable>
    </View>
  );
}

/** Read-only attachment list for ordinary saved-note cards. Files stay local. */
export function NoteAttachmentSummary({ noteId, onPreviewVisibilityChange }: { noteId: string; onPreviewVisibilityChange?: (visible: boolean) => void }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<StoredAttachment | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!loaded || (items.length === 0 && error === null)) return null;
  if (error !== null) {
    return <Text accessibilityRole="alert" style={{ color: '#7a4b00', marginTop: 8 }}>{error}</Text>;
  }
  return (
    <View accessibilityLabel="Note attachments" style={{ gap: 6, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e6ebdf' }}>
      <Text style={{ color: '#34452f', fontWeight: '700' }}>Attachments ({items.length})</Text>
      {items.map(item => <AttachmentRow key={item.id} item={item} onPreview={() => { setPreview(item); onPreviewVisibilityChange?.(true); }} />)}
      {preview !== null && <AttachmentPreview attachment={preview} onClose={() => { setPreview(null); onPreviewVisibilityChange?.(false); }} />}
      <Text style={{ color: '#596b55', fontSize: 12 }}>Stored on this device only. Not synced to the web app.</Text>
    </View>
  );
}
