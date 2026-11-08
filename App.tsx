import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthStateProvider, useAuthState } from './src/auth/AuthStateProvider';
import { getAccountAvatarInitials } from './src/components/drawerAvatar';
import { AccountAccessModal } from './src/components/AccountAccessModal';
import { NotesWorkspace } from './src/components/NotesWorkspace';
import { registerReminderNotificationResponseHandler, type ReminderNotificationTarget } from './src/reminders/notificationResponse';

function AuthenticatedApp() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [reminderTarget, setReminderTarget] = useState<ReminderNotificationTarget | null>(null);
  const { state: authState } = useAuthState();
  const accountInitials = authState.status === 'signed-in'
    ? getAccountAvatarInitials(authState.user.displayName, authState.user.email)
    : null;

  const handleReminderTargetHandled = useCallback(() => setReminderTarget(null), []);

  useEffect(() => {
    return registerReminderNotificationResponseHandler({
      defaultActionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      addListener: listener => Notifications.addNotificationResponseReceivedListener(listener),
      getLastResponse: () => Notifications.getLastNotificationResponse(),
      clearLastResponse: () => Notifications.clearLastNotificationResponse(),
    }, setReminderTarget);
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <NotesWorkspace
          accountInitials={accountInitials}
          onOpenAccount={() => setAccountOpen(true)}
          notificationTarget={reminderTarget}
          onReminderTargetHandled={handleReminderTargetHandled}
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
