# SnapNotes Mobile — PWA Migration Checklist

> **Purpose:** A shared, checkbox-based roadmap for migrating SnapNotes from the web/PWA to the native Android app without losing important features or product quality.
>
> **Source of truth:** The existing [SnapNotes PWA](https://snapnotesmw.vercel.app) and its repository, [MedsonKasese/SnapNotes](https://github.com/MedsonKasese/SnapNotes), define expected behaviour and product intent. The mobile app should adapt those experiences to Android rather than becoming a reduced, unrelated version.
>
> **How to use this document:** Update the boxes as implementation and testing progress. Keep this checklist current in future feature PRs. A feature is not complete just because a screen or button exists.

## Status key

- [ ] **Not started**
- [x] **Implemented and verified** — use only after the relevant tests and device checks pass
- [ ] **In progress** — add `(In progress)` next to the item
- [ ] **Implemented; testing required** — add `(Testing required)` next to the item
- [ ] **Blocked / bug found** — add `(Blocked: reason)` or link an issue/PR
- [ ] **Not applicable** — explain why before excluding an item

For detailed work, add sub-checkboxes. Do not check a parent section until its applicable items have been verified.

---

## 1. Migration rules and working agreement

- [x] Treat the PWA as the product and behaviour reference.
- [x] Keep this checklist in the mobile repository as the shared migration roadmap.
- [x] Before each feature, inspect the corresponding PWA implementation, including relevant HTML, JavaScript, CSS, storage, and edge cases. (Followed for PR #9 and PR #10; continue for each new feature.)
- [x] Audit the existing mobile implementation before changing it; reuse working code and avoid duplicating features. (Followed for PR #9 and PR #10; continue for each new feature.)
- [x] Document any intentional native-Android difference and why it is needed. (PR #10 uses one local recovery draft; the PWA supports a fuller Drafts library, which remains future work.)
- [ ] Preserve existing user data and backward compatibility when changing storage models.
- [ ] Make controls functional; do not add decorative buttons that have no working destination or action.
- [ ] Include loading, empty, error, offline, and permission-denied states where relevant.
- [ ] Add or update automated tests for behaviour and regression risks.
- [ ] Test on Android / Expo Go where applicable; do not treat successful compilation as proof of a working feature.
- [ ] Review each PR before merging; use a fresh branch from the latest `main` and keep commits focused.
- [ ] Update this checklist and the progress log in relevant feature PRs.

## 2. Foundation, persistence, and reliability

- [x] Expo / React Native project boots in the current development setup.
- [x] Local note persistence foundation is implemented.
- [x] Versioned per-note storage and storage cleanup/serialization/recovery work has been added.
- [ ] Verify persistence across force-close, app restart, and device reboot.
- [ ] Verify edits, creates, and deletes survive app restart without data loss.
- [ ] Handle malformed, partial, or outdated stored data safely.
- [ ] Prevent rapid repeated actions from causing duplicate writes or lost updates.
- [ ] Provide clear storage errors and recovery guidance without silently discarding notes.
- [ ] Review package compatibility and dependency audit findings safely; do not use force-fixes that downgrade Expo or break the SDK.

## 3. Main interface and visual design

- [ ] Audit the PWA's real header, branding, navigation, editor, list, spacing, typography, and colour tokens before implementation.
- [x] Recreate the SnapNotes visual identity and green primary accent in native-friendly layouts. (PR #9; user verified the app on Android.)
- [x] Build a clear app header with menu/navigation, product identity, and note count. (PR #9 verified; account action remains out of scope until auth is migrated.)
- [x] Keep essential navigation/header elements fixed where appropriate instead of scrolling away with the note list. (PR #9 verified on Android.)
- [x] Establish distinct, understandable Library and Editor experiences. (PR #9 verified on Android.)
- [x] Implement and verify initial native empty states, loading/error states, and unsaved-change confirmation patterns. (Full PWA parity remains.)
- [ ] Ensure layouts work on small Android screens and with the on-screen keyboard open.
- [ ] Respect Android safe areas, status/navigation bars, and system back behaviour.
- [ ] Avoid clutter, unnecessary animation, and oversized cards; keep the interface focused.
- [ ] Verify light/dark appearance only when the corresponding setting and styling are implemented.

## 4. Note creation, editing, and formatting

- [ ] Compare the native editor with the PWA editor and document supported formatting.
- [ ] Create, edit, and save notes reliably.
- [ ] Support the PWA's title convention and avoid duplicate title markers.
- [ ] Preserve note content when switching views, opening navigation, or temporarily leaving the editor.
- [ ] Handle empty titles/bodies and whitespace consistently with the PWA.
- [ ] Add supported formatting (headings, emphasis, lists, links, and other PWA-supported formatting) with native-friendly editing.
- [ ] Support checklists/task items if present in the PWA; verify checkbox alignment and interaction.
- [ ] Handle keyboard focus, multiline text, selection, paste, and scrolling while editing.
- [ ] Warn about unsaved changes only when necessary and never discard content unexpectedly.

## 5. Search and filtering

- [x] Add case-insensitive note search across title and body.
- [x] Support multiple whitespace-separated search terms.
- [x] Preserve the original notes collection/order and do not mutate stored notes while filtering.
- [x] Add a clear-search action, match count, and no-results state.
- [x] User verified the merged search feature on Android and reported that it works correctly.
- [ ] Re-test search after navigation, editing a filtered note, and restarting the app.
- [ ] Integrate search with categories, folders, archives, and other library views as those features are implemented.
- [ ] Match PWA search/filter semantics after auditing the web implementation.

## 6. Categories and organisation

- [ ] Audit the PWA's category names, defaults, assignment rules, and filtering behaviour.
- [ ] Support the existing categories: General, Work, Personal, Ideas, and Important.
- [ ] Assign, change, and remove a category according to PWA behaviour.
- [ ] Filter and count notes by category accurately.
- [ ] Preserve category assignment through edits, restarts, and future cloud sync.
- [ ] Provide sensible category empty states and accessible category controls.

## 7. Navigation drawer and library

- [ ] Audit the PWA navigation drawer and its grouping/order before designing the native equivalent.
- [ ] Implement an accessible, working navigation drawer or suitable Android-native navigation pattern.
- [ ] Provide a working All Notes destination.
- [ ] Connect category destinations.
- [ ] Connect folder destinations.
- [ ] Connect Drafts, Private Notes, Archive, and Trash when those features are implemented.
- [ ] Connect Settings and account actions when available.
- [ ] Show accurate counts where the PWA does.
- [ ] Highlight the current destination and preserve expected back navigation.
- [ ] Never show a destination as available if it is not implemented; use a clear disabled/coming-soon state only if justified.

## 8. Note management

- [ ] Pin and unpin notes, matching PWA behaviour.
- [ ] Duplicate notes if supported by the PWA.
- [ ] Archive and restore notes.
- [ ] Move notes to Trash and restore them.
- [ ] Permanently delete notes with clear confirmation.
- [ ] Select and manage multiple notes if the PWA supports bulk actions.
- [ ] Preserve note order and timestamps according to PWA rules.
- [ ] Verify actions work correctly from search results, category views, and folder views.

## 9. Folders

- [ ] Audit PWA folder creation, naming, nesting (if any), and note-movement rules.
- [ ] Create, rename, and delete folders safely.
- [ ] Move notes into and out of folders.
- [ ] Define and test what happens to notes when a folder is renamed or deleted.
- [ ] Display folder contents and counts accurately.
- [ ] Preserve folder membership through restart and future sync.
- [ ] Prevent accidental data loss when moving or deleting folders.

## 10. Private Notes and security

- [ ] Audit PWA Private Notes entry, unlock, move, and lock behaviour.
- [ ] Implement Private Notes as a distinct, reliable experience.
- [ ] Use a suitable native security mechanism and clearly document its limits.
- [ ] Do not claim local data is encrypted unless encryption is actually implemented and verified.
- [ ] Exclude private notes from search, AI, sharing, exports, and previews wherever the PWA's privacy rules require it.
- [ ] Prevent private content from leaking into notifications, recent-app previews, logs, or error messages.
- [ ] Verify lock/unlock, app backgrounding, restart, and failed authentication cases.
- [ ] Explain any security difference between the native app and PWA honestly.

## 11. Attachments and document viewing

- [ ] Audit PWA attachment types, size limits, upload flow, access rules, and viewer behaviour.
- [ ] Support selecting and attaching permitted files on Android.
- [ ] Show upload/download progress and actionable failure states.
- [ ] Preview supported images, PDFs, and text files in-app where feasible.
- [ ] Provide a safe fallback for unsupported formats.
- [ ] Handle large files without excessive memory use or app crashes.
- [ ] Respect private-note access and signed-in-only restrictions where applicable.
- [ ] Verify filenames, file type, size, missing files, offline behaviour, and permission denial.
- [ ] Test attachment persistence and access after app restart.

## 12. Reminders and notifications

- [ ] Audit reminder scheduling and notification behaviour in the PWA.
- [ ] Define the native Android notification and permission experience.
- [ ] Create, edit, reschedule, and cancel reminders.
- [ ] Handle denied notification permission gracefully.
- [ ] Verify notification content does not expose private note details.
- [ ] Test delivery, tapping/opening the related note, time-zone changes, and device restart as applicable.

## 13. Drafts and edit history

- [ ] Audit PWA draft/autosave behaviour and decide when a note becomes a draft.
- [ ] Preserve unfinished work after navigation or unexpected app closure. (PR #10 adds debounced device-only editor-draft recovery; Android restart/error-path verification required.)
- [ ] Provide a Drafts view if supported by the PWA.
- [ ] Audit the PWA's edit-history behaviour before implementation.
- [ ] Restore prior content safely if edit history is supported.
- [ ] Distinguish edit history from full version history; do not imply capabilities the app does not provide.

## 14. Authentication and account management

- [ ] Audit the PWA's sign-in providers, signup flow, verification, and account states.
- [ ] Implement the agreed authentication experience for the native app.
- [ ] Show profile name/photo and account details accurately when available.
- [ ] Handle sign-in cancellation, expired sessions, network errors, and sign-out.
- [ ] Implement email verification/password recovery only where supported by the chosen auth setup.
- [ ] Handle account deletion carefully and explain its data consequences.
- [ ] Never expose secrets or privileged service keys in the client app.

## 15. Cloud sync and offline support

- [ ] Audit the PWA's actual data model, sync rules, conflict handling, and offline behaviour before selecting the mobile sync design.
- [ ] Define the authoritative data model and migration path from local-only mobile notes.
- [ ] Sync signed-in users' permitted notes across supported clients.
- [ ] Preserve user ownership and access controls.
- [ ] Queue safe offline changes and retry when connectivity returns.
- [ ] Show sync status and actionable errors.
- [ ] Handle concurrent edits and conflict resolution without silent data loss.
- [ ] Verify that signing out does not expose the previous user's private data.
- [ ] Test across the native app, PWA, multiple browsers/devices, and unreliable connections.
- [ ] Never describe device-only storage as cloud-synced or backed up.

## 16. Settings and appearance

- [ ] Audit PWA settings and defaults before implementing native settings.
- [ ] Implement the applicable theme/appearance options.
- [ ] Persist preferences across app restarts.
- [ ] Add account and privacy settings that apply to the native app.
- [ ] Add support/feedback links where appropriate.
- [ ] Make destructive actions explicit and safely confirmed.
- [ ] Ensure settings actually change app behaviour; avoid decorative toggles.

## 17. Import, export, and sharing

- [ ] Audit PWA import/export formats and compatibility requirements.
- [ ] Export notes in a documented, user-accessible format.
- [ ] Import supported formats with validation and duplicate/conflict handling.
- [ ] Share notes using Android's native share sheet where appropriate.
- [ ] Respect private-note and attachment privacy rules.
- [ ] Provide clear results when an import/export/share operation partially fails.
- [ ] Test backups and restores with realistic note content and special characters.

## 18. Ask My Notes AI

- [ ] Audit the PWA AI feature, supported actions, limits, and error handling before porting it.
- [ ] Decide which native AI capabilities are supported and clearly communicate prerequisites.
- [ ] Require authentication if the PWA requires it.
- [ ] Exclude Private Notes and any other restricted content from AI context.
- [ ] Protect API credentials on the server; never embed private provider keys in the mobile bundle.
- [ ] Handle loading, empty responses, rate limits, unsupported models, offline state, and provider errors.
- [ ] Make it clear which notes/content are being used for a request.
- [ ] Test AI access controls and privacy boundaries before release.

## 19. UX, accessibility, and Android behaviour

- [ ] Give interactive controls meaningful accessible labels and roles.
- [ ] Verify screen-reader focus order and announcements.
- [ ] Use readable text, adequate contrast, and practical touch targets.
- [ ] Support Android system back behaviour and predictable navigation.
- [ ] Check keyboard overlap, scrolling, orientation/resizing, and small screens.
- [ ] Avoid relying on colour alone to convey status.
- [ ] Add confirmation for destructive actions and undo where appropriate.
- [ ] Test slow devices, low memory, interrupted network, and app background/foreground transitions.

## 20. Performance, privacy, and security

- [ ] Keep long note lists responsive and use efficient list rendering.
- [ ] Avoid unnecessary rerenders and repeated storage operations.
- [ ] Test large notes and attachment-heavy content.
- [ ] Avoid logging note content, tokens, credentials, or personal information.
- [ ] Validate user-controlled content and imported files.
- [ ] Review dependency audit findings without unsafe forced upgrades.
- [ ] Check storage access, auth boundaries, network permissions, and release configuration.
- [ ] Provide transparent privacy and backup limitations.
- [ ] Verify errors do not silently erase or overwrite user data.

## 21. Testing and release readiness

- [ ] Run the repository's check script (tests, TypeScript, lint as configured) after each meaningful change.
- [ ] Run Expo dependency compatibility checks after dependency changes.
- [ ] Run a production export/build check where applicable.
- [ ] Test on a real Android device / Expo Go for every feature that needs device interaction.
- [ ] Test create, edit, search, delete, and persistence together as a regression flow.
- [ ] Test fresh install, upgrade from an earlier build, and stored-data migration.
- [ ] Test offline and reconnection scenarios.
- [ ] Test account boundaries and private-note restrictions before cloud/AI release.
- [ ] Review accessibility, error states, and small-screen layout.
- [ ] Keep release notes and known limitations accurate.
- [ ] Do not mark release-ready until critical flows have been verified on-device.

## 22. Current migration progress log

Update this table as PRs merge and testing results are confirmed.

| Area / milestone | Current status | Evidence / notes |
| --- | --- | --- |
| Expo / React Native foundation | Implemented; continue regression testing | App runs in the current development setup |
| Local note storage foundation | Implemented | Initial JSON snapshot and per-note storage work merged |
| Storage reliability | Implemented; regression testing remains | Serialization, cleanup, and recovery work merged |
| Native note search | Verified by user | Search works correctly on Android after merge; PR #9 keeps search fixed and filters the library view. |
| Main interface and navigation | **User verified on Android** | PR #9 merged; user reports all tests passed and the app worked perfectly. Fixed header/search, library/editor views, drawer, and Android back handling verified. Categories/folders/archive/trash/settings/auth remain future destinations. |
| Categories and folders | Not started | Must match PWA behaviour |
| Formatting and checklists | Not started | Audit native editor against PWA |
| Drafts and edit history | Not started | Audit PWA behaviour first |
| Authentication and cloud sync | Not started | Design only after data-model/security audit |
| Attachments and document viewer | Not started | Audit PWA rules and Android file access |
| Private Notes/security | Not started | Requires explicit privacy testing |
| Settings, sharing, and AI | Not started | Scope based on PWA audit |
| Full regression and release readiness | Not started | Complete after feature migration |

### PR / device test log

| Date | PR / build | What changed | Automated checks | Android / Expo Go result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | PR #6 search | Native note search, clear action, match count, no-results state | Automated test/check results should be recorded from the actual run | **User verified: search works correctly** | Continue regression checks as navigation and filtering expand |
| 2026-10-20 | [PR #9 app shell](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/9) | Fixed header/search, separate All Notes library and editor views, functional drawer for implemented destinations, green native styling, back navigation and unsaved-change confirmation; fixed React Native 0.88 drawer backdrop API compatibility | Local `npm run check` passed before review; user confirms all tests passed | **User verified: app worked perfectly on Android** | Keep regression testing as features expand |
| 2026-10-20 | PR #10 editor draft recovery (open PR) | Adds a separate versioned AsyncStorage recovery record, 500 ms debounced draft autosave, ordered writes, restore-after-notes-load, and visible recovery-storage errors; saved notes remain unchanged until explicit Save | Two reducer recovery tests and five source regression tests added; CI/check results pending | **Device testing required** | Test new/edit draft recovery after force-close/restart, discard behavior, save clearing, malformed draft, and storage errors |

---

## Current milestone: editor draft recovery (PR #10)

PR #9's app shell and navigation have been merged and user-verified on Android. PR #10 adds recovery for one unsaved native editor draft without changing the saved-note format or pretending the full PWA Drafts library is already migrated.

Before merging PR #10:

- [x] Audit the PWA editor and draft autosave implementation (`index.html`, `js/app.js`, `js/drafts.js`).
- [x] Audit the native note reducer, controller, and storage boundary before adding recovery.
- [x] Keep recovery data in a separate versioned key so it cannot overwrite saved notes.
- [x] Add reducer and source regression tests for recovery and error handling.
- [ ] Run `npm run check` and review CI results.
- [ ] Verify autosave and restore on Android after force-close/restart for both new notes and edits.
- [ ] Verify explicit Save and Discard clear the recovery record, and malformed/storage-failure cases preserve saved notes.
- [ ] Update this roadmap with final test and device results before merge.

**Golden rule:** PWA parity is a behaviour-and-reliability goal, not a screenshot-only goal. Mark items complete only when implemented and verified.
