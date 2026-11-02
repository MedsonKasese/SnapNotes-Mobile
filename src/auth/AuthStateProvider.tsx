import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  INITIAL_AUTH_STATE,
  authStateFromUser,
  type AuthState,
} from './authState';
import { subscribeToAuthState } from './authStateSubscription';
import { authService } from './authService';
import { getMobileAuth } from '../firebase/firebaseAuth';

type AuthStateContextValue = {
  state: AuthState;
  retry: () => void;
  refreshVerificationStatus: () => Promise<boolean>;
};

const AuthStateContext = createContext<AuthStateContextValue | null>(null);

export function AuthStateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(INITIAL_AUTH_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => {};

    try {
      unsubscribe = subscribeToAuthState(
        (next, error) => onAuthStateChanged(getMobileAuth(), next, error),
        (nextState) => {
          if (active) setState(nextState);
        },
      );
    } catch {
      // A setup error is not proof that the user is signed out. Defer this
      // state update and keep the device-local workspace rendered meanwhile.
      Promise.resolve().then(() => {
        if (active) setState({ status: 'unavailable' });
      });
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState(INITIAL_AUTH_STATE);
    setAttempt((previous) => previous + 1);
  }, []);
  const refreshVerificationStatus = useCallback(async () => {
    const user = await authService.refreshVerificationStatus();
    setState(authStateFromUser(user));
    return user.emailVerified;
  }, []);
  const value = useMemo(
    () => ({ state, retry, refreshVerificationStatus }),
    [state, retry, refreshVerificationStatus],
  );

  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
}

export function useAuthState(): AuthStateContextValue {
  const value = useContext(AuthStateContext);
  if (!value) throw new Error('useAuthState must be used inside AuthStateProvider.');
  return value;
}
