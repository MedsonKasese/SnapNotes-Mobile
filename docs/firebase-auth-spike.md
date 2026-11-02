# Firebase Auth persistence spike (Phase 0/1)

## What this spike includes

The mobile app now has a single Firebase app/Auth initializer and a typed `onAuthStateChanged` provider configured with React Native AsyncStorage persistence. Auth begins as `initializing`; a setup or observer failure is `unavailable`, not falsely `signed-out`. Neither state gates `NotesWorkspace`, so the local notes workspace remains available when Firebase is unavailable or the device is offline.

This is an account-free technical spike: it adds no login, registration, test-account UI, credentials, or account dependency. It observes Firebase identity only. It does not read, write, sync, upload, reassign, or clear notes, and it does not call Firestore. Private Notes' vault, encryption, biometric unlock, and local data model are untouched and remain separate from Firebase Auth.

## Reference and implementation decisions

The PWA uses Firebase JS SDK `12.14.0`, the same public Firebase client configuration copied into `src/firebase/firebaseConfig.ts`, `browserLocalPersistence`, and an auth-state observer. The mobile dependency is pinned to that SDK version to keep the PWA reference aligned. Expo's Firebase guide supports the Firebase JS SDK in Expo React Native; Firebase's Auth API documents `getReactNativePersistence` with AsyncStorage.

Firebase 12.14.0's shared `firebase/auth` type entry omits this React Native-only export while its React Native runtime entry includes it. `src/types/firebase-auth-rn.d.ts` provides one typed, local module augmentation for that missing declaration; it does not broadly suppress errors or cast the storage adapter. `npx expo export --platform android` confirms Android-targeted bundling; on-device runtime restoration still needs owner verification.

The Firebase metapackage installs Firestore as an unused transitive dependency even though this app imports only Auth. Its Firestore tree originally selected `@grpc/grpc-js` 1.9.x, which has published HIGH advisories. The root npm override raises it to a compatible patched 1.x release (resolved as 1.14.7); the mobile app does not import or call Firestore. The npm audit counts after the override match the latest-main baseline: 26 findings (25 moderate, one high), so this dependency addition introduces no new npm-audit finding. The remaining HIGH is Zod `<4.6.6`, already transitive through the existing `eslint-config-expo` dependency on `main`.

The PWA's signed-in observer also transitions its local/cloud note state and can start cloud loading. None of that behavior is copied. Sign-in does not move or upload existing local notes. Only the public Firebase client config is included. Firebase Admin/service-account credentials, Supabase keys, Gemini/AI credentials, Resend credentials, and all other Vercel/server secrets are excluded.

## Automated checks

Run `npm ci` and `npm run check` from the repository root. The mocked observer tests cover the initial unresolved state, a restored-user event, a signed-out event, an observer error, safe user-summary projection, and unsubscribe behavior. `npx expo export --platform android --output-dir /tmp/snapnotes-auth-spike-export` checks Android-targeted bundling. These checks do not prove a signed-in session can be restored on the owner's installed APK.

## Snyk Code scan and merge triage

A real `snyk code test --severity-threshold=high` scan ran against this branch and reported two HIGH `Hardcoded Non-Cryptographic Secret` findings:

- `20c12dee-384f-4919-b5be-2ffd3ab62539` points to the PWA's Firebase `apiKey` copied into the mobile client config. Firebase web API keys are public client identifiers, not service-account credentials; this is a scanner false positive in context. The key must still be restricted to the intended Firebase APIs/project before release.
- `6d255675-736d-4442-b825-c1426547330e` points to the pre-existing `PRIVATE_VAULT_INDEX_KEY` storage namespace in `src/privateVaultStorage.ts`. It is a local AsyncStorage key name, not a password, encryption key, token, or cloud credential; it is unchanged from `main`.

The scan is not green: both findings remain open in the reported result. Before merging, the owner/reviewer should inspect and explicitly triage these two findings (record the contextual false-positive rationale in Snyk if appropriate), verify Firebase API-key restrictions, and complete the Android check below. Do not treat this report as a clean security scan.

## Termux setup and Android launch

On Android in Termux, install the command-line packages once:

```sh
pkg update -y
pkg install -y git nodejs-lts termux-tools
node --version
npm --version
```

Use a Node.js version supported by the project README (22.13+ in 22.x, 24.3+ in 24.x, or 26+). Keep the clone under Termux's home directory, not shared `/sdcard` storage. From the existing clone, fetch and switch to this PR branch (if it is new locally):

```sh
cd ~/SnapNotes-Mobile
git status --short
git fetch origin
git switch --track origin/feat/firebase-auth-persistence-spike
npm ci
npm run check
```

Start Metro for the already-installed Expo development APK:

```sh
npx expo start --dev-client --localhost
```

Open the development-client URL printed by Expo. For a same-phone local server on the default port, Termux can hand the link to Android with:

```sh
termux-open-url 'exp+snapnotes-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

If Expo selects another port, replace `8081` with the actual printed port. If the development APK does not recognize that link, open the project from the development client's launcher using the printed local development URL; no Android Studio or ADB is required.

Confirm the notes workspace opens without an account and stays usable with network access disabled. The bundle and mocked tests do not perform an authenticated restore. A real signed-in Android persistence test remains an owner validation step for a later approved sign-in route/test setup: after that route is available, sign in through the owner-controlled flow, fully close and reopen the app, confirm Firebase restores the same account, then sign out and confirm local notes are unchanged. This PR does not request credentials or include a test account/sign-in route. Keep the PR open and unmerged until review and the owner's Android validation are complete.

## References

- [PWA Firebase client configuration](https://github.com/MedsonKasese/SnapNotes/blob/main/js/firebaseConfig.js)
- [PWA auth observer](https://github.com/MedsonKasese/SnapNotes/blob/main/js/auth.js)
- [Expo: Using Firebase](https://docs.expo.dev/guides/using-firebase/)
- [Firebase Auth JavaScript API: `getReactNativePersistence`](https://firebase.google.com/docs/reference/js/auth#getreactnativepersistence)
- [Firebase JS SDK React Native export/type issue](https://github.com/firebase/firebase-js-sdk/issues/9316)
