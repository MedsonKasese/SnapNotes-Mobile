import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');

test('native shell keeps branding and search outside the scrolling note list', () => {
  assert.match(source, /<View style={styles\.appHeader}>[\s\S]*?accessibilityLabel="Search saved notes"/);
  assert.match(source, /<FlatList[\s\S]*?data={visibleNotes}/);
  assert.doesNotMatch(source, /ListHeaderComponent=/);
});

test('navigation exposes only implemented destinations and explains upcoming migration areas', () => {
  assert.match(source, /label="All notes"/);
  assert.match(source, /label="New note"/);
  assert.match(source, /Folders, archive, trash, settings, and account features/);
  assert.doesNotMatch(source, /Categories, folders/);
  assert.match(source, /NOTE_CATEGORIES\.map\(category => <MenuRow/);
  assert.match(source, /onPress=\{\(\) => selectLibraryCategory\('all'\)\}/);
  assert.doesNotMatch(source, /data-category=/);
});

test('drawer backdrop fills the screen using the supported React Native API', () => {
  assert.match(source, /style={styles\.drawerBackdrop}/);
  assert.match(source, /drawerBackdrop: \{ \.\.\.StyleSheet\.absoluteFill,/);
  assert.doesNotMatch(source, /StyleSheet\.absoluteFillObject/);
});

test('Android back and navigation guard unsaved editor changes', () => {
  assert.match(source, /BackHandler\.addEventListener\('hardwareBackPress', handleBack\)/);
  assert.match(source, /Discard unsaved changes\?/);
  assert.match(source, /function openLibrary\(\)[\s\S]*?confirmDiscard/);
});

test('search remains clearable and note cards open the editor', () => {
  assert.match(source, /accessibilityLabel="Clear search"/);
  assert.match(source, /onChangeText={setSearchQuery}/);
  assert.match(source, /onPress={\(\) => editNote\(item\.id\)}/);
});
