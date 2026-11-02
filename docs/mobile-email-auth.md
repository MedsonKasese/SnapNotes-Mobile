# Mobile email/password account entry

## What this stage adds

SnapNotes Mobile now has an optional account entry from the notes drawer, with email/password registration, sign-in, and sign-out. The notes workspace remains available without an account and stays mounted underneath the account modal. Firebase Auth persistence and observer state continue to come from the Phase 0/1 foundation in `docs/firebase-auth-spike.md`.

Registration collects a display name, email, password, and confirmation. It trims/collapses display-name whitespace, trims and lowercases the email consistently, leaves passwords unchanged, validates the form before calling Firebase, and disables repeat submissions while an operation is in flight. Passwords are never stored or logged. Firebase errors are mapped to safe, user-facing messages.

Registration sends Firebase's verification email after account creation. If saving the display name or sending that email fails, the account remains created and signed in; the screen offers a retry for only the failed follow-up operation. Retrying does not call account creation again, and the registration result/retry state survives the Firebase observer's signed-in update. A successful explicit sign-out clears that transient account/form state.

The account screen displays `emailVerified` from the current Firebase user state. After opening a verification link outside the app, that indicator may remain stale until Firebase refreshes the user/session or the user signs in again; this stage does not call `user.reload()` or provide a refresh button. It does not add a verification-pending route, general resend/refresh controls, password reset, deep links, or verification-link handling; those are in roadmap Phase 3. An unverified user can still use the local notes workspace.

## Local-first and security boundary

The account service only calls Firebase Auth. It does not import or call Firestore, read note storage, upload or migrate notes, merge account data, or assign local notes to a UID. Signing out calls Firebase Auth only; the auth observer clears the in-memory account summary and a successful sign-out clears the modal's form and retry state. Device-local notes, folders, drafts, attachments, and the separately encrypted Private Notes vault are not cleared or changed.

Only the public Firebase client configuration already reviewed in `src/firebase/firebaseConfig.ts` is used. No service-account, Supabase, Gemini, Resend, or Vercel secret is included. This is not a backup or sync feature.

## PWA comparison and intentional Android differences

The PWA account dialog is defined in `SnapNotes/js/auth.js` and `SnapNotes/index.html`. Its registration flow asks for a full name, email, and password, updates the Firebase display name, and sends a verification email. The mobile form adds confirmation, client-side email/password checks, loading protection, and field-level validation because the roadmap requires them.

The PWA's unverified sign-in UI asks the user to verify before continuing and includes a resend control. The mobile app instead lets Firebase establish the account session and explicitly keeps local notes usable while unverified, following the local-first roadmap; this mobile release has no cloud-dependent account feature to unlock. Verification status is shown without claiming that local notes are synced. General resend/refresh and recovery UI remains Phase 3.

The PWA observer can merge local and account caches and begin Firestore loading after sign-in (`SnapNotes/js/auth.js` and `SnapNotes/js/firestore.js`). Mobile deliberately does not copy that behavior: the roadmap forbids note migration, reassignment, merge, or upload during authentication. PWA sign-out also switches between local/account snapshots; mobile has one device-local workspace, so sign-out only ends the Firebase session and clears account-scoped UI state.

## Checks and owner validation

Automated tests cover form validation and normalization, safe error mapping, operation order, follow-up retry without duplicate account creation, and sign-out isolation. Run `npm run check`, `npx expo install --check`, and an Android JavaScript bundle export before review. A cloud Metro tunnel is recommended for the owner's existing Android development APK because Termux's file-watcher limit prevents reliable local Metro operation. Successful bundling and automated tests do not prove an on-device Firebase sign-in or persistence restore; owner testing is still required before merge.
