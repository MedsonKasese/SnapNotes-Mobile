# SnapNotes Mobile

A private, standalone React Native app built with Expo SDK 58 and TypeScript. This project is independent of the SnapNotes web/PWA in [MedsonKasese/SnapNotes](https://github.com/MedsonKasese/SnapNotes); it does not change that app.

## Current scope

You can create and edit plain-text notes saved **on this device**. After Save succeeds, notes survive app reloads and restarts. The editor also autosaves one recovery draft on this device and restores it into the editor after a successful notes load. Recovery drafts are not saved notes, do not appear in the library, and are cleared after a successful save or an explicit discard. There is no cloud backup or PWA sync; storage is unencrypted, and clearing app data or uninstalling can remove notes. This remains a development slice, not a replacement for the PWA or a secure store for sensitive notes.

- Optional title and body; at least one must contain non-whitespace text. Body-only notes display as “Untitled note” without storing that fallback.
- The 1,500-character budget follows the PWA inline editor: normalized title + body, including `## ` and a line break when a title is present. The live counter and save validator use the same rule. Title/body are explicit native fields; Markdown heading parsing and rich text are not included.
- Saving creates a new note at the top of the device list. Editing updates that note without changing its ID, creation time, or default `general` category; update time changes on save.
- Draft changes do not touch a saved note until Save changes is tapped. The latest changed editor draft is autosaved to a separate device-only recovery key after a short debounce and restored after restart; changing views still asks before discarding it. Recovery is a single editor draft, not the PWA's full multi-draft library.

There is no account/auth, cloud sync, migration/import from the PWA, categories UI, deletion, or notifications. The PWA repository and its users/data are untouched.

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

### PR #10 checkout and testing in Termux (Android)

Keep the repository in Termux's home directory, not shared `/sdcard` storage. Use a supported Node version listed above (`node --version`). If you have not cloned this private repository, first run `gh repo clone MedsonKasese/SnapNotes-Mobile` from your home directory using your authenticated GitHub CLI.

For an existing clone, check `git status --short` first. If it lists local changes, commit or stash them before switching; do not reset or delete them. Then run:

```sh
cd ~/SnapNotes-Mobile
git fetch origin
git switch feat/pr10-editor-draft-recovery
git pull --ff-only
npm ci
npm run check
npx expo start --go --localhost
```

On the same Android phone, open the printed `exp://127.0.0.1:8081` URL in an SDK-58-compatible Expo Go (use the actual port printed by Expo). If needed, open it from another Termux session with `termux-open-url exp://127.0.0.1:8081`. Localhost avoids scanning a QR code on the same phone and keeps the development server off public networks; see [Expo CLI connection options](https://docs.expo.dev/more/expo-cli/#server-url). Keep Termux running while testing. These commands have not been verified on the owner's phone.

Before approving PR #10: type a new draft, wait at least one second, close/reopen Expo Go, and confirm recovery. Repeat for an existing-note edit; its saved original must stay unchanged until Save. Save or explicitly Discard, wait at least one second, and restart again: the draft must not return or duplicate notes. Android restart and storage-error checks remain pending in `MIGRATION_CHECKLIST.md`; passing `npm run check` is not device verification.

## Commands

Available npm scripts:

- `npm start` — start Expo
- `npm run android` — start and open Android
- `npm run ios` — start and open iOS
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `eslint .`
- `npm test` — run note model, storage contract, and persistence lifecycle regression tests (Node type stripping)
- `npm run check` — run typecheck, lint, and regression tests

There is no supported web command in this slice. CI runs typechecking, linting, note and persistence regression tests, Expo dependency validation, and Android/iOS JavaScript export checks. Exports validate bundling; they are not signed native builds or device tests.

## How local persistence works

The SDK-compatible `@react-native-async-storage/async-storage` backend stores each note in a bounded record under `@snapnotes-mobile/note/<generation>/<position>`, with an ordered version-2 index at `@snapnotes-mobile/notes-index`. A save writes a complete new generation before atomically switching the index pointer; incomplete writes leave the last committed generation readable. The version-1 `@snapnotes-mobile/notes` snapshot from PR #3 remains readable when no version-2 index exists and is preserved after migration. The storage boundary validates the complete collection, unique IDs, supported category, timestamps and existing note limits. An absent key is an empty first launch; malformed or unsupported data is an error, not an empty list.

The editor loads before accepting changes. Save writes the full validated collection and only then updates the saved list, clears the draft and announces success. A failed write retains the draft for retry and does not claim that it was saved. Writes are serialized by disabling/rejecting actions while a save is pending. Note IDs are checked against the loaded collection, so restarting cannot reset a session counter into an existing note. There are no background, unmount or startup writes, and no network operations.

Storage and controller tests use an injected asynchronous backend, including fresh controller instances over the same stored bytes to model restarts, delayed hydration/writes, failures, invalid data and duplicate-save protection. These are not physical-device durability tests; abrupt termination before Save succeeds may lose the pending operation. AsyncStorage is not encryption or a backup service. See the [Expo SDK 58 AsyncStorage reference](https://docs.expo.dev/versions/v58.0.0/sdk/async-storage/).

## PWA as our roadmap

The [existing SnapNotes PWA](https://github.com/MedsonKasese/SnapNotes) is our reference for what to build next and how features should behave. It remains a separate, working product throughout mobile development. Refer to its current code and documentation when choosing each slice; do not assume mobile has feature parity or copy browser-only code directly into React Native.

Build incrementally, one reviewed pull request at a time. This slice adds **on-device persistence** to the existing create/edit flow; **auth and sync** remain separate future reviews, checking each slice against the PWA. Search, folders/tags, reminders, private notes, attachments, and Ask My Notes remain future slices—not promises in this starter. Adapt interactions to native Android/iOS patterns while preserving the intended behavior and security boundaries. Do not connect production data or migrate users without a separately reviewed plan.

### Borrowed from the PWA, adapted to native

The reference is PWA main at [74c3044](https://github.com/MedsonKasese/SnapNotes/tree/74c3044820b4cace801a4824e8c0a301e630917b), read without changing that repository:

- [`js/storage.js`](https://github.com/MedsonKasese/SnapNotes/blob/74c3044820b4cace801a4824e8c0a301e630917b/js/storage.js): save a complete local library snapshot before any optional cloud work; restore saved notes on startup and prevent late restoration from replacing new edits. Mobile gates the editor until restoration finishes, so it needs no browser load-generation/revision guards.
- [`js/local-library.js`](https://github.com/MedsonKasese/SnapNotes/blob/74c3044820b4cace801a4824e8c0a301e630917b/js/local-library.js): an injected storage boundary with asynchronous read/write completion. Mobile substitutes Expo-compatible AsyncStorage for browser IndexedDB/localStorage, with one versioned notes document; there is no browser fallback copy or account namespace yet.
- [`js/app.js`](https://github.com/MedsonKasese/SnapNotes/blob/74c3044820b4cace801a4824e8c0a301e630917b/js/app.js) (`saveEditorNote`): validate the shared character budget, prepend new notes, retain creation/update metadata, and block repeat Save taps until the save finishes. Mobile deliberately keeps the draft when local storage fails rather than reporting success.

This is behavior reuse, not browser-code copying or format compatibility. Existing mobile title/body fields and metadata remain unchanged. PWA draft recovery, rich text, folders, accounts and sync are not included in this saved-note persistence PR. Mobile IDs remain device-local and collision-checked; cross-device ID strategy belongs with a separately reviewed sync design.

## Known dependency advisories

The SDK 58 dependency tree currently reports **22 npm audit findings (15 high, 7 moderate)**, including transitive `braces`, `node-forge`, and `uuid` advisories. A compatible `npm audit fix` did not clear them; npm's suggested forced fix would downgrade Expo to SDK 44, so it was not applied. These findings are not waived or proof of exploitability in this screen. Keep this starter for development/review only and reassess upstream fixes before any release. Do not expose the development server to untrusted networks. Run `npm audit` to see the current report.

## Review this slice on a phone or emulator

1. On a fresh install, wait for loading to finish. Confirm the empty device list and the local-only, unencrypted-storage warning.
2. Save a body-only note; it should appear as “Untitled note”. Save a title-only note too. A whitespace-only note must show an error and leave the list unchanged.
3. Enter 1,500 body characters with no title and save; 1,501 must be rejected without losing the draft. Add a title and verify the marker/newline budget shown by the counter.
4. Edit a saved note. Before saving, its list card must still show the original. Save changes: the count stays the same, the ID/creation time remain, and the updated content appears.
5. Change an edit, then Cancel or choose another note. Keep editing must preserve the draft; Discard changes must leave the saved original intact. New note while editing must start a blank composer after confirmation.
6. Save multiple notes and edit an older one; other notes must stay unchanged. Check typing focus, keyboard scrolling, large system text, and screen-reader labels on Android and iOS.
7. After a successful Save, reload the app, then fully close and reopen it. Saved notes, their order, IDs, content and timestamps must remain. Edit a restored note, save, and restart again; the edit must remain without duplication. Create a new note after restart and verify existing notes are not replaced.
8. Type a new draft or change an existing note without saving. Wait briefly for recovery autosave, then fully close and reopen the app. The editor should reopen with the unsaved text; the saved library collection must remain unchanged. Explicitly discard the recovered draft and restart again to confirm it does not return.
9. With a delayed/rejecting storage backend in a development harness, verify that startup hides the editor until loading succeeds. Read errors must show Retry and never write an empty collection. A failed Save must keep the draft and original saved list, show an error, and allow retry. While saving, fields/actions are disabled and rapid Save taps cannot overlap. These paths are covered deterministically by the controller tests; native presentation still needs device review.
10. With malformed or newer-version data in the development storage key, restart: show a load error, retain the original bytes, and block editing/saving rather than silently resetting. There is intentionally no destructive reset/recovery button in this slice.

The behavior reference is the PWA at [commit 74c3044](https://github.com/MedsonKasese/SnapNotes/tree/74c3044820b4cace801a4824e8c0a301e630917b): `js/app.js` (`saveEditorNote`) and `js/notes.js` (inline edit validation/update). Mobile uses separate plain-text fields rather than the PWA rich-text composer. Native interaction checks above require a device/emulator; model tests and JavaScript bundling alone do not verify them.

## PR #4: scalable on-device note storage (merged)

This extends [PR #3](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/3) and follows the PWA's local-first, complete-snapshot-before-acknowledgement behavior in `js/storage.js` and the failure-aware read/write boundary in `js/local-library.js`. It does **not** change the PWA.

New saves store notes in separate bounded AsyncStorage entries and commit a small ordered index only after all note writes succeed. A partial write never replaces the last committed index. The old PR #3 `@snapnotes-mobile/notes` snapshot remains readable until the next successful save and is not deleted. On index corruption, the app shows a load error rather than silently replacing saved notes. No cloud sync or encryption is added.

**Follow-up in PR #5:** after the version-2 index commits, obsolete note generations are removed on a best-effort basis. Startup also removes orphan generations only after successfully validating the active generation. Cleanup errors do not turn an already committed save into a reported failure, and the legacy version-1 snapshot is retained. Physical Android restart, low-storage, and migration testing remain necessary. This is not an import from the PWA.

## PR #5: storage reliability (under review)

This follow-up serializes loads, save commits, and cleanup through a queue shared by storage instances using the same backend object. A load cannot delete an in-progress save, and a save waits for earlier cleanup to finish. Validation snapshots the input at save invocation and returns invalid-input failures as rejected promises. Failed reads or writes do not block later retries. This is in-runtime coordination, not a cross-process lock: separate backend wrappers or runtimes must not write the same storage concurrently.

Obsolete generations are removed only after the new index is committed or a load has fully validated the active collection. When no index exists, an empty or validated legacy collection also permits removal of abandoned first-save records. Corrupt data never triggers cleanup; unrelated keys and the legacy snapshot remain untouched. UTF-8 entry-size checks no longer depend on the global `TextEncoder` API. Cleanup failures are deliberately non-fatal because the active index may already have committed successfully, and later loads/saves retry cleanup.

The regression suite covers overlapping loads/saves, cross-instance commit ordering, input snapshots, repeated-save storage growth, first-save orphan cleanup, corruption preservation, legacy snapshot preservation, enumeration/removal failures, retry after failed operations, and UTF-8 entry bounds. Run `npm run check` and test save/edit/restart behavior on a physical Android device before merging. CI and model tests are not a substitute for device durability checks.

## PR #6: native note search (review pending)

Search saved device notes by title or body using the native search field above the list. Matching is case-insensitive, whitespace-separated terms can match across title and body, and all terms must be present. The original saved order is retained. Clear restores the complete list; a no-results message distinguishes an empty search result from an empty library. Search only filters the display: it never changes persisted notes, saved drafts, or the current editing target. Search query is intentionally session-only.

Review on Android: search by title, body, and multiple terms; clear; check no matches; edit a result while filtering and verify it is saved correctly; restart and verify all notes remain. Run `npm run check` and Expo bundling checks. No cloud sync, search indexing service, or extra dependencies are added.
