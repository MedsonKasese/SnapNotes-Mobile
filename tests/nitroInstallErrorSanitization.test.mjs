import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Nitro install failures expose only a fixed error and never log native exception details', async () => {
  const nativePath = new URL('../node_modules/react-native-nitro-modules/android/src/main/java/com/margelo/nitro/NitroModules.kt', import.meta.url);
  const wrapperPath = new URL('../node_modules/react-native-nitro-modules/src/turbomodule/NativeNitroModules.ts', import.meta.url);
  const patchPath = new URL('../patches/react-native-nitro-modules+0.37.1.patch', import.meta.url);
  const [nativeSource, wrapperSource, patchSource] = await Promise.all([
    readFile(nativePath, 'utf8'),
    readFile(wrapperPath, 'utf8'),
    readFile(patchPath, 'utf8'),
  ]);
  const addedPatchLines = patchSource
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

  assert.match(patchSource, /diff --git a\/node_modules\/react-native-nitro-modules\/android\//);
  assert.match(addedPatchLines, /NITRO_INSTALL_FAILED/);
  assert.doesNotMatch(addedPatchLines, /\bLog\.(?:e|w|i|d)\s*\(|return\s+\w+\.message/);
  assert.match(nativeSource, /private const val NITRO_INSTALL_FAILED = "NITRO_INSTALL_FAILED"/);
  assert.match(nativeSource, /catch \(_: Throwable\)/);
  assert.match(nativeSource, /return NITRO_INSTALL_FAILED/);
  assert.doesNotMatch(nativeSource, /\bLog\.(?:e|w|i|d)\s*\(|return\s+\w+\.message|localizedMessage|stackTrace/);
  assert.match(wrapperSource, /throw new Error\('NITRO_INSTALL_FAILED'\)/);
  assert.doesNotMatch(wrapperSource, /error\.code\s*=|Failed to install Nitro: \$\{errorMessage\}|new Error\([^)]*errorMessage/);
});
