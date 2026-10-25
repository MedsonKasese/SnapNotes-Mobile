# Private vault unlock: safe device checks

The old message “Incorrect password or damaged private vault” catches unrelated key-derivation, decryption, and JSON/runtime errors. It does not prove the password is wrong or the vault is damaged. Passing Node tests or JavaScript bundle exports does not establish that Android native crypto works.

This patch adds safe failure-stage codes and verifies newly generated password verifiers before saving them. It is diagnostic/preventive hardening, not a confirmed fix for the reported Android failure. Existing encrypted records are not migrated, reset, or rewritten by unlock.

## Preserve the existing installation

Do not clear app data, reset the vault, uninstall, or overwrite stored ciphertext to troubleshoot. Update the existing installation with a compatible build signed with the same key, preserving application data. Do not share passwords, keys, note contents, or vault records.

Use the development build containing the pinned Expo 58 / React Native 0.88 runtime and Quick Crypto native modules. Expo Go is not sufficient. Confirm the new JavaScript revision is loaded as well as a compatible native binary. An old binary with new JavaScript is not a verified test environment.

## Retry the existing vault

Unlock with the existing password, including its original case, spaces, and Unicode. There is no trimming or normalization change in this patch. If it fails, report only the bracketed code and which build/revision was installed.

| Code | What it tells us | Next check |
| --- | --- | --- |
| `PV-KEY` | Provider initialization, key import, or PBKDF2 failed before authentication. | Check that the compatible native development build and crypto modules are installed. This is not a wrong-password verdict. |
| `PV-AUTH` | AES-GCM decryption/authentication failed. | Password mismatch, altered ciphertext, and native decrypt failure remain indistinguishable. Test crypto separately in a development build; never reset the existing vault to make the error disappear. |
| `PV-DECODE` | Decryption returned, but strict UTF-8 decoding or JSON parsing failed. | Check runtime/TextDecoder support and the decrypted payload format using non-sensitive test fixtures. Do not log plaintext. |
| `PV-VERIFY` | Decrypted JSON did not contain the expected verifier. | Investigate format/compatibility with test data; preserve stored records. |
| `PV-STORAGE` | Vault load/validation failed. | Investigate storage/index consistency without writing or deleting records. |
| `PV-DATA` | The supplied verifier record failed validation. | Investigate record format without altering it. Vault load normally rejects these first as `PV-STORAGE`. |
| `PV-SETUP` | A newly generated verifier failed the serialized-record/fresh-key check. | No vault was written by this setup attempt. Fix the native/runtime problem before trying setup again. |

`PV-AUTH` is deliberately not a claim that native cryptography works. These codes are fixed text; raw native exceptions and their inputs are not exposed or logged.

## Before owner approval

1. Run an authenticated **Snyk Code / DeepCode** scan on the exact PR head (`snyk auth`, then `snyk code test`). A manual review or an unauthenticated failed attempt is not a clean scan. Resolve blocking findings before merging.
2. On the existing Android installation, verify unlock, wrong-password rejection, lock/unlock, background/foreground handling, and process restart. Confirm ordinary notes and stored vault data are unchanged.
3. On separate disposable test data only, exercise new setup, leave/re-enter, and restart, including a Unicode password. Setup now performs two 600,000-iteration derivations, so measure the extra setup time on the device.
4. Re-run `npm run check`, `npx expo install --check`, and bundle exports. Review inherited dependency audit advisories separately; do not force-upgrade security dependencies blindly.

Keep this diagnostic PR and the separate, unconnected Move to Private core PR #31 unmerged until the owner reviews their independent gates. This patch does not enable Move to Private or implement vault recovery.
