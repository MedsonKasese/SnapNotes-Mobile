import { AuthOperationError } from './authServiceCore.ts';
import { getAuthErrorMessage } from './authErrors.ts';

export type GoogleAuthConfiguration = {
  webClientId: string;
  iosClientId?: string;
  iosUrlScheme?: string;
  platform: string;
};

export type NativeGoogleSignInResponse =
  | { type: 'success'; data: { idToken: string } | null }
  | { type: 'cancelled'; data?: null }
  | { type: 'noSavedCredentialFound'; data?: null };

export type NativeGoogleSignIn = {
  configure: (configuration: GoogleAuthConfiguration) => void | Promise<void>;
  checkPlayServices: () => Promise<void>;
  presentExplicitSignIn: () => Promise<NativeGoogleSignInResponse>;
};

export type GoogleAuthServiceDependencies<TAuth, TCredential> = {
  getConfiguration: () => GoogleAuthConfiguration;
  loadNativeSignIn: () => Promise<NativeGoogleSignIn>;
  getAuth: () => TAuth;
  credentialFromIdToken: (idToken: string) => TCredential;
  signInWithCredential: (auth: TAuth, credential: TCredential) => Promise<unknown>;
};

export function getGoogleAuthConfigurationError(
  configuration: GoogleAuthConfiguration,
): AuthOperationError | null {
  if (!configuration.webClientId.trim()) {
    return new AuthOperationError(
      'Google sign-in is not configured for this build. Use email sign-in or continue with local notes.',
    );
  }

  if (configuration.platform === 'ios') {
    if (!configuration.iosClientId?.trim() || !configuration.iosUrlScheme?.trim()) {
      return new AuthOperationError(
        'Google sign-in is not configured for iOS on this build. Use email sign-in or continue with local notes.',
      );
    }
    if (!configuration.iosUrlScheme.startsWith('com.googleusercontent.apps.')) {
      return new AuthOperationError(
        'Google sign-in is not configured for iOS on this build. Use email sign-in or continue with local notes.',
      );
    }
  } else if (configuration.platform !== 'android') {
    return new AuthOperationError(
      'Google sign-in is available in the Android and iOS app builds. Local notes remain available.',
    );
  }

  return null;
}

function safeGoogleAuthError(error: unknown): AuthOperationError {
  if (error instanceof AuthOperationError) return error;
  return new AuthOperationError(getAuthErrorMessage(error));
}

export function createGoogleAuthService<TAuth, TCredential>(
  dependencies: GoogleAuthServiceDependencies<TAuth, TCredential>,
) {
  function configurationError(): AuthOperationError | null {
    return getGoogleAuthConfigurationError(dependencies.getConfiguration());
  }

  return {
    isConfigured(): boolean {
      return configurationError() === null;
    },

    async signIn(): Promise<{ status: 'signed-in' | 'cancelled' }> {
      const configuration = dependencies.getConfiguration();
      const configError = getGoogleAuthConfigurationError(configuration);
      if (configError) throw configError;

      try {
        const nativeSignIn = await dependencies.loadNativeSignIn();
        await nativeSignIn.configure(configuration);
        await nativeSignIn.checkPlayServices();
        const response = await nativeSignIn.presentExplicitSignIn();

        if (response.type === 'cancelled') return { status: 'cancelled' };
        if (response.type !== 'success' || !response.data?.idToken) {
          throw new AuthOperationError(
            'Google sign-in could not provide an account token. Try again, or use email sign-in.',
          );
        }

        // Only the Google ID token is exchanged with Firebase Auth. This service
        // intentionally has no note, storage, sync, or Private Notes dependency.
        const credential = dependencies.credentialFromIdToken(response.data.idToken);
        await dependencies.signInWithCredential(dependencies.getAuth(), credential);
        return { status: 'signed-in' };
      } catch (error) {
        throw safeGoogleAuthError(error);
      }
    },
  };
}
