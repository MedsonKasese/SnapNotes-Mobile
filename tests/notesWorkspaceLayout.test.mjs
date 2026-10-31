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
  assert.match(source, /label="Archived" icon="archive"[\s\S]*?onPress={selectArchive}/);
  assert.match(source, /label="Trash" icon="trash"[\s\S]*?onPress={selectTrash}/);
  assert.match(source, /<Text style={styles\.drawerEyebrow}>FOLDERS<\/Text>/);
  assert.match(source, /<ScrollView[^>]*contentContainerStyle={styles\.drawerNavigation}/);
  assert.match(source, /Settings and account features will appear here as they are migrated and tested/);
  assert.doesNotMatch(source, /Folders, Trash, settings/);
  assert.doesNotMatch(source, /Folders, archive, trash/);
  assert.doesNotMatch(source, /Categories, folders/);
  assert.match(source, /NOTE_CATEGORIES\.map\(category => <MenuRow/);
  assert.match(source, /onPress=\{\(\) => selectLibraryCategory\('all'\)\}/);
  assert.doesNotMatch(source, /data-category=/);
});

test('drawer and actions backdrops fill the screen using the supported React Native API', () => {
  assert.match(source, /style={styles\.drawerBackdrop}/);
  assert.match(source, /drawerBackdrop: \{ \.\.\.StyleSheet\.absoluteFill,/);
  assert.match(source, /style={styles\.actionsBackdrop}/);
  assert.match(source, /actionsBackdrop: \{ \.\.\.StyleSheet\.absoluteFill,/);
  assert.doesNotMatch(source, /StyleSheet\.absoluteFillObject/);
});

test('Android back and navigation guard unsaved editor changes', () => {
  assert.match(source, /BackHandler\.addEventListener\('hardwareBackPress', handleBack\)/);
  assert.match(source, /Discard unsaved changes\?/);
  assert.match(source, /function openLibrary\(\)[\s\S]*?confirmDiscard/);
});

test('search remains clearable and note cards expose editing only through their actions menu', () => {
  assert.match(source, /accessibilityLabel="Clear search"/);
  assert.match(source, /onChangeText={setSearchQuery}/);
  assert.doesNotMatch(source, /onPress={\(\) => editNote\(item\.id\)}/);
  assert.match(source, /accessibilityLabel=\{'Edit note: ' \+ title\}/);
  assert.match(source, /<Text style={styles\.actionsMenuText}>Edit note<\/Text>/);
});
