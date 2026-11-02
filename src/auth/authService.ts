import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
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
  signOut: (auth) => signOut(auth),
};

export { AuthOperationError } from './authServiceCore';
export const authService = createAuthService(firebaseDependencies);
