export const ACCOUNT_AVATAR_COLORS = [
  '#b45309',
  '#116149',
  '#1d4ed8',
  '#6b21a8',
  '#be123c',
  '#365314',
] as const;

export function getAccountInitials(displayName: string | null | undefined): string | null {
  const nameParts = displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (nameParts.length === 0) return null;

  const firstNameCharacters = Array.from(nameParts[0]);
  const firstInitial = firstNameCharacters[0] ?? '';
  const lastInitial = nameParts.length > 1
    ? Array.from(nameParts[nameParts.length - 1])[0] ?? ''
    : firstNameCharacters[1] ?? '';

  return `${firstInitial}${lastInitial}`.toUpperCase();
}

export function getAccountAvatarInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return getAccountInitials(name) ?? 'US';

  const emailName = email?.split('@')[0]?.replace(/[._+-]+/g, ' ').trim();
  return getAccountInitials(emailName) ?? 'US';
}

export function getRandomAccountAvatarColor(random: () => number = Math.random): string {
  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(1 - Number.EPSILON, Math.max(0, value))
    : 0;
  const index = Math.floor(normalized * ACCOUNT_AVATAR_COLORS.length);
  return ACCOUNT_AVATAR_COLORS[index] ?? ACCOUNT_AVATAR_COLORS[0];
}
