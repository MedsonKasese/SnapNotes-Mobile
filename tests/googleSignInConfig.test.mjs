import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const appConfig = require('../app.config.js');
const baseConfig = require('../app.json').expo;

function withIosScheme(value, action) {
  const previous = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  if (value === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  else process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = value;
  try {
    return action();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
    else process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = previous;
  }
}

test('Android configuration works without a Google Services file or iOS OAuth setup', () => {
  withIosScheme(undefined, () => {
    const result = appConfig({ config: baseConfig });
    assert.deepEqual(result.android, baseConfig.android);
    assert.equal(result.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin'), false);
  });
});

test('configured iOS reversed client ID is registered through the native config plugin', () => {
  withIosScheme('com.googleusercontent.apps.123456-ios', () => {
    const result = appConfig({ config: baseConfig });
    assert.ok(result.plugins.some((plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === 'react-native-nitro-google-signin' &&
      plugin[1]?.iosUrlScheme === 'com.googleusercontent.apps.123456-ios',
    ));
  });
});

test('malformed iOS URL schemes fail config validation clearly', () => {
  withIosScheme('not-a-reversed-client-id', () => {
    assert.throws(() => appConfig({ config: baseConfig }), /must be the reversed iOS OAuth client ID/);
  });
});
