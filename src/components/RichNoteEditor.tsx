import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { noteHtmlToText, plainTextToHtml, sanitizeNoteHtml } from '../noteFormatting';
import { RICH_EDITOR_DOCUMENT } from '../richEditorDocument';

export type FormattingAction = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'checklist' | 'link';
export type FormattingState = { bold?: boolean; italic?: boolean; unordered?: boolean; ordered?: boolean };
export type RichContent = { text: string; html: string };
export type RichNoteEditorHandle = {
  command(action: FormattingAction, url?: string): void;
  rememberSelection(): void;
  getContent(): Promise<RichContent>;
};
type Props = {
  text: string; html?: string; editable: boolean; accessibilityLabel?: string;
  onChange(content: RichContent): void;
  onReady(ready: boolean): void;
  onSelection(state: FormattingState): void;
};
// The source never changes while typing, preventing WebView reload/cursor loss.
const source = { html: RICH_EDITOR_DOCUMENT };

export const RichNoteEditor = forwardRef<RichNoteEditorHandle, Props>(function RichNoteEditor(props, ref) {
  const webView = useRef<WebView<object>>(null);
  const latest = useRef(props);
  latest.current = props;
  const ready = useRef(false);
  const sequence = useRef(0);
  const lastHtml = useRef<string | null>(null);
  const pending = useRef(new Map<number, { resolve: (content: RichContent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const [error, setError] = useState(false);
  const value = sanitizeNoteHtml(props.html ?? plainTextToHtml(props.text));

  const send = useCallback((message: Record<string, unknown>) => {
    const id = ++sequence.current;
    webView.current?.postMessage(JSON.stringify({ ...message, id }));
    return id;
  }, []);
  const synchronize = useCallback(() => {
    const p = latest.current;
    const html = sanitizeNoteHtml(p.html ?? plainTextToHtml(p.text));
    lastHtml.current = html;
    send({ type: 'set-content', html, editable: p.editable });
  }, [send]);
  const rejectPending = useCallback(() => {
    for (const request of pending.current.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('The note editor is not ready. Your draft has been kept. Try again.'));
    }
    pending.current.clear();
  }, []);
  function failed() {
    ready.current = false;
    latest.current.onReady(false);
    rejectPending();
    setError(true);
  }
  useEffect(() => {
    if (!ready.current) return;
    if (value !== lastHtml.current) synchronize();
    else send({ type: 'editable', value: props.editable });
  }, [value, props.editable, synchronize, send]);
  useEffect(() => () => {
    ready.current = false;
    rejectPending();
  }, [rejectPending]);

  useImperativeHandle(ref, () => ({
    command(action, url) {
      if (ready.current && latest.current.editable) send({ type: 'command', command: action, url });
    },
    rememberSelection() { if (ready.current) send({ type: 'remember' }); },
    getContent() {
      if (!ready.current) return Promise.reject(new Error('The note editor is not ready. Please retry before saving.'));
      return new Promise<RichContent>((resolve, reject) => {
        const id = ++sequence.current;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error('The note editor did not respond. Your draft has been kept. Try saving again.'));
        }, 5000);
        pending.current.set(id, { resolve, reject, timer });
        webView.current?.postMessage(JSON.stringify({ type: 'snapshot', id }));
      });
    },
  }));

  return (
    <View style={styles.container}>
      {error ? <View style={styles.error}>
        <Text style={styles.errorText}>The editor stopped responding. Your last recovered draft is still here.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Reload note editor" onPress={() => { setError(false); }} style={styles.retry}>
          <Text style={styles.retryText}>Reload editor</Text>
        </Pressable>
      </View> : <WebView<object>
        ref={webView}
        source={source}
        accessibilityLabel={props.accessibilityLabel ?? 'Note body'}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        onOpenWindow={() => undefined}
        javaScriptCanOpenWindowsAutomatically={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        cacheEnabled={false}
        incognito
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
        automaticallyAdjustContentInsets={false}
        scrollEnabled
        nestedScrollEnabled
        style={styles.webView}
        onError={failed}
        onRenderProcessGone={failed}
        onContentProcessDidTerminate={failed}
        onMessage={event => {
          if (event.nativeEvent.data.length > 200000) return;
          let message: Record<string, unknown>;
          try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
          if (!message || typeof message !== 'object' || Array.isArray(message)) return;
          if (message.type === 'ready') {
            ready.current = true;
            synchronize();
            latest.current.onReady(true);
          } else if (message.type === 'selection') {
            latest.current.onSelection({ bold: message.bold === true, italic: message.italic === true, unordered: message.unordered === true, ordered: message.ordered === true });
          } else if ((message.type === 'change' || message.type === 'snapshot') && typeof message.html === 'string' && ready.current) {
            const html = sanitizeNoteHtml(message.html);
            const content = { html, text: noteHtmlToText(html) };
            lastHtml.current = html;
            if (message.type === 'change') latest.current.onChange(content);
            if (typeof message.id === 'number') {
              const request = pending.current.get(message.id);
              if (request) {
                clearTimeout(request.timer);
                pending.current.delete(message.id);
                request.resolve(content);
              }
            }
          }
        }}
      />}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { height: 220, borderWidth: 1, borderColor: '#d5dfcd', borderRadius: 11, overflow: 'hidden', backgroundColor: '#f8faf6' },
  webView: { flex: 1, backgroundColor: '#f8faf6' },
  error: { padding: 12, gap: 12 },
  errorText: { color: '#b91c1c', fontSize: 14 },
  retry: { alignSelf: 'flex-start', padding: 12, borderRadius: 8, backgroundColor: '#eff7e9' },
  retryText: { color: '#347b0a', fontWeight: '700' },
});
