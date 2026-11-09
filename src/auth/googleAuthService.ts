import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { Platform } from 'react-native';
import { getMobileAuth } from '../firebase/firebaseAuth';
import {
  createGoogleAuthService,
  type GoogleAuthConfiguration,
} from './googleAuthServiceCore';

type NitroGoogleSignInModule = typeof import('react-native-nitro-google-signin');

let configuredClientKey: string | null = null;

function readGoogleConfiguration(): GoogleAuthConfiguration {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || undefined,
    iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim() || undefined,
    platform: Platform.OS,
  };
}

const firebaseGoogleAuthDependencies = {
  getConfiguration: readGoogleConfiguration,
  async loadNativeSignIn() {
    // Keep the native-only module lazy so opening the notes workspace does not
    // depend on an installed development build or an available Google provider.
    // Match the lazy Metro require used by the Private Notes native crypto loader.
    // Expo Metro resolves import() and require() through different entry points.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeSignIn = require('react-native-nitro-google-signin') as NitroGoogleSignInModule;
    const { GoogleOneTapSignIn } = nativeSignIn;

    return {
      configure(configuration: GoogleAuthConfiguration) {
        const clientKey = `${configuration.webClientId}\u0000${configuration.iosClientId ?? ''}`;
        if (configuredClientKey !== clientKey) {
          GoogleOneTapSignIn.configure({
            webClientId: configuration.webClientId,
            ...(configuration.iosClientId ? { iosClientId: configuration.iosClientId } : {}),
            offlineAccess: false,
          });
          configuredClientKey = clientKey;
        }
      },
      checkPlayServices: () => GoogleOneTapSignIn.checkPlayServices(),
      async presentExplicitSignIn() {
        const response = await GoogleOneTapSignIn.presentExplicitSignIn();
        if (response.type === 'success') {
          return {
            type: 'success' as const,
            data: response.data ? { idToken: response.data.idToken } : null,
          };
        }
        return response.type === 'cancelled'
          ? { type: 'cancelled' as const, data: null }
          : { type: 'noSavedCredentialFound' as const, data: null };
      },
    };
  },
  getAuth: getMobileAuth,
  credentialFromIdToken: (idToken: string) => GoogleAuthProvider.credential(idToken),
  signInWithCredential: (auth: ReturnType<typeof getMobileAuth>, credential: ReturnType<typeof GoogleAuthProvider.credential>) =>
    signInWithCredential(auth, credential),
};

const googleAuthService = createGoogleAuthService(firebaseGoogleAuthDependencies);

export { googleAuthService };
