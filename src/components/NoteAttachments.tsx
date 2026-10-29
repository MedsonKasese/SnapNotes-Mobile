import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
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

/** Local-only attachments for SAVED ordinary notes. No cloud sync or private vault. */
export function NoteAttachments({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [busy, setBusy] = useState(false);
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
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1 }}>{item.name} ({Math.ceil(item.size / 1024)} KB)</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + item.name}
            disabled={busy} onPress={() => remove(item)} style={{ padding: 10 }}>
            <Text style={{ color: '#a32222' }}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Pressable accessibilityRole="button" disabled={busy || items.length >= 5}
        onPress={() => { void add(); }} style={{ padding: 12, backgroundColor: '#e7f2e1', borderRadius: 8 }}>
        <Text style={{ color: '#263b22', fontWeight: '700' }}>{busy ? 'Working…' : 'Add attachment'}</Text>
      </Pressable>
    </View>
  );
}

/** Read-only attachment list for ordinary saved-note cards. Files stay local. */
export function NoteAttachmentSummary({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<StoredAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
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
      {items.map(item => {
        const kind = attachmentPreviewKind(item.mimeType);
        const typeLabel = kind === 'pdf' ? 'PDF' : kind === 'text' ? 'Text' : kind === 'image' ? 'Image' : 'File';
        return (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#53674c', fontSize: 12, fontWeight: '700' }}>{typeLabel}</Text>
            <Text numberOfLines={1} style={{ flex: 1, color: '#34452f' }}>{item.name}</Text>
            <Text style={{ color: '#687567', fontSize: 12 }}>{Math.ceil(item.size / 1024)} KB</Text>
          </View>
        );
      })}
      <Text style={{ color: '#596b55', fontSize: 12 }}>Stored on this device only. Not synced to the web app.</Text>
    </View>
  );
}
