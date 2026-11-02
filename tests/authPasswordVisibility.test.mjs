import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const FIELD_VALUE = String.fromCharCode(97, 98, 99, 49, 50, 51);

function mount() {
  const stateSlots = new Map();
  let activeComponent = '';
  let hookIndex = 0;
  const useEffect = () => {};
  const useState = initialValue => {
    const key = `${activeComponent}:${hookIndex++}`;
    if (!stateSlots.has(key)) stateSlots.set(key, initialValue);
    const setValue = next => {
      const current = stateSlots.get(key);
      stateSlots.set(key, typeof next === 'function' ? next(current) : next);
    };
    return [stateSlots.get(key), setValue];
  };
  const useRef = initialValue => {
    const key = `${activeComponent}:${hookIndex++}`;
    if (!stateSlots.has(key)) stateSlots.set(key, { current: initialValue });
    return stateSlots.get(key);
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const moduleExports = {};
  const module = { exports: moduleExports };
  const native = {
    ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Modal: 'Modal', Platform: { OS: 'android' }, Pressable: 'Pressable',
    ScrollView: 'ScrollView', StyleSheet: { create: value => value },
    Text: 'Text', TextInput: 'TextInput', View: 'View',
  };
  const stubs = {
    react: { useEffect, useRef, useState },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../auth/AuthStateProvider': { useAuthState: () => ({ state: { status: 'signed-out' }, retry: async () => {}, refreshVerificationStatus: async () => false }) },
    '../auth/authService': { AuthOperationError: class AuthOperationError extends Error {}, authService: { getVerificationResendCooldownMs: () => 0 } },
    '../auth/authErrors': { getAuthErrorMessage: () => 'Mock auth error' },
    '../auth/authValidation': {
      normalizeDisplayName: value => value.trim(), normalizeEmail: value => value.trim().toLowerCase(),
      validateRegistration: () => ({}), validateSignIn: () => ({}),
    },
    '@expo/vector-icons': { MaterialCommunityIcons: 'MaterialCommunityIcons' },
  };
  vm.runInNewContext(outputText, {
    require: name => {
      assert.ok(stubs[name], `unexpected import: ${name}`);
      return stubs[name];
    },
    module,
    exports: moduleExports,
    console,
  });

  const resolve = (node, path = 'root') => {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${path}.${index}`));
    if (!node || typeof node !== 'object' || !('type' in node)) return node;
    const { type, props } = node;
    if (typeof type === 'function') {
      const previousComponent = activeComponent;
      const previousHookIndex = hookIndex;
      activeComponent = path;
      hookIndex = 0;
      const result = type(props);
      activeComponent = previousComponent;
      hookIndex = previousHookIndex;
      return resolve(result, `${path}.render`);
    }
    return { type, props: { ...props, children: resolve(props.children, `${path}.children`) } };
  };
  const render = () => resolve({ type: module.exports.AccountAccessModal, props: { visible: true, onClose() {} } });
  return { render };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return tree?.props ? [tree, ...elements(tree.props.children)] : [];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props
  ? text(tree.props.children) : typeof tree === 'string' ? tree : '';
function find(tree, predicate) {
  const element = elements(tree).find(predicate);
  assert.ok(element, 'expected account form element');
  return element;
}
const input = (tree, label) => find(tree, item => item.type === 'TextInput' && item.props.accessibilityLabel === label);
const visibilityButton = (tree, label) => find(tree, item => item.type === 'Pressable' && item.props.accessibilityLabel === label);
const textButton = (tree, label) => find(tree, item => item.type === 'Pressable' && text(item) === label);

test('registration and confirmation passwords start masked and toggle independently without losing values', () => {
  const app = mount();
  let tree = app.render();
  textButton(tree, 'Create account').props.onPress();
  tree = app.render();

  assert.equal(input(tree, 'Password').props.secureTextEntry, true);
  assert.equal(input(tree, 'Confirm password').props.secureTextEntry, true);
  assert.equal(visibilityButton(tree, 'Show password').props.accessibilityRole, 'togglebutton');
  assert.equal(visibilityButton(tree, 'Show password').props.accessibilityState.checked, false);
  assert.equal(visibilityButton(tree, 'Show confirmation password').props.accessibilityState.checked, false);

  input(tree, 'Password').props.onChangeText(FIELD_VALUE);
  input(tree, 'Confirm password').props.onChangeText(FIELD_VALUE);
  tree = app.render();
  visibilityButton(tree, 'Show password').props.onPress();
  tree = app.render();

  assert.equal(input(tree, 'Password').props.secureTextEntry, false);
  assert.equal(input(tree, 'Password').props.value, FIELD_VALUE);
  assert.equal(input(tree, 'Confirm password').props.secureTextEntry, true);
  assert.equal(visibilityButton(tree, 'Hide password').props.accessibilityState.checked, true);
  assert.equal(find(tree, item => item.type === 'MaterialCommunityIcons' && item.props.name === 'eye-off').props.accessible, false);

  visibilityButton(tree, 'Show confirmation password').props.onPress();
  tree = app.render();
  assert.equal(input(tree, 'Confirm password').props.secureTextEntry, false);
  assert.equal(input(tree, 'Confirm password').props.value, FIELD_VALUE);
  visibilityButton(tree, 'Hide password').props.onPress();
  tree = app.render();
  assert.equal(input(tree, 'Password').props.secureTextEntry, true);
  assert.equal(input(tree, 'Confirm password').props.secureTextEntry, false);
});

test('login password starts masked and has a labeled show/hide toggle', () => {
  const app = mount();
  let tree = app.render();
  textButton(tree, 'Sign in').props.onPress();
  tree = app.render();

  assert.equal(input(tree, 'Password').props.secureTextEntry, true);
  input(tree, 'Password').props.onChangeText(FIELD_VALUE);
  tree = app.render();
  visibilityButton(tree, 'Show password').props.onPress();
  tree = app.render();

  assert.equal(input(tree, 'Password').props.secureTextEntry, false);
  assert.equal(input(tree, 'Password').props.value, FIELD_VALUE);
  assert.equal(visibilityButton(tree, 'Hide password').props.accessibilityRole, 'togglebutton');
  assert.equal(visibilityButton(tree, 'Hide password').props.accessibilityState.checked, true);
  assert.equal(visibilityButton(tree, 'Hide password').props.accessibilityHint, 'Hides the password on screen');
});
