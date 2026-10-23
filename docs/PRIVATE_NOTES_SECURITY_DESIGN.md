# Private Notes — cross-platform security design (PR #25)

**Status: architecture proposal, NOT an encryption implementation.** No private notes should be created or moved until implementation, automated crypto vectors and Android device checks are complete.

## Product decision
The user wants the **same Private Notes password** to decrypt notes on the PWA and Android after authentication/cloud sync. Account authentication is independent of the private-note password. Private Notes can be implemented offline before sign-in.

## Audited PWA contract
Source: `MedsonKasese/SnapNotes/js/private-notes.js`, `js/private-note-utils.js`, `js/private-passkey.js`.

- Private payload: JSON object containing title, text, HTML, category, tags, time, folderId, reminders, attachments, history. Locked metadata is replaced by generic values.
- Cipher: **AES-256-GCM** with a fresh cryptographically random **12-byte IV** for every encryption.
- Password KDF: **PBKDF2-HMAC-SHA-256**, **600,000 iterations**, UTF-8 password bytes, per-vault salt.
- Cipher record: `{version:1,algorithm:'AES-GCM',kdf:'PBKDF2-SHA-256',iterations:600000,salt:<base64>,iv:<base64>,ciphertext:<base64>}`. Web Crypto AES-GCM ciphertext includes the authentication tag.
- PWA requires a minimum 12-character password for setup. Forgetting the password can mean losing access to encrypted content.
- PWA passkeys use WebAuthn **PRF** output + **HKDF-SHA-256** to wrap the same private encryption key. A biometric prompt or a generic device keychain unlock is **not** automatically compatible with PWA passkeys.
- Lock modes in PWA: immediate, 1 minute, 5 minutes, app-close.

## Android implementation gates (in order)
1. **Cryptographic compatibility first.** Select a maintained cryptographic implementation that works in the intended Expo Go/Android runtime, uses secure randomness, PBKDF2-SHA-256 and authenticated AES-GCM. Never implement cryptography with homegrown algorithms, `Math.random`, or a WebView exposing plaintext notes to arbitrary HTML.
2. **Cross-platform test vectors.** Generate PWA-produced encrypted fixtures and verify Android decrypts them with the same password; Android-produced fixtures must decrypt in the PWA. Test Unicode passwords, invalid passwords, tampering, nonce uniqueness, malformed records, and corrupted data.
3. **Storage design.** Encrypt content **before** any persistent write. Keep private records separate from normal notes; never write decrypted private content into normal notes storage, editor recovery drafts, logs, search indexes, previews, or notification bodies.
4. **Safe migration.** For moving an existing local note to Private Notes: encrypt + durably commit private record first, then remove readable copy using a recoverable, idempotent transaction/recovery journal. Do not silently lose data or leave an unreported plaintext copy after interrupted moves.
5. **Unlock/lock.** Password unlock first, keys held in memory only while unlocked; clear on lock/background according to selected policy. Prevent recent-app preview leakage and verify lifecycle behavior on Android.
6. **Passkeys separately.** Research and validate Android Credential Manager/WebAuthn PRF support and native-app RP/domain association, plus Expo Go versus development build limitations. Do not claim PWA-compatible passkeys until proven with real-device interoperability tests. Password fallback remains available.
7. **Future auth/sync.** Associate encrypted records with authenticated owner when cloud sync arrives without changing password KDF or plaintext exposure. Resolve conflicting vault salts/keys explicitly; do not assume same password implies same key across independent vault initializations.

## Not implemented in PR #25
No new dependencies, cryptographic APIs, encrypted records, UI, password input, passkey registration, or private-note migration. This PR only records a reviewed compatibility/security contract for implementation.

## Acceptance criteria for the implementation PRs
- Verified PWA ↔ Android encrypted fixture interoperability.
- Device testing for wrong password, app restart/background, device storage failures, interrupted move, and protected previews.
- Reviewable PRs with no merge before user tests and approval.
