# SnapNotes Mobile

A private, standalone React Native app built with Expo SDK 58 and TypeScript. This project is independent of the SnapNotes web/PWA in [MedsonKasese/SnapNotes](https://github.com/MedsonKasese/SnapNotes); it does not change that app.

## Current scope

The first slice is only a starter landing screen. It does not include notes, accounts, local storage, sync, migration, or notifications. **This starter is not a usable replacement for the existing app**, which remains unchanged.

No secrets or production-data connections are needed. Deployment and over-the-air update setup are out of scope.

## Requirements and setup

- Node.js **22.13+ (22.x), 24.3+ (24.x), or 26+** and npm
- For Android emulators: Android Studio and an Android Virtual Device
- For iOS simulators: macOS and Xcode

From this directory, install dependencies and start Expo:

```sh
npm ci
npm start
```

Use Expo Go with an Expo Go version compatible with SDK 58. Scan the QR code to open the app on a phone; LAN is the simplest connection, and the phone and computer should be on the same network. If the network blocks device discovery, check the Expo CLI connection options or use a USB-connected Android device with USB debugging and ADB configured. You can also launch an Android emulator or, on macOS with Xcode installed, an iOS simulator.

## Commands

Available npm scripts:

- `npm start` — start Expo
- `npm run android` — start and open Android
- `npm run ios` — start and open iOS
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `eslint .`
- `npm run check` — run typecheck and lint

There is no supported web command in this slice. CI runs typechecking, linting, Expo dependency validation, and Android/iOS JavaScript export checks. Exports validate bundling; they are not signed native builds or device tests.

## PWA as our roadmap

The [existing SnapNotes PWA](https://github.com/MedsonKasese/SnapNotes) is our reference for what to build next and how features should behave. It remains a separate, working product throughout mobile development. Refer to its current code and documentation when choosing each slice; do not assume mobile has feature parity or copy browser-only code directly into React Native.

Build incrementally, one reviewed pull request at a time. Start with **local note creation and editing**, then **local persistence**, and later **auth and sync**, checking each slice against the PWA. Search, folders/tags, reminders, private notes, attachments, and Ask My Notes remain future slices—not promises in this starter. Adapt interactions to native Android/iOS patterns while preserving the intended behavior and security boundaries. Do not connect production data or migrate users without a separately reviewed plan.

## Known dependency advisories

The SDK 58 dependency tree currently reports **22 npm audit findings (15 high, 7 moderate)**, including transitive `braces`, `node-forge`, and `uuid` advisories. A compatible `npm audit fix` did not clear them; npm's suggested forced fix would downgrade Expo to SDK 44, so it was not applied. These findings are not waived or proof of exploitability in this screen. Keep this starter for development/review only and reassess upstream fixes before any release. Do not expose the development server to untrusted networks. Run `npm audit` to see the current report.
