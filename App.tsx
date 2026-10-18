import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>MOBILE FOUNDATION</Text>
          <Text accessibilityRole="header" style={styles.title}>SnapNotes</Text>
          <Text style={styles.tagline}>Save Your Mind.</Text>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>One small step at a time.</Text>
            <Text style={styles.body}>
              This is the starting point for SnapNotes on Android and iOS.
              Notes, sign-in, and sync are not connected yet.
            </Text>
          </View>
          <Text style={styles.footer}>
            Your existing SnapNotes web app stays exactly where it is. Nothing
            here reads or changes your notes.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fc' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  eyebrow: { color: '#475569', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#172554', fontSize: 40, fontWeight: '800' },
  tagline: { color: '#475569', fontSize: 20 },
  card: { backgroundColor: '#fff', borderColor: '#dce2ee', borderWidth: 1, borderRadius: 20, padding: 24, gap: 12, marginTop: 16 },
  heading: { color: '#172554', fontSize: 22, fontWeight: '700' },
  body: { color: '#334155', fontSize: 16, lineHeight: 25 },
  footer: { color: '#475569', fontSize: 14, lineHeight: 22 },
});
