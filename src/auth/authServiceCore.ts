import { getAuthErrorMessage } from './authErrors.ts';
import { normalizeDisplayName, normalizeEmail } from './authValidation.ts';

type AuthUserLike = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};
export type AuthServiceDependencies<TAuth, TUser extends AuthUserLike> = {
  getMobileAuth: () => TAuth;
  getCurrentUser: (auth: TAuth) => TUser | null;
  createUserWithEmailAndPassword: (auth: TAuth, email: string, password: string) => Promise<{ user: TUser }>;
  signInWithEmailAndPassword: (auth: TAuth, email: string, password: string) => Promise<unknown>;
  updateProfile: (user: TUser, profile: { displayName: string }) => Promise<void>;
  sendEmailVerification: (user: TUser) => Promise<void>;
  reloadUser: (user: TUser) => Promise<void>;
  sendPasswordResetEmail: (auth: TAuth, email: string) => Promise<void>;
  signOut: (auth: TAuth) => Promise<void>;
  now?: () => number;
};

export const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "If an account exists for this email address, you'll receive password-reset instructions. Check your inbox and spam folder.";

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

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'string' ? code : null;
}

function isEnumerationSensitiveResetError(error: unknown): boolean {
  return new Set([
    'auth/user-not-found',
    'auth/email-not-found',
    'auth/user-disabled',
    'auth/too-many-requests',
  ]).has(errorCode(error) ?? '');
}

export function createAuthService<TAuth, TUser extends AuthUserLike>(
  dependencies: AuthServiceDependencies<TAuth, TUser>,
) {
  const verificationCooldownUntilByUid = new Map<string, number>();
  const now = dependencies.now ?? Date.now;

  function requireCurrentUser(auth: TAuth): TUser {
    const user = dependencies.getCurrentUser(auth);
    if (user) return user;
    throw new AuthOperationError('Your account session is unavailable. Sign in again before retrying.');
  }

  function cooldownRemainingFor(user: TUser): number {
    return Math.max(0, (verificationCooldownUntilByUid.get(user.uid) ?? 0) - now());
  }

  async function resendVerificationEmail(): Promise<void> {
    const auth = dependencies.getMobileAuth();
    const user = requireCurrentUser(auth);
    if (user.emailVerified) {
      throw new AuthOperationError('This email is already verified. Refresh the account status to confirm.');
    }
    const remaining = cooldownRemainingFor(user);
    if (remaining > 0) {
      throw new AuthOperationError(`Wait ${Math.ceil(remaining / 1000)} seconds before requesting another verification email.`);
    }

    // Reserve the cooldown before awaiting Firebase so parallel requests cannot
    // send duplicate emails. A failed send clears the reservation for retry.
    const reservedUntil = now() + VERIFICATION_RESEND_COOLDOWN_MS;
    verificationCooldownUntilByUid.set(user.uid, reservedUntil);
    try {
      await dependencies.sendEmailVerification(user);
    } catch (error) {
      if (verificationCooldownUntilByUid.get(user.uid) === reservedUntil) {
        verificationCooldownUntilByUid.delete(user.uid);
      }
      throw safeOperationError(error);
    }
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
        verificationCooldownUntilByUid.set(user.uid, now() + VERIFICATION_RESEND_COOLDOWN_MS);
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
      await resendVerificationEmail();
    },

    async resendVerificationEmail(): Promise<void> {
      await resendVerificationEmail();
    },

    getVerificationResendCooldownMs(): number {
      const user = dependencies.getCurrentUser(dependencies.getMobileAuth());
      return user ? cooldownRemainingFor(user) : 0;
    },

    async refreshVerificationStatus(): Promise<TUser> {
      try {
        const user = requireCurrentUser(dependencies.getMobileAuth());
        await dependencies.reloadUser(user);
        return user;
      } catch (error) {
        throw safeOperationError(error);
      }
    },

    async requestPasswordReset(email: string): Promise<{ message: string }> {
      try {
        await dependencies.sendPasswordResetEmail(
          dependencies.getMobileAuth(),
          normalizeEmail(email),
        );
      } catch (error) {
        // Firebase may return account-specific failures when project-side
        // enumeration protection is unavailable. Collapse those to the exact
        // same user-visible response as a successful request.
        if (!isEnumerationSensitiveResetError(error)) throw safeOperationError(error);
      }
      return { message: PASSWORD_RESET_NEUTRAL_MESSAGE };
    },
  };
}
