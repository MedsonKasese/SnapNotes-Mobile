export type NativeCryptoProvider = Pick<Crypto, 'getRandomValues' | 'subtle'>;

export type NativeCryptoProviderErrorCode =
  | 'PV-CRYPTO-LOAD'
  | 'PV-CRYPTO-API'
  | 'PV-CRYPTO-NITRO-LOOKUP'
  | 'PV-CRYPTO-NITRO-INIT'
  | 'PV-CRYPTO-NITRO-VERSION'
  | 'PV-CRYPTO-NITRO-MODULE'
  | 'PV-CRYPTO-NITRO-IMPORT';

type NativeCryptoModule = {
  default?: unknown;
  getRandomValues?: unknown;
  subtle?: unknown;
};

const NATIVE_CRYPTO_FAILURE_MESSAGES: Record<NativeCryptoProviderErrorCode, string> = {
  'PV-CRYPTO-LOAD':
    'Quick Crypto/Nitro could not be loaded. Verify native runtime registration and initialization; Metro cannot add native code. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-LOAD]',
  'PV-CRYPTO-API':
    'Quick Crypto loaded, but its required Web Crypto APIs are unavailable. Verify the APK and Metro bundle use the same Quick Crypto version. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-API]',
  'PV-CRYPTO-NITRO-LOOKUP':
    'React Native could not resolve Nitro’s native TurboModule at runtime. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-NITRO-LOOKUP]',
  'PV-CRYPTO-NITRO-INIT':
    'Nitro’s native runtime did not complete initialization. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-NITRO-INIT]',
  'PV-CRYPTO-NITRO-VERSION':
    'The native and JavaScript Nitro runtimes conflict. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-NITRO-VERSION]',
  'PV-CRYPTO-NITRO-MODULE':
    'Nitro reported a native-module error, but safe metadata cannot distinguish lookup from initialization. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-NITRO-MODULE]',
  'PV-CRYPTO-NITRO-IMPORT':
    'React Native found Nitro’s native TurboModule, but Quick Crypto failed to load or initialize. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-NITRO-IMPORT]',
};

export class NativeCryptoProviderUnavailableError extends Error {
  readonly code: NativeCryptoProviderErrorCode;

  constructor(code: NativeCryptoProviderErrorCode) {
    super(NATIVE_CRYPTO_FAILURE_MESSAGES[code]);
    this.name = 'NativeCryptoProviderUnavailableError';
    this.code = code;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function getErrorCause(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Error & { cause?: unknown }).cause;
}

function isNitroModuleNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(error) as { constructor?: unknown } | null;
    return typeof prototype?.constructor === 'function' &&
      prototype.constructor.name === 'ModuleNotFoundError';
  } catch {
    return false;
  }
}

type NitroModuleProbe = () => unknown | Promise<unknown>;

async function probeRegisteredNitroModule(): Promise<unknown> {
  const { TurboModuleRegistry } = await import('react-native');
  return TurboModuleRegistry.get('NitroModules');
}

function hasInstalledNitroProxy(): boolean {
  try {
    const runtimeGlobal = globalThis as typeof globalThis & { NitroModulesProxy?: unknown };
    return runtimeGlobal.NitroModulesProxy != null;
  } catch {
    return false;
  }
}

/**
 * Classify known Nitro signatures and its package-specific error class without
 * returning raw messages or causes to the UI.
 */
function getLoadFailureCode(error: unknown): NativeCryptoProviderErrorCode {
  const message = getErrorMessage(error);
  const cause = getErrorCause(error);
  const causeMessage = getErrorMessage(cause);
  const allMessages = `${message}\n${causeMessage}`;

  if (/Nitro was installed twice:/i.test(message)) {
    return 'PV-CRYPTO-NITRO-VERSION';
  }

  if (
    /Failed to install Nitro:/i.test(message) ||
    /NitroModules was installed, but `global\.NitroModulesProxy` was null/i.test(causeMessage)
  ) {
    return 'PV-CRYPTO-NITRO-INIT';
  }

  if (
    /TurboModuleRegistry\.getEnforcing.*NitroModules.*could not be found/i.test(allMessages) ||
    /Failed to get NitroModules: The native ["']NitroModules["'] Turbo\/Native-Module could not be found/i.test(message) &&
      /NitroModules.*could not be found/i.test(causeMessage)
  ) {
    return 'PV-CRYPTO-NITRO-LOOKUP';
  }

  if (isNitroModuleNotFoundError(error) || isNitroModuleNotFoundError(cause)) {
    return 'PV-CRYPTO-NITRO-MODULE';
  }

  return 'PV-CRYPTO-LOAD';
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
  probeNitroModule: NitroModuleProbe = probeRegisteredNitroModule,
): Promise<NativeCryptoProvider> {
  let nitroModuleAvailable = hasInstalledNitroProxy();
  if (!nitroModuleAvailable) {
    try {
      const nitroModule = await probeNitroModule();
      if (nitroModule == null) {
        throw new NativeCryptoProviderUnavailableError('PV-CRYPTO-NITRO-LOOKUP');
      }
      nitroModuleAvailable = true;
    } catch (error) {
      if (error instanceof NativeCryptoProviderUnavailableError) throw error;
      // The probe is diagnostic only. Defer inconclusive errors to Quick Crypto's import path.
    }
  }

  let loaded: unknown;
  try {
    loaded = await loadModule();
  } catch (error) {
    const code = getLoadFailureCode(error);
    // A generic failure after a positive registry check is more informative,
    // while still keeping native exception details private.
    throw new NativeCryptoProviderUnavailableError(
      code === 'PV-CRYPTO-LOAD' && nitroModuleAvailable ? 'PV-CRYPTO-NITRO-IMPORT' : code,
    );
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
