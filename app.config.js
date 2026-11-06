function withGoogleSignInUrlScheme(config) {
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();
  if (!iosUrlScheme) return config;

  if (!iosUrlScheme.startsWith('com.googleusercontent.apps.')) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME must be the reversed iOS OAuth client ID beginning with com.googleusercontent.apps.',
    );
  }

  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  const alreadyConfigured = plugins.some(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin',
  );
  if (!alreadyConfigured) {
    plugins.push(['react-native-nitro-google-signin', { iosUrlScheme }]);
  }

  return { ...config, plugins };
}

module.exports = ({ config } = {}) => {
  const baseConfig = config ?? require('./app.json').expo;
  return withGoogleSignInUrlScheme(baseConfig);
};
