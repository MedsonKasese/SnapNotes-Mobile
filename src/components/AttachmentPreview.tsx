import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { attachmentPreviewKind } from '../attachmentRules';
import { createAndroidAttachmentFiles } from '../androidAttachmentFiles';
import type { StoredAttachment } from '../attachmentManifest';

const files = createAndroidAttachmentFiles();

export function AttachmentPreview({ attachment, onClose }: {
  attachment: StoredAttachment;
  onClose: () => void;
}) {
  const kind = attachmentPreviewKind(attachment.mimeType);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const file = files.fileForPreview(attachment.fileKey);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setTextContent(null);
    async function prepare() {
      try {
        if (!file.exists) throw new Error('This attachment is missing from this device.');
        if (kind === 'text') {
          const value = await file.text();
          if (active) setTextContent(value);
        } else if (kind === 'pdf') {
          throw new Error('PDF page rendering is not yet supported in the Android viewer. Your file remains safely stored.');
        } else if (kind !== 'image') {
          throw new Error('No in-app preview is available for this file type.');
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to preview this file.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void prepare();
    return () => { active = false; };
  }, [attachment.fileKey, kind, file.uri]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text numberOfLines={1} style={styles.title}>{attachment.name}</Text>
            <Text style={styles.subtitle}>Stored on this device</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close attachment preview"
            onPress={onClose} style={styles.close}>
            <FontAwesome name="times" size={22} color="#243925" />
          </Pressable>
        </View>
        {loading ? <ActivityIndicator style={styles.center} size="large" color="#389c0e" />
          : error !== null ? (
            <View style={styles.message}>
              <FontAwesome name="exclamation-circle" size={30} color="#a05d20" />
              <Text style={styles.messageText}>{error}</Text>
            </View>
          ) : kind === 'image' ? (
            <Image source={{ uri: file.uri }} resizeMode="contain" style={styles.image}
              accessibilityLabel={'Preview of ' + attachment.name}
              onError={() => setError('Could not display this image. The file may be damaged.')} />
          ) : (
            <ScrollView contentContainerStyle={styles.textContainer}>
              <Text selectable style={styles.fileText}>{textContent}</Text>
            </ScrollView>
          )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8faf7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8df', backgroundColor: '#fff' },
  titleGroup: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700', color: '#203222' },
  subtitle: { marginTop: 4, fontSize: 12, color: '#5d7359' },
  close: { padding: 12, backgroundColor: '#eff4ed', borderRadius: 12 },
  center: { flex: 1 },
  image: { flex: 1, width: '100%' },
  textContainer: { padding: 20 },
  fileText: { fontSize: 15, lineHeight: 24, color: '#203222' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  messageText: { textAlign: 'center', color: '#5b5143', lineHeight: 23 },
});
