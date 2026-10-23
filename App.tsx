import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { derivePrivateKey, encryptPrivatePayload, decryptPrivatePayload, generatePrivateSalt } from './src/privateCrypto';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NotesWorkspace } from './src/components/NotesWorkspace';

export default function App() {
  const [cryptoCheck, setCryptoCheck] = useState('Checking Android encryption support…');
  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    (async () => {
      const provider = globalThis.crypto;
      const random = typeof provider?.getRandomValues === 'function';
      const subtle = Boolean(provider?.subtle);
      if (!random || !subtle) {
        if (active) setCryptoCheck(`Private crypto: unavailable (random: ${random}, subtle: ${subtle})`);
        return;
      }
      try {
        const salt = generatePrivateSalt(provider);
        const key = await derivePrivateKey('development-only-password', salt, provider);
        const encrypted = await encryptPrivatePayload({ test: 'android-crypto-check' }, key, salt, provider);
        const decoded = await decryptPrivatePayload(encrypted, key, provider) as { test?: string };
        if (active) setCryptoCheck(decoded.test === 'android-crypto-check' ? 'Private crypto: PASS on this device' : 'Private crypto: FAIL (incorrect decrypted result)');
      } catch (error) {
        if (active) setCryptoCheck(`Private crypto: FAIL (${error instanceof Error ? error.name : 'unknown error'})`);
      }
    })();
    return () => { active = false; };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        {__DEV__ && <View style={styles.cryptoBanner}><Text selectable style={styles.cryptoText}>{cryptoCheck}</Text></View>}
        <NotesWorkspace />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fc' },
  cryptoBanner: { backgroundColor: '#e8f4ed', paddingHorizontal: 12, paddingVertical: 6 },
  cryptoText: { fontSize: 12, color: '#173e28' },
});
