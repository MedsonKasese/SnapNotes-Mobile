# Attachments migration audit (PWA → Android)

Source inspected: `MedsonKasese/SnapNotes` on `main`, especially `js/attachments.js`, `js/app.js`, `js/notes.js`, and `index.html`.

## Verified PWA behavior
- Attachment picker is gated by Firebase sign-in. Signed-out users receive an explanation rather than a silent failure.
- Up to **5 files per note**, **10 MiB each**.
- Allowed MIME types: PDF, plain text, JPEG, PNG, GIF, WebP. The HTML picker uses the same accept list.
- Browser uses IndexedDB for local attachment blobs and remote storage API for uploads; retries run on reconnect/auth change.
- PWA provides an in-app attachment viewer, including PDF rendering via `js/pdf-preview.js`.
- Attachment cleanup includes retry queues; deleting a note must not leave remote/local orphaned blobs.

## Mobile state and security decisions
- Mobile currently has **device-local notes** and no equivalent signed-in attachment upload service. Do not attach a working-looking upload button that silently stores unsynced references.
- First commit introduces only **pure validation and preview-type routing** with no changes to persisted note schema. This is deliberately safe for existing notes.
- Next implementation must choose a durable Android file storage model, note↔file transaction/recovery semantics, orphan cleanup, permission handling, and account boundary before enabling picker/upload.
- For **Private Notes**, plaintext file paths, cached previews, sharing, exports, and recent-app snapshots are sensitive. Do not add private attachments until encrypted storage and lock-time cleanup are designed and tested.
- Avoid placing file bytes in AsyncStorage or storing transient picker URIs as permanent references.

## Delivery gates (not yet implemented)
- [x] Inspect PWA types/limits/sign-in rules and viewer architecture.
- [x] Add pure MIME/count/size rules and automated unit tests.
- [ ] Durable Android file selection, copy, metadata and storage transactions.
- [ ] Editor attachment UI, list/remove/rename, and note-card display.
- [ ] In-app image, PDF and text previews, safe fallback for unsupported files.
- [ ] Handle offline, permission denial, missing files, restart and orphan cleanup.
- [ ] Audit authenticated cloud uploads and ownership boundaries.
- [ ] Run full check/Expo dependency validation and Android device tests.
- [ ] Update `MIGRATION_CHECKLIST.md` after user verification.

**Do not merge this draft PR as a complete attachment feature.** It is the initial audited foundation, not the full migration.
