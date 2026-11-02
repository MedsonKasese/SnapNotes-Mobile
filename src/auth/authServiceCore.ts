import { getAuthErrorMessage } from './authErrors.ts';
import { normalizeDisplayName, normalizeEmail } from './authValidation.ts';

type AuthUserLike = { email: string | null; displayName: string | null };
export type AuthServiceDependencies<TAuth, TUser extends AuthUserLike> = {
  getMobileAuth: () => TAuth;
  getCurrentUser: (auth: TAuth) => TUser | null;
  createUserWithEmailAndPassword: (auth: TAuth, email: string, password: string) => Promise<{ user: TUser }>;
  signInWithEmailAndPassword: (auth: TAuth, email: string, password: string) => Promise<unknown>;
  updateProfile: (user: TUser, profile: { displayName: string }) => Promise<void>;
  sendEmailVerification: (user: TUser) => Promise<void>;
  signOut: (auth: TAuth) => Promise<void>;
};

export class AuthOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthOperationError';
  }
}

function safeOperationError(error: unknown): AuthOperationError {
  return error instanceof AuthOperationError
    ? error
    : new AuthOperationError(getAuthErrorMessage(error));
}

export function createAuthService<TAuth, TUser extends AuthUserLike>(
  dependencies: AuthServiceDependencies<TAuth, TUser>,
) {
  function requireCurrentUser(auth: TAuth): TUser {
    const user = dependencies.getCurrentUser(auth);
    if (user) return user;
    throw new AuthOperationError('Your account session is unavailable. Sign in again before retrying.');
  }

  return {
    async register(displayName: string, email: string, password: string) {
      const auth = dependencies.getMobileAuth();
      let user: TUser;
      try {
        const credential = await dependencies.createUserWithEmailAndPassword(
          auth,
          normalizeEmail(email),
          password,
        );
        user = credential.user;
      } catch (error) {
        throw safeOperationError(error);
      }

      const name = normalizeDisplayName(displayName);
      let displayNameUpdated = true;
      try {
        await dependencies.updateProfile(user, { displayName: name });
      } catch {
        displayNameUpdated = false;
      }

      let verificationEmailSent = true;
      try {
        await dependencies.sendEmailVerification(user);
      } catch {
        verificationEmailSent = false;
      }

      return {
        email: user.email ?? normalizeEmail(email),
        displayName: displayNameUpdated ? name : user.displayName,
        displayNameUpdated,
        verificationEmailSent,
      };
    },

    async signIn(email: string, password: string): Promise<void> {
      try {
        await dependencies.signInWithEmailAndPassword(
          dependencies.getMobileAuth(),
          normalizeEmail(email),
          password,
        );
      } catch (error) {
        throw safeOperationError(error);
      }
    },

    async signOut(): Promise<void> {
      try {
        // Firebase Auth owns account session state. This deliberately does not
        // access or clear device-local notes, folders, drafts, or the private vault.
        await dependencies.signOut(dependencies.getMobileAuth());
      } catch (error) {
        throw safeOperationError(error);
      }
    },

    async retryRegistrationDisplayName(displayName: string): Promise<void> {
      try {
        const user = requireCurrentUser(dependencies.getMobileAuth());
        await dependencies.updateProfile(user, { displayName: normalizeDisplayName(displayName) });
      } catch (error) {
        throw safeOperationError(error);
      }
    },

    async retryRegistrationVerificationEmail(): Promise<void> {
      try {
        const user = requireCurrentUser(dependencies.getMobileAuth());
        await dependencies.sendEmailVerification(user);
      } catch (error) {
        throw safeOperationError(error);
      }
    },
  };
}
