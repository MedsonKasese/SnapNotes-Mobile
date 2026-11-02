import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthStateProvider } from './src/auth/AuthStateProvider';
import { AccountAccessModal } from './src/components/AccountAccessModal';
import { NotesWorkspace } from './src/components/NotesWorkspace';

export default function App() {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <AuthStateProvider>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <StatusBar style="dark" />
          <NotesWorkspace onOpenAccount={() => setAccountOpen(true)} />
        </SafeAreaView>
        <AccountAccessModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
      </SafeAreaProvider>
    </AuthStateProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fc' },
});
