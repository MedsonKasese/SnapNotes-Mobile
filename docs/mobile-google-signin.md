# Native Google Sign-In

## What this adds

SnapNotes Mobile can exchange a Google ID token for a Firebase Auth session using the native Android Credential Manager flow. The app does not request Google API scopes or offline access. Signing in only changes Firebase Auth state; it does not upload, merge, overwrite, delete, migrate, or reassign local notes. Private Notes and its encrypted vault are not connected to Google or Firebase Auth.

The native sign-in module requires a rebuilt development client; Expo Go and a Metro-only update do not include its native code. Email/password sign-in and the device-local workspace remain available when Google OAuth is not configured.

## Android OAuth setup required before phone testing

The app's Android package name is `com.medsonkasese.snapnotes`. In the existing Firebase/Google Cloud project:

1. Enable Google as a sign-in provider in Firebase Authentication.
2. Create or confirm a **Web application OAuth client** in the same Google Cloud project. Set its public client ID as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the EAS environment used for the development build and in the cloud Metro process. This must be the Web client ID, not the Android client ID; it is a public identifier, not a password or API secret.
3. Create/confirm an **Android OAuth client** for `com.medsonkasese.snapnotes` and add the SHA-1 fingerprint for the EAS `development` Android keystore. In the owner's authenticated EAS environment, inspect the Android credentials for the development profile with `eas credentials --platform android` and register the SHA-1 shown there in Firebase/Google Cloud. Keep the keystore private; do not download it into the repository or send it in chat. Add release and Google Play App Signing fingerprints separately before production release.
4. Rebuild the existing APK profile after OAuth configuration: `eas build --profile development --platform android`. Install that new APK on the Android phone; changing Metro JavaScript alone cannot add the native module.

Android uses the explicit Web client ID, so this implementation does not require committing `google-services.json` or another client configuration file. Keep OAuth client IDs in the build/runtime environment instead of adding generated credentials to Git.

## Cloud Metro test

Use the owner's cloud Metro session, not Termux local Metro, because Termux can hit file-watcher limits. Start Metro with the public client ID present in its environment, for example:

```sh
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID='your-web-client-id.apps.googleusercontent.com' npx expo start --tunnel --dev-client
```

The owner previously confirmed Google Sign-In succeeded in an EAS development APK and ordinary local notes were unchanged. For later phone checks, also try cancelling the picker, unavailable/misconfigured provider errors, sign-out, and offline use; verify Private Notes and its vault remain unchanged.

## iOS configuration

The native module can also sign in on iOS when a separate iOS OAuth client is configured. Supply `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and its reversed client ID as `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`; the dynamic Expo config registers that URL scheme only when provided. The iOS path is optional in this Android-focused setup and still needs an iOS development build and device validation.

## Validation boundary

Automated tests cover token exchange, cancellation, missing OAuth configuration, and safe error handling. Typecheck, lint, regression tests, Expo dependency validation, and Android JavaScript bundling are code checks—not proof of native OAuth on every build. The owner reports that Google Sign-In succeeded in an EAS development APK and ordinary local notes were unchanged. Remaining useful phone checks include cancellation, provider/configuration errors, sign-out, offline use, and Private Notes invariants on the branch synced with current main. Keep PR #46 open and unmerged until the updated-branch checks and any remaining device tests are reviewed.

The native package's peer range accepts React Native `>=0.76`, while its published compatibility notes do not list this app's React Native `0.88.1` (the listed 2.0.x row ends at `0.87`, and its development dependency is `0.87.0`). Despite that documentation gap, the owner reports a successful EAS development APK build and Google sign-in on the tested Android device. This validates that tested Android build only; it does not guarantee other React Native versions or iOS. The optional iOS path remains untested.

## Official setup references

- [Expo Google authentication guide](https://docs.expo.dev/guides/google-authentication/) — native sign-in and development-build requirements.
- [Nitro Google Sign-In Expo setup](https://react-native-nitro-google-sign-in.github.io/docs/setup/expo/) — package configuration and URL-scheme plugin.
- [Nitro Google Sign-In Google Cloud setup](https://react-native-nitro-google-sign-in.github.io/docs/setup/google-cloud) — Android package name, OAuth client types, and signing fingerprints.
- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin) — exchanging a Google ID token for a Firebase Auth credential.
- [EAS Android app credentials](https://docs.expo.dev/app-signing/app-credentials/) — inspecting the development signing credentials and fingerprints.
