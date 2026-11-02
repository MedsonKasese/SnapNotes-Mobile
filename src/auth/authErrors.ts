function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'string' ? code : null;
}

export function getAuthErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a password that meets the minimum requirements.';
    case 'auth/email-already-in-use':
    case 'auth/email-already-exists':
      return 'We could not complete this request with the provided details. Check them and try again.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email or password is incorrect.';
    case 'auth/user-disabled':
      return 'This account is disabled. Contact the app owner for help.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'There have been too many attempts. Wait a while, then try again.';
    case 'auth/admin-restricted-operation':
      return 'The authentication service has restricted this operation. Contact the app owner for help.';
    case 'auth/operation-not-allowed':
      return 'Email and password authentication is not enabled for this app. Contact the app owner.';
    default:
      return 'Something went wrong. Please try again. Your notes remain on this device.';
  }
}
