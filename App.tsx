import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthStateProvider } from './src/auth/AuthStateProvider';
import { NotesWorkspace } from './src/components/NotesWorkspace';

export default function App() {
  return (
    <AuthStateProvider>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <StatusBar style="dark" />
          <NotesWorkspace />
        </SafeAreaView>
      </SafeAreaProvider>
    </AuthStateProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fc' },
});
