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
- The initial foundation added pure MIME/count/size rules without changing the persisted note schema. The current branch also supports local-only picker selection and add/list/remove controls for saved ordinary notes, with a versioned metadata manifest and app-private file storage; read-only note-card summaries show each local attachment's name, type, and size. Attachments are not synced or uploaded.
- The copy-first transaction verifies stored byte size before committing metadata and rolls back on commit failure. Orphan cleanup/retry, permanent-note-deletion coordination, missing-file and permission handling, and Android device verification remain open work.
- For **Private Notes**, plaintext file paths, cached previews, sharing, exports, and recent-app snapshots are sensitive. Notes with local attachments are currently blocked from **Move to Private**; encrypted attachment storage and lock-time cleanup are required before private attachments can be supported.
- Avoid placing file bytes in AsyncStorage or storing transient picker URIs as permanent references.

## Delivery gates
- [x] Inspect PWA types/limits/sign-in rules and viewer architecture.
- [x] Add pure MIME/count/size rules and automated unit tests.
- [x] Add Android picker selection, durable app-private copies, manifest persistence, and transactional copy/verification coverage.
- [x] Add editor add/list/remove controls for saved ordinary notes.
- [ ] Add rename; note-card attachment summaries are implemented, but image/PDF/text previews are not.
- [ ] In-app image, PDF and text previews, safe fallback for unsupported files.
- [ ] Handle offline, permission denial, missing files, restart and orphan cleanup.
- [ ] Audit authenticated cloud uploads and ownership boundaries.
- [ ] Run full check/Expo dependency validation and Android device tests.
- [ ] Update `MIGRATION_CHECKLIST.md` after user verification.

**Do not merge this draft PR as a complete attachment feature.** It is the initial audited foundation, not the full migration.
