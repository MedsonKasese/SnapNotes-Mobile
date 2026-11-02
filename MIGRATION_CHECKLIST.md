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
- [x] Build a clear app header with menu/navigation, product identity, and note count. (PR #9 verified; the optional account drawer entry is implemented in the email-auth stage, with Android verification pending.)
- [x] Keep essential navigation/header elements fixed where appropriate instead of scrolling away with the note list. (PR #9 verified on Android.)
- [x] Establish distinct, understandable Library and Editor experiences. (PR #9 verified on Android.)
- [x] Implement and verify initial native empty states, loading/error states, and unsaved-change confirmation patterns. (Full PWA parity remains.)
- [ ] Ensure layouts work on small Android screens and with the on-screen keyboard open.
- [ ] Respect Android safe areas, status/navigation bars, and system back behaviour.
- [ ] Avoid clutter, unnecessary animation, and oversized cards; keep the interface focused.
- [ ] Verify light/dark appearance only when the corresponding setting and styling are implemented.

## 4. Note creation, editing, and formatting

- [x] Compare the native editor with the PWA editor and document supported formatting. (PR #19 reviewed PWA `js/app.js` toolbar commands and `index.html` icon order; README documents the six supported controls and native adaptations.)
- [ ] Create, edit, and save notes reliably.
- [ ] Support the PWA's title convention and avoid duplicate title markers.
- [ ] Preserve note content when switching views, opening navigation, or temporarily leaving the editor.
- [ ] Handle empty titles/bodies and whitespace consistently with the PWA.
- [ ] Add supported formatting (headings, emphasis, lists, links, and other PWA-supported formatting) with native-friendly editing. (PR #19 implements bold, italics, unordered/ordered lists, checkboxes and safe links using an offline rich editor. Icon-only tools replace the old checklist button opposite the Note label. Sanitized optional HTML survives save/reload, draft recovery and duplication; visible text drives the shared budget. Automated and browser-document checks pass; Android/iOS native keyboard, selection, font scaling and screen-reader verification remain required. Headings and unrelated PWA features are not part of this slice.)
- [ ] Support checklists/task items if present in the PWA; verify checkbox alignment and interaction. (PR #11 adds native checklist insertion; PR #12 adds persisted inline toggles, compact rows, italic checked labels, and a thicker per-line strike-through. Typecheck, lint, 80 tests, Expo compatibility, and Android/iOS JavaScript exports pass locally. Android visual and interaction testing is still required before marking complete.)
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

- [x] Audit the PWA's category names, defaults, assignment rules, and filtering behaviour. (Compared `js/app.js`, `js/notes.js`, and `index.html`.)
- [ ] Support the existing categories: General, Work, Personal, Ideas, and Important. (Implemented in PR #13; Android verification required.)
- [ ] Assign and change a category according to PWA behaviour. (PR #13 implements the five-category picker; a separate remove/unassign action is not applicable because every note has a category.)
- [ ] Filter and count notes by category accurately. (PR #13 implements library chips and drawer counts; automated/device verification required.)
- [ ] Preserve category assignment through edits and restarts. (PR #13 includes reducer/storage changes and legacy records default to General; cloud sync remains future work.)
- [ ] Provide sensible category empty states and accessible category controls.

## 7. Navigation drawer and library

- [ ] Audit the PWA navigation drawer and its grouping/order before designing the native equivalent.
- [ ] Implement an accessible, working navigation drawer or suitable Android-native navigation pattern.
- [ ] Provide a working All Notes destination.
- [ ] Connect category destinations.
- [ ] Connect folder destinations.
- [ ] Connect Drafts, Private Notes, Archive, and Trash when those features are implemented.
- [ ] Connect Settings and account actions when available. (The optional email/password account entry is implemented in this PR; full Settings remain out of scope and Android verification is required.)
- [ ] Show accurate counts where the PWA does.
- [ ] Highlight the current destination and preserve expected back navigation.
- [ ] Never show a destination as available if it is not implemented; use a clear disabled/coming-soon state only if justified.

## 8. Note management

- [x] Pin and unpin notes, matching PWA behaviour. (PR #14 merged; user verified the pin icon, pinned-first sorting, persistence, and clean card layout against the PWA.)
- [ ] Compact anchored note-actions popup and tap-card-to-open behavior (PR #18 implemented; automated checks pass, Android and screen-reader verification pending). Use the reference menu design without adding new actions; preserve inline checklist interaction, the standalone pin button, and Trash-only actions. Verify popup placement near screen edges and with large text.
- [x] Duplicate notes if supported by the PWA. (PR #19 merged and user verified duplication works correctly; PR #19 implements PWA-style Copy of title, fresh timestamps, original category/body/formatting, unpinned/unarchived copies, storage-first saves, and regression tests. Maximum-length copies are rejected before writing with a clear message. Automated checks pass; owner verified Android functionality and merged PR #19.)
- [ ] Archive and restore notes. (PR #15 implements the initial archive library, persisted archive state, and restore action; testing required.)
- [ ] Move notes to Trash and restore them.
- [ ] Permanently delete notes with clear confirmation.
- [ ] Select and manage multiple notes if the PWA supports bulk actions.
- [ ] Preserve note order and timestamps according to PWA rules.
- [ ] Verify actions work correctly from search results, category views, and folder views.

## 9. Folders

- [x] Audit PWA folder creation, naming, nesting (if any), and note-movement rules. (PR #20 reviewed js/folders.js: flat folders, max 20, 32-character names, unique case-insensitive names, unfile on delete.)
- [ ] Create, rename, and delete folders safely. (PR #20 implemented; Android verification pending.)
- [ ] Move notes into and out of folders. (PR #20 adds action-menu picker; Android verification pending.)
- [ ] Define and test what happens to notes when a folder is renamed or deleted.
- [ ] Display folder contents and counts accurately. (PR #20 adds drawer folder destinations and counts; Android verification pending.)
- [ ] Preserve folder membership through restart and future sync.
- [ ] Prevent accidental data loss when moving or deleting folders.

- [ ] Customize folder icons and colors (PR #21 adds PWA's nine icons and six colors plus None, with a persistent picker. Each folder has a three-dot menu beside its note count for Rename, Customize, and Delete; shared controls below the list are removed. Automated regressions cover per-folder targeting, persistence, cancellation/Back, retry, stale callbacks, and note preservation; native device verification remains pending).

## 10. Private Notes and security
- [ ] PR #30 private move preparation (testing required): PWA-compatible private payload and source/vault preflight guards. No live move, deletion, or encryption transaction yet. Follow-up must implement verified encryption, ciphertext-first persistence, recovery and controller coordination before enabling Move to Private.

- [ ] PR #29 session hardening (owner review required): in-memory attempt guard, reject stale unlock after background/navigation, and explicit Cancel control. Fixed the strict screen harness to exercise the real guard, restored foreground activity after React effect cleanup/replay, and made attempt tokens unique with token-scoped completion. Typecheck, lint, all **316 tests**, Expo dependency compatibility, and Android/iOS JavaScript exports pass locally. Regressions cover Cancel during setup/unlock, stale success/failure, initial background mount, effect replay, stale completion ownership, and real-crypto setup completing after leaving. The setup UI explains that Cancel keeps the UI locked but does not undo password setup already in progress. Independent manual review found no remaining material blocker; actual DeepCode/Snyk Code scanning and Android development-build runtime verification remain pending. Keep draft and unmerged until the owner completes those checks. No fingerprint, note migration or sync.

- [ ] PR #28 password setup and initial interface (owner review required): Private Notes drawer entry, encrypted password verifier, setup/unlock/lock UI, background locking, and regression tests. Fixed strict workspace test mocks, stale authentication after background/navigation/unmount, pre-render double submits, and concurrent setup overwrites with a serialized initialize-if-empty commit. Typecheck, lint, all **301 tests**, Expo dependency compatibility, and Android/iOS JavaScript exports pass locally. Independent manual deep-code review found no remaining material blocker; actual DeepCode/Snyk Code scanning and Android development-build runtime verification remain pending. No note migration, encrypted note viewer, or cloud sync. Keep this PR draft and unmerged until the owner completes those checks.


- [x] PR #26 crypto core: AES-256-GCM/PBKDF2-SHA-256 (600k iterations) verified in a native Android development build with nine successful device smoke tests; encrypted PWA↔Android fixture compatibility still needs verification.
- [ ] PR #27 ciphertext-only private vault storage (in progress): isolated versioned vault, validated encrypted records, atomic generation/pointer commits and failure regression tests. No UI, no migration of ordinary notes, no cloud sync. Requires automated and Android verification before checking complete.

- [ ] PR #38 follow-up (testing required): moving a note into Private Notes retains its created/updated timestamps inside the encrypted payload; restore preserves them, and the Private Notes screen plus drawer show an accurate count without decrypting for navigation. Automated regressions pass. The owner must verify the change on Android before the next migration stage.

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

- [ ] Multi-draft library UI and local persistence (PR #23 adds Save to Drafts, drawer Drafts count/list, reopen and confirmed deletion; reviewed save locking, recovery identity, visible storage errors and removal only after a note successfully commits are covered by regression tests; Android verification pending). Drafts are device-only and are not edit history. Existing recovery draft is retained. Note and draft writes use separate storage keys: if draft cleanup fails after a note save, both copies are kept with an explicit warning.

- [ ] Multi-draft library foundation (PR #22 adds a separate validated draft model, PWA-style upsert/remove helpers and regression tests; UI, persistence wiring, and Android verification still pending).

- [ ] Audit PWA draft/autosave behaviour and decide when a note becomes a draft.
- [ ] Preserve unfinished work after navigation or unexpected app closure. (Testing required: PR #10 adds debounced device-only editor-draft recovery; automated checks pass locally, but Android restart/error-path verification is still required.)
- [ ] Provide a Drafts view if supported by the PWA.
- [ ] Audit the PWA's edit-history behaviour before implementation.
- [ ] Restore prior content safely if edit history is supported.
- [ ] Distinguish edit history from full version history; do not imply capabilities the app does not provide.

## 14. Authentication and account management

- [x] Phase 0/1 Firebase persistence/auth-state spike prepared from `main`: Firebase JS SDK aligned with the PWA, React Native AsyncStorage persistence, typed observer state, and account-free mocked observer tests. See `docs/firebase-auth-spike.md`.
- [ ] Verify Firebase initialization, persistent auth restoration, and sign-out on the owner's Android development build; confirm local notes remain unchanged (see `docs/firebase-auth-spike.md`).
- [x] Audit the PWA's sign-in providers, signup flow, verification, and account states. (Compared `SnapNotes/js/auth.js`, `SnapNotes/index.html`, and `SnapNotes/js/firestore.js`; the mobile local-first boundary intentionally does not copy PWA note-cache merge or Firestore loading. See `docs/mobile-email-auth.md`.)
- [ ] Implement the agreed authentication experience for the native app. (Phase 2 email/password registration, sign-in, optional account entry, and basic sign-out are implemented; automated and hosted checks plus owner Android testing are required before marking complete.)
- [ ] Show profile name/photo and account details accurately when available.
- [ ] Handle sign-in cancellation, expired sessions, network errors, and sign-out.
- [ ] Implement email verification/password recovery only where supported by the chosen auth setup. (Registration sends Firebase verification email and supports retry only when the immediate post-create step fails; verification-pending, general resend/refresh, and password recovery remain Phase 3.)
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
| Main interface and navigation | **User verified on Android; account entry testing required** | PR #9 merged; user reports all tests passed and the app worked perfectly. Fixed header/search, library/editor views, drawer, and Android back handling verified. Optional account entry is implemented; full Settings remain future work. |
| Categories and folders | **Categories user verified; folders in PR #20 pending testing** | PR #13 merged; user verified category display and assignment on Android. Folders implemented and user verified in merged PR #20; appearance customization is pending PR #21 testing. |
| Formatting and checklists | User reports rich editor tested and working on Android; additional regression testing remains | Six PWA-order icons, rich emphasis/lists/safe links and checkboxes; optional sanitized HTML with backward-compatible plain notes. Checkbox selection preserves text; checked styling and inline persistence remain. Typecheck, lint, automated tests, Expo compatibility and Android/iOS JavaScript exports pass. Native visual/keyboard/selection/font-scaling/accessibility QA and authenticated DeepCode/Snyk scanning remain owner gates; not release-ready or merged. |
| Duplicate notes | **User verified and merged PR #19** | Duplicating notes works correctly on Android. |
| Drafts and edit history | **In progress; Android testing required** | PR #10 implements one local editor recovery draft; initial CI lint failure fixed and local automated checks pass. Full Drafts library and edit history remain unimplemented. |
| Authentication and cloud sync | Email/password account entry merged; native Google sign-in proposed in this PR and awaiting OAuth setup plus Android phone testing; cloud-note sync remains a separate design task | Firebase Auth identity only: no note migration, merge, reassignment, upload, overwrite, delete, Firestore access, or Private Notes/vault coupling. See `docs/mobile-email-auth.md` and `docs/mobile-google-signin.md`. |
| Attachments and document viewer | Not started | Audit PWA rules and Android file access |
| Private Notes/security | Not started | Requires explicit privacy testing |
| Settings, sharing, and AI | Not started | Scope based on PWA audit |
| Full regression and release readiness | Not started | Complete after feature migration |

### PR / device test log

**PR #14 icon follow-up:** The later FontAwesome change reproduced 25 test failures because two strict VM test harnesses lacked the new native icon import mock. Added explicit module mocks without disabling unknown-import guards or existing tests, plus two regressions for drawer icons and accessible pin/unpin labels/state. Updated `expo-font` from `~58.0.8` to Expo's recommended `~58.0.9` and refreshed the lockfile without adding native configuration. A fresh `npm ci`, typecheck, lint, all **123 tests**, Expo dependency compatibility, and Android/iOS JavaScript exports passed; the exports include `FontAwesome.ttf`. Independent review found no further confirmed icon defect; no DeepCode/Snyk scan was available. Hold merge until hosted CI and Android/Expo Go checks (including icon loading, pinning/restart, and TalkBack) pass. The Node module-type warning is non-fatal; device verification is still outstanding.

| 2026-10-21 | PR #13 (implementation in progress) | Five-category editor picker, library filtering, drawer counts, backward-compatible category storage and regression tests | Not yet run in Termux; do not treat as passed | **Android / Expo Go testing required** | Check create/edit/category-only changes, filtering combined with search, restart persistence, legacy notes defaulting to General, and drawer navigation. |
| 2026-10-21 | PR #14 (merged; user verified) | Pin/unpin action with Font Awesome thumbtack, pinned-first ordering, local persistence, uncluttered icon-only card action, and Font Awesome category drawer icons | PR #14's prior automated checks recorded in the preceding log; user reports the merged UI looks and behaves like the PWA | **User verified on Android** | Continue regression checks while archive and trash are migrated. |

| Date | PR / build | What changed | Automated checks | Android / Expo Go result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | PR #6 search | Native note search, clear action, match count, no-results state | Automated test/check results should be recorded from the actual run | **User verified: search works correctly** | Continue regression checks as navigation and filtering expand |
| 2026-10-20 | [PR #9 app shell](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/9) | Fixed header/search, separate All Notes library and editor views, functional drawer for implemented destinations, green native styling, back navigation and unsaved-change confirmation; fixed React Native 0.88 drawer backdrop API compatibility | Local `npm run check` passed before review; user confirms all tests passed | **User verified: app worked perfectly on Android** | Keep regression testing as features expand |
| 2026-10-20 | [PR #10 editor draft recovery (open PR)](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/10) | Adds separate versioned recovery storage, 500 ms debounce, ordered writes, and visible errors. CI fix separates storage loading from the recovery completion callback for startup and Retry; no lint suppression, storage-format change, or PWA edits | Clean `npm ci`; `npm run check` passed (typecheck, lint, **66 tests**); `npx expo install --check` passed; Android/iOS JavaScript export passed on Node 24.19.0. Added deferred-startup and Retry regression checks. See PR checks for hosted CI rerun results | **Device testing required; not claimed verified** | Use README Termux checkout commands; test new/edit recovery, Save/Discard clearing, malformed data and storage failures. Leave PR open for review |
| 2026-10-20 | [PR #12 checklist fixes (open PR)](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/12) | Reduced minimum row height from 36 to 28 points; constrained label width for wrapping; italic checked labels with a 2-point strike per visual line; exposed disabled accessibility state; added persistence, rollback, rapid-action, and rendering regression tests | `npm run check` passed (typecheck, lint, **80 tests**); `npx expo install --check` passed; Android/iOS JavaScript export passed. Independent code review performed; no DeepCode/Snyk scan was available | **Device testing required; not claimed verified** | Hold merge pending hosted CI and Android checks: short/long/blank labels, larger fonts, check/uncheck, restart persistence, rapid taps, storage errors, and TalkBack. Compact full-width rows trade target height for density; assess touch comfort on device. |

---

## Current milestone: editor draft recovery (PR #10)

PR #9's app shell and navigation have been merged and user-verified on Android. PR #10 adds recovery for one unsaved native editor draft without changing the saved-note format or pretending the full PWA Drafts library is already migrated.

Before merging PR #10:

- [x] Audit the PWA editor and draft autosave implementation (`index.html`, `js/app.js`, `js/drafts.js`).
- [x] Audit the native note reducer, controller, and storage boundary before adding recovery.
- [x] Keep recovery data in a separate versioned key so it cannot overwrite saved notes.
- [x] Add reducer and source regression tests for recovery and error handling.
- [x] Run `npm run check` and inspect the original CI failure. (Fixed `react-hooks/set-state-in-effect` without disabling it; typecheck, lint and all 66 tests pass locally. See PR checks for the hosted rerun.)
- [x] Validate Expo dependency compatibility and export Android/iOS JavaScript bundles locally. (Not native builds or device tests.)
- [x] Document safe checkout, automated checks, and same-phone Expo Go startup in Termux in README.
- [ ] Verify autosave and restore on Android after force-close/restart for both new notes and edits.
- [ ] Verify explicit Save and Discard clear the recovery record, and malformed/storage-failure cases preserve saved notes.
- [ ] Update this roadmap with final test and device results before merge.

**Golden rule:** PWA parity is a behaviour-and-reliability goal, not a screenshot-only goal. Mark items complete only when implemented and verified.


| 2026-10-21 | PR #15 (in progress) | Adds persisted archive state, Archived drawer destination, archive action, and restore action; legacy notes default to active | Automated checks not run in the developer's local Termux environment | **Android / Expo Go testing required** | Verify archive removes a note from All/category counts, archived notes appear only in Archived, restore returns them to the library, state survives restart, search works in both views, and failed writes roll back safely. |

### PR #18 compact menu follow-up

The note actions now open in a compact, rounded popup with the original action icons anchored to the tapped three-dot button instead of a full-width bottom sheet. This borrows only the supplied reference design: no duplicate, share, history, private-note, or folder actions were added. Existing library/archive/trash actions, confirmations, and the standalone pin button are preserved. Measured safe-area placement flips/clamps near screen edges and scrolls when large text exceeds the available height; stale native measurements cannot revive a dismissed menu.

Typecheck, lint, all **182 tests**, Expo dependency compatibility, and Android/iOS JavaScript exports pass locally. Independent code review found no blocking defect; an authenticated DeepCode/Snyk scan was unavailable. **Keep PR #18 draft and unmerged for the owner's review.** Expo Go visual/touch, system-bar/safe-area, large-text, and TalkBack/VoiceOver verification remain required before marking this feature complete.
