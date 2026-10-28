import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createAndroidAttachmentFiles } from '../androidAttachmentFiles';
import { pickAndroidAttachments } from '../androidAttachmentPicker';
import { createAttachmentManifestStorage } from '../attachmentManifestStorage';
import { createAttachmentService } from '../attachmentService';
import type { StoredAttachment } from '../attachmentManifest';

const files = createAndroidAttachmentFiles();
const service = createAttachmentService(
  files,
  createAttachmentManifestStorage(AsyncStorage),
  () => Crypto.randomUUID().replace(/-/g, ''),
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
  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      const selected = await pickAndroidAttachments((await service.list(noteId)).length);
      for (const file of selected) await service.add(noteId, file);
      await refresh();
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
