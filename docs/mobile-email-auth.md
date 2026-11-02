# Mobile email/password account entry

## What this stage adds

SnapNotes Mobile now has an optional account entry from the notes drawer, with email/password registration, sign-in, and sign-out. The notes workspace remains available without an account and stays mounted underneath the account modal. Firebase Auth persistence and observer state continue to come from the Phase 0/1 foundation in `docs/firebase-auth-spike.md`.

Registration collects a display name, email, password, and confirmation. It trims/collapses display-name whitespace, trims and lowercases the email consistently, leaves passwords unchanged, validates the form before calling Firebase, and disables repeat submissions while an operation is in flight. Passwords are never stored or logged. Firebase errors are mapped to safe, user-facing messages.

The app checks only a basic email shape (one `@`, no whitespace, and text on both sides); it does not whitelist email providers or require a dotted domain. Firebase is the authority on whether an address is accepted. `auth/admin-restricted-operation` indicates end-user account creation is disabled in the authentication service; `auth/operation-not-allowed` indicates email/password auth is not enabled for the app. Duplicate-email errors use neutral copy and do not disclose whether an address is registered. The UI explains service restrictions separately and does not change Firebase settings.

Password fields start masked and include independent, accessible eye controls to show or hide login, registration, and confirmation values. Toggling visibility does not alter the entered value, account flow, or local notes.

Registration sends Firebase's verification email after account creation. If saving the display name or sending that email fails, the account remains created and signed in; the screen offers a retry for only the failed follow-up operation. Retrying does not call account creation again, and the registration result/retry state survives the Firebase observer's signed-in update. A successful explicit sign-out clears that transient account/form state.

An unverified signed-in account now has a pending state, a Firebase user reload action, and a resend-verification action. The displayed status is updated from the reloaded user; if the link was invalid or expired, safe guidance tells the user to request a fresh email and use the newest link. Resends have a 60-second client cooldown after a successful send, in addition to Firebase's server-side rate limits. The app does not add a custom email-action deep-link handler or change Firebase Console settings. Unverified users continue to use the local notes workspace.

The sign-in screen includes password recovery. Firebase `sendPasswordResetEmail` receives the normalized email, and success plus account-specific responses such as `user-not-found` use the same acknowledgement: “If an account exists for this email address, you'll receive password-reset instructions.” Network failures remain generic and never include provider details. This flow only requests Firebase's email; password completion remains on Firebase's action page.

## Local-first and security boundary

The account service only calls Firebase Auth. It does not import or call Firestore, read note storage, upload or migrate notes, merge account data, or assign local notes to a UID. Signing out calls Firebase Auth only; the auth observer clears the in-memory account summary and a successful sign-out clears the modal's form and retry state. Device-local notes, folders, drafts, attachments, and the separately encrypted Private Notes vault are not cleared or changed.

Only the public Firebase client configuration already reviewed in `src/firebase/firebaseConfig.ts` is used. No service-account, Supabase, Gemini, Resend, or Vercel secret is included. This is not a backup or sync feature.

## PWA comparison and intentional Android differences

The PWA account dialog is defined in `SnapNotes/js/auth.js` and `SnapNotes/index.html`. Its registration flow asks for a full name, email, and password, updates the Firebase display name, and sends a verification email. The mobile form adds confirmation, client-side email/password checks, loading protection, and field-level validation because the roadmap requires them.

The PWA has a resend control but relies on Firebase throttling rather than a client countdown. Its forgot-password handler distinguishes `auth/user-not-found` and can reveal that an address is not registered (`SnapNotes/js/auth.js`); Mobile returns the same neutral reset acknowledgement for success and account-specific responses. PWA sign-in copy asks an unverified user to verify, but its auth observer still restores the account library and begins Firestore loading; Mobile intentionally keeps unverified users in the device-local workspace and does not start cloud access. Mobile now refreshes `emailVerified` on demand and adds a 60-second resend cooldown.

The PWA observer can merge local and account caches and begin Firestore loading after sign-in (`SnapNotes/js/auth.js` and `SnapNotes/js/firestore.js`). Mobile deliberately does not copy that behavior: the roadmap forbids note migration, reassignment, merge, or upload during authentication. PWA sign-out also switches between local/account snapshots; mobile has one device-local workspace, so sign-out only ends the Firebase session and clears account-scoped UI state.

## Checks and owner validation

Automated tests cover form validation and normalization, safe error mapping, independent accessible password visibility toggles, registration follow-up retry, verification reload, resend retry/cooldown, neutral password-reset responses, and sign-out isolation. Run `npm run check`, `npx expo install --check`, and an Android JavaScript bundle export before review. No new package is required.

To update an Android/Termux checkout of the merged `main` after PR #44, run:

```sh
cd ~/SnapNotes-Mobile
git fetch origin
git switch main
git pull --ff-only origin main
```

To check out this review branch while the PR is still open:

```sh
git fetch origin
git switch --track origin/feat/mobile-email-verification-recovery
```

If that local branch already exists, use `git switch feat/mobile-email-verification-recovery` followed by `git pull --ff-only`. Do not merge this branch into local `main` before review. Because Termux's watcher limit prevents reliable local Metro operation, run Metro from the cloud development workspace/URL for the branch and open that URL in the existing Android development build. Use an already-available unverified owner test account: confirm “Verification pending,” resend and observe the countdown, open the newest email link, then refresh and confirm the verified state. Request password resets for an existing test address and a non-account address and confirm identical acknowledgement text. Compare ordinary local notes and Private Notes before/after; neither should change. These checks do not require new production accounts or Firebase Console changes.
