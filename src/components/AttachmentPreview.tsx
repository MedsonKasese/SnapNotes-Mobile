import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Pdf from 'react-native-pdf';
import { attachmentPreviewKind } from '../attachmentRules';
import { createAndroidAttachmentFiles } from '../androidAttachmentFiles';
import { getAttachmentPreviewDisplayState, type AttachmentPreviewLoadState } from '../attachmentPreviewState';
import type { StoredAttachment } from '../attachmentManifest';

const files = createAndroidAttachmentFiles();

export function AttachmentPreview({ attachment, onClose }: {
  attachment: StoredAttachment;
  onClose: () => void;
}) {
  const { fileKey, mimeType } = attachment;
  const kind = attachmentPreviewKind(mimeType);
  const [preview, setPreview] = useState<AttachmentPreviewLoadState | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<number | null>(null);

  useEffect(() => {
    if (kind !== 'text') return;
    let active = true;
    void Promise.resolve().then(async () => {
      try {
        const file = files.fileForPreview(fileKey);
        if (!file.exists) throw new Error('This attachment is missing from this device.');
        const value = await file.text();
        if (active) setPreview({ fileKey, kind, textContent: value, error: null });
      } catch (reason) {
        if (active) setPreview({
          fileKey,
          kind,
          textContent: null,
          error: reason instanceof Error ? reason.message : 'Unable to preview this file.',
        });
      }
    });
    return () => { active = false; };
  }, [fileKey, kind]);

  const file = files.fileForPreview(fileKey);
  const display = getAttachmentPreviewDisplayState(kind, fileKey, preview);

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
        {kind === 'pdf' ? (
          !file.exists ? (
            <View style={styles.message}><Text style={styles.messageText}>This attachment is missing from this device.</Text></View>
          ) : pdfError !== null ? (
            <View style={styles.message}>
              <FontAwesome name="exclamation-circle" size={30} color="#a05d20" />
              <Text style={styles.messageText}>{pdfError}</Text>
            </View>
          ) : (
            <View style={styles.pdfContainer}>
              {pdfPages !== null && <Text style={styles.pageCount}>{pdfPages} {pdfPages === 1 ? 'page' : 'pages'} · Pinch to zoom</Text>}
              <Pdf
                source={{ uri: file.uri, cache: false }}
                style={styles.pdf}
                trustAllCerts={false}
                enablePaging={false}
                horizontal={false}
                onLoadComplete={pages => setPdfPages(pages)}
                onError={() => setPdfError('Unable to open this PDF. The file may be damaged or unsupported.')}
              />
            </View>
          )
        ) : display.status === 'loading' ? <ActivityIndicator style={styles.center} size="large" color="#389c0e" />
          : display.status === 'error' ? (
            <View style={styles.message}>
              <FontAwesome name="exclamation-circle" size={30} color="#a05d20" />
              <Text style={styles.messageText}>{display.error}</Text>
            </View>
          ) : display.status === 'image' ? (
            <Image source={{ uri: file.uri }} resizeMode="contain" style={styles.image}
              accessibilityLabel={'Preview of ' + attachment.name}
              onError={() => setPreview({
                fileKey,
                kind,
                textContent: null,
                error: 'Could not display this image. The file may be damaged.',
              })} />
          ) : (
            <ScrollView contentContainerStyle={styles.textContainer}>
              <Text selectable style={styles.fileText}>{display.textContent}</Text>
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
  pdfContainer: { flex: 1 },
  pdf: { flex: 1, width: '100%', backgroundColor: '#f8faf7' },
  pageCount: { textAlign: 'center', paddingVertical: 8, color: '#5d7359', fontSize: 12 },
  textContainer: { padding: 20 },
  fileText: { fontSize: 15, lineHeight: 24, color: '#203222' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  messageText: { textAlign: 'center', color: '#5b5143', lineHeight: 23 },
});
