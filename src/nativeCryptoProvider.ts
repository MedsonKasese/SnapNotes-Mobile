export type NativeCryptoProvider = Pick<Crypto, 'getRandomValues' | 'subtle'>;

export type NativeCryptoProviderErrorCode = 'PV-CRYPTO-LOAD' | 'PV-CRYPTO-API';

type NativeCryptoModule = {
  default?: unknown;
  getRandomValues?: unknown;
  subtle?: unknown;
};

const NATIVE_CRYPTO_FAILURE_MESSAGES: Record<NativeCryptoProviderErrorCode, string> = {
  'PV-CRYPTO-LOAD':
    'Quick Crypto/Nitro could not be loaded. Verify the installed development APK includes and initializes these native modules; Metro cannot add native code. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-LOAD]',
  'PV-CRYPTO-API':
    'Quick Crypto loaded, but its required Web Crypto APIs are unavailable. Verify the APK and Metro bundle use the same Quick Crypto version. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-API]',
};

export class NativeCryptoProviderUnavailableError extends Error {
  readonly code: NativeCryptoProviderErrorCode;

  constructor(code: NativeCryptoProviderErrorCode) {
    super(NATIVE_CRYPTO_FAILURE_MESSAGES[code]);
    this.name = 'NativeCryptoProviderUnavailableError';
    this.code = code;
  }
}

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
  let loaded: unknown;
  try {
    loaded = await loadModule();
  } catch {
    // Do not surface Nitro, Metro, or native implementation details.
    throw new NativeCryptoProviderUnavailableError('PV-CRYPTO-LOAD');
  }

  try {
    const moduleDefault = loaded && typeof loaded === 'object'
      ? (loaded as NativeCryptoModule).default
      : undefined;
    const provider = isNativeCryptoProvider(moduleDefault) ? moduleDefault : loaded;

    if (!isNativeCryptoProvider(provider)) {
      throw new Error('Required Web Crypto APIs are missing.');
    }

    return provider;
  } catch {
    // Keep malformed or incompatible provider details out of UI and causes.
    throw new NativeCryptoProviderUnavailableError('PV-CRYPTO-API');
  }
}
