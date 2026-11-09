export const GOOGLE_NATIVE_PROBE_STATUSES = [
  'REACT_NATIVE_IMPORT_FAILED',
  'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE',
  'NITRO_TURBOMODULE_MISSING',
  'NITRO_TURBOMODULE_LOOKUP_FAILED',
  'NITRO_INSTALL_FAILED',
  'NITRO_RUNTIME_INIT_FAILED',
  'GOOGLE_HYBRID_NOT_REGISTERED',
  'GOOGLE_HYBRID_READY',
] as const;

export type GoogleNativeProbeStatus = (typeof GOOGLE_NATIVE_PROBE_STATUSES)[number];

type ModuleLoader = () => Promise<unknown>;
type TurboModuleGetter = () => unknown | Promise<unknown>;
type ProbeDependencies = {
  getNitroTurboModule?: TurboModuleGetter;
  loadReactNative?: ModuleLoader;
  loadNitroModules?: ModuleLoader;
};
type RecordValue = Record<string, unknown>;

const safeStatuses = new Set<string>(GOOGLE_NATIVE_PROBE_STATUSES);
const SAFE_INSTALL_FAILURE_CODE = 'NITRO_INSTALL_FAILED';

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null;
}

function hasSafeInstallFailureCode(error: unknown): boolean {
  try {
    return isRecord(error) && error.code === SAFE_INSTALL_FAILURE_CODE;
  } catch {
    return false;
  }
}

async function importReactNative(): Promise<unknown> {
  return import('react-native');
}

/**
 * Runs only from an explicit development action. Registry lookup reports visibility only;
 * the subsequent Nitro import performs the same runtime install as normal module loading.
 * It does not configure/sign in to Google or access Firebase, network, notes, or private data.
 * All native/JS exceptions are reduced to fixed allowlisted statuses.
 */
export async function runGoogleNativeProbe(
  dependencies: ProbeDependencies = {},
): Promise<GoogleNativeProbeStatus> {
  let getNitroTurboModule = dependencies.getNitroTurboModule;
  if (getNitroTurboModule == null) {
    let reactNative: unknown;
    try {
      reactNative = await (dependencies.loadReactNative ?? importReactNative)();
    } catch {
      return 'REACT_NATIVE_IMPORT_FAILED';
    }

    let registry: RecordValue | null = null;
    try {
      const candidate = isRecord(reactNative) ? reactNative.TurboModuleRegistry : null;
      registry = isRecord(candidate) ? candidate : null;
    } catch {
      return 'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE';
    }
    if (registry == null) return 'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE';

    let registryGetter: unknown;
    try {
      registryGetter = registry.get;
    } catch {
      return 'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE';
    }
    if (typeof registryGetter !== 'function') return 'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE';
    const get = registryGetter as (name: string) => unknown | Promise<unknown>;
    getNitroTurboModule = () => get.call(registry, 'NitroModules');
  }

  let nativeModule: unknown;
  try {
    nativeModule = await getNitroTurboModule();
  } catch {
    return 'NITRO_TURBOMODULE_LOOKUP_FAILED';
  }

  if (nativeModule === null || nativeModule === undefined) {
    return 'NITRO_TURBOMODULE_MISSING';
  }

  let loaded: unknown;
  try {
    loaded = await (dependencies.loadNitroModules ?? (() => import('react-native-nitro-modules')))();
  } catch (error) {
    return hasSafeInstallFailureCode(error)
      ? 'NITRO_INSTALL_FAILED'
      : 'NITRO_RUNTIME_INIT_FAILED';
  }

  if (!isRecord(loaded) || !isRecord(loaded.NitroModules)) {
    return 'NITRO_RUNTIME_INIT_FAILED';
  }

  const runtime = loaded.NitroModules;
  const createHybridObject = runtime.createHybridObject;
  if (typeof createHybridObject !== 'function') return 'NITRO_RUNTIME_INIT_FAILED';

  try {
    const hybrid = createHybridObject.call(runtime, 'NitroGoogleSignin');
    return hybrid === null || hybrid === undefined
      ? 'GOOGLE_HYBRID_NOT_REGISTERED'
      : 'GOOGLE_HYBRID_READY';
  } catch {
    return 'GOOGLE_HYBRID_NOT_REGISTERED';
  }
}

export function getGoogleNativeProbeLabel(
  status: unknown,
  isDevelopment: boolean,
): string | null {
  if (!isDevelopment || typeof status !== 'string' || !safeStatuses.has(status)) return null;
  return `Native Google module check (development only): ${status}`;
}
