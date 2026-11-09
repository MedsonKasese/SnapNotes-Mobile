export const GOOGLE_NATIVE_PROBE_STATUSES = [
  'NITRO_RUNTIME_UNAVAILABLE',
  'GOOGLE_HYBRID_NOT_REGISTERED',
  'GOOGLE_HYBRID_READY',
] as const;

export type GoogleNativeProbeStatus = (typeof GOOGLE_NATIVE_PROBE_STATUSES)[number];

type ModuleLoader = () => Promise<unknown>;
type RecordValue = Record<string, unknown>;

const safeStatuses = new Set<string>(GOOGLE_NATIVE_PROBE_STATUSES);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks Nitro runtime availability and creates the Google hybrid object only.
 * It does not configure Google sign-in, show a picker, access Firebase, or read app data.
 * All native exceptions are deliberately discarded and reduced to fixed status codes.
 */
export async function runGoogleNativeProbe(
  loadNitroModules: ModuleLoader = () => import('react-native-nitro-modules'),
): Promise<GoogleNativeProbeStatus> {
  let runtime: RecordValue;
  let createHybridObject: ((name: string) => unknown) | null = null;

  try {
    const loaded = await loadNitroModules();
    if (!isRecord(loaded) || !isRecord(loaded.NitroModules)) {
      return 'NITRO_RUNTIME_UNAVAILABLE';
    }

    runtime = loaded.NitroModules;
    const create = runtime.createHybridObject;
    if (typeof create !== 'function') return 'NITRO_RUNTIME_UNAVAILABLE';
    createHybridObject = create as (name: string) => unknown;
  } catch {
    return 'NITRO_RUNTIME_UNAVAILABLE';
  }

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
