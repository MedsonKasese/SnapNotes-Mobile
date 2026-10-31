export type PrivateScreenCaptureApi = {
  preventScreenCaptureAsync: (key?: string) => Promise<void>;
  allowScreenCaptureAsync: (key?: string) => Promise<void>;
  enableAppSwitcherProtectionAsync?: (blurIntensity?: number) => Promise<void>;
  disableAppSwitcherProtectionAsync?: () => Promise<void>;
};

const PRIVATE_NOTES_CAPTURE_KEY_PREFIX = 'snapnotes-private-notes';
let nextCaptureProtectionId = 0;

/**
 * Owns one screen-capture protection lease for the private-notes screen.
 * A unique key prevents overlapping mounts and React Strict Mode effect replays
 * from releasing another screen's protection.
 */
export function createPrivateScreenCaptureProtection(
  api: PrivateScreenCaptureApi,
  protectAppSwitcher = false,
) {
  const key = `${PRIVATE_NOTES_CAPTURE_KEY_PREFIX}-${++nextCaptureProtectionId}`;
  let activation: Promise<void> | null = null;
  let releasePromise: Promise<void> | null = null;
  let activationStarted = false;
  let appSwitcherProtected = false;
  let released = false;

  function releaseNativeProtection(): Promise<void> {
    if (releasePromise) return releasePromise;
    if (!activationStarted) return Promise.resolve();
    releasePromise = (async () => {
      let firstError: unknown;
      if (appSwitcherProtected && api.disableAppSwitcherProtectionAsync) {
        try {
          await api.disableAppSwitcherProtectionAsync();
        } catch (error) {
          firstError = error;
        } finally {
          appSwitcherProtected = false;
        }
      }
      // Try to re-enable capture even if the iOS app-switcher overlay failed
      // to disable. This keeps normal screens from inheriting private mode.
      try {
        await api.allowScreenCaptureAsync(key);
      } catch (error) {
        firstError ??= error;
      }
      if (firstError) throw firstError;
    })();
    void releasePromise.catch(() => { releasePromise = null; });
    return releasePromise;
  }

  async function activate(): Promise<void> {
    if (released) throw new Error('Private screen capture protection was already released.');
    if (!activation) {
      activationStarted = true;
      activation = (async () => {
        await api.preventScreenCaptureAsync(key);
        if (protectAppSwitcher) {
          if (!api.enableAppSwitcherProtectionAsync) {
            throw new Error('Private app-switcher protection is unavailable.');
          }
          await api.enableAppSwitcherProtectionAsync();
          appSwitcherProtected = true;
        }
      })();
    }
    await activation;
    if (released) await releaseNativeProtection();
  }

  async function release(): Promise<void> {
    released = true;
    if (activation) {
      try {
        await activation;
      } catch {
        // Still call allowScreenCaptureAsync to clean up a possibly partial
        // native activation; the SDK treats allowing an inactive key as safe.
      }
    }
    await releaseNativeProtection();
  }

  return { activate, release };
}
