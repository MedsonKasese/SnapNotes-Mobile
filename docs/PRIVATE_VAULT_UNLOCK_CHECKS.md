# Private Notes: responsive unlock and safe Android checks

The unlock flow now stops waiting indefinitely for asynchronous vault reads, native key derivation and AES operations. A timeout never grants access or resets the vault. Locked-vault validation no longer decodes every note's ciphertext into temporary byte arrays, and runtimes missing `TextDecoder` can read authenticated UTF-8 through a strict fallback.

These are tested fixes for specific failure paths, not proof of the reported phone's root cause. Node tests and JavaScript/Hermes bundle exports are not Android native-device tests.

## What this does not enable

Current `main` has a password-verification screen, but **encrypted-note viewing and the Move to Private UI are not yet connected**. Successful authentication still shows the existing explanatory placeholder. This PR does not claim to implement the full private-note viewer or transaction/recovery workflow. PRs #31 and #32 are already merged into the baseline; this is a new follow-up branch from `main`.

## Keep the existing data

Do not clear app data, reset the vault, uninstall, or overwrite ciphertext to troubleshoot. Update the existing installation using the same application ID and signing key, preserving its data. Never share passwords, keys, note contents or vault records.

Use a compatible development APK containing Expo 58 / React Native 0.88 and Quick Crypto. **Expo Go does not include this native cryptography.** Confirm both the JavaScript revision and native binary: an older development APK with new JavaScript is not a verified compatible environment.

## Security stays the same

- PBKDF2-SHA-256 still performs **600,000 iterations**, deriving a non-extractable 256-bit AES-GCM key. No faster/weaker KDF, password/key cache, plaintext storage or authentication bypass was added.
- Passwords are not trimmed or normalized. Existing case, spaces and Unicode must match exactly.
- Setup still verifies a serialized verifier using a freshly derived key before committing. It still performs two complete derivations.
- Unlock is read-only. Ciphertext format, fresh random IVs, authentication tags, exact verifier matching and encrypted-storage validation remain enforced.
- The UTF-8 fallback runs only when `TextDecoder` is absent. Invalid UTF-8, JSON and real decoder failures remain errors. It does not skip AES-GCM authentication.
- Password input state clears immediately on submission. Backgrounding, leaving, Cancel and unmount still invalidate late authentication results.

## Responsive failure handling

Vault reads and native-provider initialization have a 10-second deadline. PBKDF2/import has a 30-second deadline; asynchronous AES has a 10-second deadline. These are **per-stage limits**, not an end-to-end speed guarantee. They cannot interrupt a synchronously blocked JavaScript/native thread.

A deadline stops waiting; it cannot cancel native work. The native KDF guard remains held until the real operation settles, so retrying cannot launch overlapping password derivations. A timed-out result cannot later unlock or save setup. Storage queues also remain serialized; if an underlying read never returns, retry may time out again. Restart the app **without clearing its data** if the operation remains stuck.

Writes do not have artificial timeouts: a write could commit after a caller stopped waiting. Cancel remains available during setup and the existing warning still applies—setup may finish after leaving. Do not start a fresh vault/reset when a commit is uncertain.

Transient status errors now offer Retry. Loading/busy states are announced, secure inputs are not editable during authentication, and Cancel remains available.

## Safe error codes

Report only the bracketed code and build/revision, never secrets or ciphertext.

| Code | Meaning and next step |
| --- | --- |
| `PV-NATIVE` | The native crypto module could not initialize. Use a compatible development APK, not Expo Go. This is not a wrong-password verdict. |
| `PV-TIMEOUT` | A read/provider/key/AES stage exceeded its deadline. No unlock was granted. Retry after the underlying operation settles, or restart without clearing data. |
| `PV-BUSY` | A previous native key operation is still running after a timeout. Wait or restart without clearing data; repeated presses do not start more KDF jobs. |
| `PV-KEY` | Key import or PBKDF2 failed before authentication. Investigate the compatible native build; do not assume the password is wrong. |
| `PV-AUTH` | AES-GCM authentication failed. Password mismatch, altered ciphertext and a native decrypt failure remain indistinguishable. Preserve the records. |
| `PV-DECODE` | Authenticated bytes could not be read as strict UTF-8/JSON. Check runtime and payload format using disposable fixtures; do not log plaintext. |
| `PV-VERIFY` | The authenticated JSON was not the expected verifier. Investigate compatibility without changing stored records. |
| `PV-STORAGE` | Vault reading/validation failed. Retry a transient error; investigate persistent index/storage inconsistency read-only. |
| `PV-DATA` | The verifier format was invalid. Loading usually rejects it first as `PV-STORAGE`. |
| `PV-SETUP` | The serialized-record/fresh-key setup check failed. No vault was written by that attempt. Fix the runtime before trying again. |

Raw native/storage exception details and their inputs are not exposed as diagnostics.

## Before owner approval

1. Complete an authenticated **Snyk Code / DeepCode** scan of the exact PR head (`snyk auth`, then `snyk code test`). An attempt blocked by `MissingApiTokenError` is not a completed or clean scan. Resolve blocking findings.
2. On the existing Android installation, test the existing password, wrong-password rejection, lock/unlock, Cancel during unlock, background/foreground, leave/re-enter and process restart. Confirm ordinary notes and stored vault data are unchanged. Record unlock duration without logging secrets.
3. On separate disposable data only, test setup/restart with a Unicode password and both setup derivations. Exercise delayed reads/native calls in the test harness, status Retry, and late completion after a deadline. Verify no late unlock and no duplicate native KDF after timeout.
4. Run `npm run check`, `npx expo install --check`, and Android/iOS bundle exports. Triage inherited dependency audit advisories separately; do not force downgrade Expo or native security packages.

Keep the new PR unmerged until these gates and the owner's review are complete. Completing the private-note viewer/move workflow needs a separate reviewed change; this PR does not make that missing functionality available.
