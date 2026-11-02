export type AuthField = 'displayName' | 'email' | 'password' | 'confirmPassword';
export type AuthFieldErrors = Partial<Record<AuthField, string>>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/g, ' ');
}

function emailError(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  if (!normalized) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Enter a valid email address.';
  }
  return undefined;
}

export function validateSignIn(email: string, password: string): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const emailMessage = emailError(email);
  if (emailMessage) errors.email = emailMessage;
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export function validateRegistration(
  displayName: string,
  email: string,
  password: string,
  confirmPassword: string,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const normalizedName = normalizeDisplayName(displayName);
  if (!normalizedName) errors.displayName = 'Enter your name.';
  else if (normalizedName.length > 80) errors.displayName = 'Use 80 characters or fewer.';

  const emailMessage = emailError(email);
  if (emailMessage) errors.email = emailMessage;

  if (!password) errors.password = 'Enter a password.';
  else if (password.length < 6) errors.password = 'Use at least 6 characters.';
  if (!confirmPassword) errors.confirmPassword = 'Confirm your password.';
  else if (confirmPassword !== password) errors.confirmPassword = 'The passwords do not match.';
  return errors;
}
