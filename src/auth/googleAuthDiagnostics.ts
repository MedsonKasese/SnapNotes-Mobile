export const GOOGLE_AUTH_DIAGNOSTIC_STAGES = [
  'native-module-load',
  'native-module-configure',
  'play-services',
  'account-picker',
  'firebase-auth',
] as const;

export type GoogleAuthDiagnosticStage = (typeof GOOGLE_AUTH_DIAGNOSTIC_STAGES)[number];

const GOOGLE_AUTH_DIAGNOSTIC_CODES = [
  'DEVELOPER_ERROR',
  'PLAY_SERVICES_NOT_AVAILABLE',
  'IN_PROGRESS',
  'ONE_TAP_START_FAILED',
  'SIGN_IN_REQUIRED',
  'SIGN_IN_CANCELLED',
  'NO_ID_TOKEN',
  'MISSING_WEB_CLIENT_ID',
  'NATIVE_MODULE_LOAD_FAILED',
  'auth/network-request-failed',
  'auth/operation-not-allowed',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/user-disabled',
  'auth/too-many-requests',
  'auth/internal-error',
  'UNCLASSIFIED',
] as const;

export type GoogleAuthDiagnosticCode = (typeof GOOGLE_AUTH_DIAGNOSTIC_CODES)[number];

export type GoogleAuthDiagnostic = {
  stage: GoogleAuthDiagnosticStage;
  code: GoogleAuthDiagnosticCode;
};

const safeStages = new Set<string>(GOOGLE_AUTH_DIAGNOSTIC_STAGES);
const safeCodes = new Set<string>(GOOGLE_AUTH_DIAGNOSTIC_CODES);

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  try {
    if (!('code' in error)) return null;
    const code = error.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

export function createGoogleAuthDiagnostic(
  stage: GoogleAuthDiagnosticStage,
  error: unknown,
  fallbackCode?: GoogleAuthDiagnosticCode,
): GoogleAuthDiagnostic {
  const code = readErrorCode(error);
  return {
    stage,
    code: code && safeCodes.has(code)
      ? code as GoogleAuthDiagnosticCode
      : fallbackCode ?? 'UNCLASSIFIED',
  };
}

export function getGoogleAuthDiagnosticLabel(
  error: unknown,
  isDevelopment: boolean,
): string | null {
  if (!isDevelopment || typeof error !== 'object' || error === null) return null;

  try {
    if (!('diagnostic' in error)) return null;
    const diagnostic = error.diagnostic;
    if (typeof diagnostic !== 'object' || diagnostic === null) return null;
    if (!('stage' in diagnostic) || !('code' in diagnostic)) return null;

    const stage = diagnostic.stage;
    const code = diagnostic.code;
    if (typeof stage !== 'string' || !safeStages.has(stage)) return null;
    if (typeof code !== 'string' || !safeCodes.has(code)) return null;

    return `Google sign-in diagnostic (development only): ${stage} / ${code}`;
  } catch {
    return null;
  }
}
