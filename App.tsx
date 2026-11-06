import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthStateProvider, useAuthState } from './src/auth/AuthStateProvider';
import { getAccountAvatarInitials } from './src/components/drawerAvatar';
import { AccountAccessModal } from './src/components/AccountAccessModal';
import { NotesWorkspace } from './src/components/NotesWorkspace';

function AuthenticatedApp() {
  const [accountOpen, setAccountOpen] = useState(false);
  const { state: authState } = useAuthState();
  const accountInitials = authState.status === 'signed-in'
    ? getAccountAvatarInitials(authState.user.displayName, authState.user.email)
    : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <NotesWorkspace
          accountInitials={accountInitials}
          onOpenAccount={() => setAccountOpen(true)}
        />
      </SafeAreaView>
      <AccountAccessModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthStateProvider>
      <AuthenticatedApp />
    </AuthStateProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fc' },
});
