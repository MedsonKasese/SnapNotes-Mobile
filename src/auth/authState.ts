export type AuthUserSummary = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export type AuthState =
  | { status: 'initializing' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUserSummary }
  | { status: 'unavailable' };

export type AuthUserLike = Pick<
  import('firebase/auth').User,
  'uid' | 'email' | 'displayName' | 'emailVerified'
>;

export const INITIAL_AUTH_STATE: AuthState = { status: 'initializing' };

export function authStateFromUser(user: AuthUserLike | null): AuthState {
  if (!user) return { status: 'signed-out' };

  return {
    status: 'signed-in',
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
    },
  };
}
