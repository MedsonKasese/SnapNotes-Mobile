# SnapNotes Mobile

A private, standalone React Native app built with Expo SDK 58 and TypeScript. This project is independent of the SnapNotes web/PWA in [MedsonKasese/SnapNotes](https://github.com/MedsonKasese/SnapNotes); it does not change that app.

## Current scope

You can create and edit plain-text notes **for the current app session**. Notes live only in memory: **restarting, reloading, or closing the app can lose all notes and drafts**. The screen shows this warning. This is a development slice, not a safe place for important notes or a replacement for the PWA.

- Optional title and body; at least one must contain non-whitespace text. Body-only notes display as “Untitled note” without storing that fallback.
- The 1,500-character budget follows the PWA inline editor: normalized title + body, including `## ` and a line break when a title is present. The live counter and save validator use the same rule. Title/body are explicit native fields; Markdown heading parsing and rich text are not included.
- Saving creates a new note at the top of the session list. Editing updates that note without changing its ID, creation time, or default `general` category; update time changes on save.
- Draft changes do not touch a saved note until Save changes is tapped. Cancel, New note, and switching to another note ask before discarding a changed draft. There is no restart/exit recovery in this slice.

There is no disk storage, account/auth, cloud sync, migration, categories UI, deletion, or notifications. The PWA repository and its users/data are untouched.

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
- `npm test` — run deterministic in-memory note regression tests (Node type stripping)
- `npm run check` — run typecheck, lint, and regression tests

There is no supported web command in this slice. CI runs typechecking, linting, model regression tests, Expo dependency validation, and Android/iOS JavaScript export checks. Exports validate bundling; they are not signed native builds or device tests.

## PWA as our roadmap

The [existing SnapNotes PWA](https://github.com/MedsonKasese/SnapNotes) is our reference for what to build next and how features should behave. It remains a separate, working product throughout mobile development. Refer to its current code and documentation when choosing each slice; do not assume mobile has feature parity or copy browser-only code directly into React Native.

Build incrementally, one reviewed pull request at a time. This PR adds **session-only note creation and editing**; next is **local persistence**, and later **auth and sync**, checking each slice against the PWA. Search, folders/tags, reminders, private notes, attachments, and Ask My Notes remain future slices—not promises in this starter. Adapt interactions to native Android/iOS patterns while preserving the intended behavior and security boundaries. Do not connect production data or migrate users without a separately reviewed plan.

## Known dependency advisories

The SDK 58 dependency tree currently reports **22 npm audit findings (15 high, 7 moderate)**, including transitive `braces`, `node-forge`, and `uuid` advisories. A compatible `npm audit fix` did not clear them; npm's suggested forced fix would downgrade Expo to SDK 44, so it was not applied. These findings are not waived or proof of exploitability in this screen. Keep this starter for development/review only and reassess upstream fixes before any release. Do not expose the development server to untrusted networks. Run `npm audit` to see the current report.

## Review this slice on a phone or emulator

1. Start with an empty session list and confirm the session-only warning is visible.
2. Save a body-only note; it should appear as “Untitled note”. Save a title-only note too. A whitespace-only note must show an error and leave the list unchanged.
3. Enter 1,500 body characters with no title and save; 1,501 must be rejected without losing the draft. Add a title and verify the marker/newline budget shown by the counter.
4. Edit a saved note. Before saving, its list card must still show the original. Save changes: the count stays the same, the ID/creation time remain, and the updated content appears.
5. Change an edit, then Cancel or choose another note. Keep editing must preserve the draft; Discard changes must leave the saved original intact. New note while editing must start a blank composer after confirmation.
6. Save multiple notes and edit an older one; other notes must stay unchanged. Check typing focus, keyboard scrolling, large system text, and screen-reader labels on Android and iOS.
7. Reload/restart: the session list resets by design. Do not use important notes for this test.

The behavior reference is the PWA at [commit 74c3044](https://github.com/MedsonKasese/SnapNotes/tree/74c3044820b4cace801a4824e8c0a301e630917b): `js/app.js` (`saveEditorNote`) and `js/notes.js` (inline edit validation/update). Mobile uses separate plain-text fields rather than the PWA rich-text composer. Native interaction checks above require a device/emulator; model tests and JavaScript bundling alone do not verify them.
