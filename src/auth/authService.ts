import {
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { getMobileAuth } from '../firebase/firebaseAuth';
import { createAuthService, type AuthServiceDependencies } from './authServiceCore';

const firebaseDependencies: AuthServiceDependencies<Auth, User> = {
  getMobileAuth,
  getCurrentUser: (auth) => auth.currentUser,
  createUserWithEmailAndPassword: (auth, email, password) =>
    createUserWithEmailAndPassword(auth, email, password),
  signInWithEmailAndPassword: (auth, email, password) =>
    signInWithEmailAndPassword(auth, email, password),
  updateProfile: (user, profile) => updateProfile(user, profile),
  sendEmailVerification: (user) => sendEmailVerification(user),
  reloadUser: (user) => reload(user),
  sendPasswordResetEmail: (auth, email) => sendPasswordResetEmail(auth, email),
  signOut: (auth) => signOut(auth),
};

export { AuthOperationError, PASSWORD_RESET_NEUTRAL_MESSAGE, VERIFICATION_RESEND_COOLDOWN_MS } from './authServiceCore';
export const authService = createAuthService(firebaseDependencies);
