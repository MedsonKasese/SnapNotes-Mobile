import {
  authStateFromUser,
  type AuthState,
  type AuthUserLike,
} from './authState.ts';

export type AuthStateObserver = (
  next: (user: AuthUserLike | null) => void,
  error: () => void,
) => () => void;

export function subscribeToAuthState(
  subscribe: AuthStateObserver,
  onState: (state: AuthState) => void,
): () => void {
  return subscribe(
    (user) => onState(authStateFromUser(user)),
    () => onState({ status: 'unavailable' }),
  );
}
