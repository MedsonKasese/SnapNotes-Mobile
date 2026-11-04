export type NativeCryptoProvider = Pick<Crypto, 'getRandomValues' | 'subtle'>;

type NativeCryptoModule = {
  default?: unknown;
  getRandomValues?: unknown;
  subtle?: unknown;
};

const NATIVE_CRYPTO_UNAVAILABLE_MESSAGE =
  'Native secure cryptography is unavailable. Private Notes encryption requires the SnapNotes development build; Expo Go does not include this native module.';

function isNativeCryptoProvider(value: unknown): value is NativeCryptoProvider {
  if (!value || typeof value !== 'object') return false;

  const provider = value as Partial<NativeCryptoProvider>;
  const subtle = provider.subtle as Partial<SubtleCrypto> | undefined;
  return typeof provider.getRandomValues === 'function' &&
    typeof subtle?.importKey === 'function' &&
    typeof subtle.deriveKey === 'function' &&
    typeof subtle.encrypt === 'function' &&
    typeof subtle.decrypt === 'function' &&
    typeof subtle.exportKey === 'function';
}

/**
 * Load the native provider from the library exports rather than mutating and
 * re-reading globalThis.crypto. Hermes owns the global object, so depending on
 * a global polyfill assignment can fail even when Quick Crypto is available.
 * A supplied loader keeps this boundary testable without loading native code.
 */
export async function createNativeCryptoProvider(
  loadModule: () => Promise<unknown> = () => import('react-native-quick-crypto'),
): Promise<NativeCryptoProvider> {
  try {
    const loaded = await loadModule();
    const moduleDefault = loaded && typeof loaded === 'object'
      ? (loaded as NativeCryptoModule).default
      : undefined;
    const provider = isNativeCryptoProvider(moduleDefault) ? moduleDefault : loaded;

    if (!isNativeCryptoProvider(provider)) {
      throw new Error('Quick Crypto did not export the required Web Crypto APIs.');
    }

    return provider;
  } catch {
    // Native loader errors may include implementation details. Keep them out of
    // the UI, logs, and rejected error causes while still failing closed.
    throw new Error(NATIVE_CRYPTO_UNAVAILABLE_MESSAGE);
  }
}
