# Cross-platform cloud writes: safety design

**Status: proposal only.** This document defines a future data contract and safety gates; it does not enable cloud writes or change either app’s behavior. Mobile’s PWA cloud preview remains read-only, and the PWA’s full-snapshot writer remains unchanged until a separate preservation path has been implemented and verified.

## The safety problem to solve first

[Mobile PR #50](https://github.com/MedsonKasese/SnapNotes-Mobile/pull/50) added a read-only preview, not a migration or sync path. It fetches the PWA user document and active library pages using Firestore reads only. It then excludes notes marked `isPrivate` or carrying `privateData` before enumerating note fields, and returns only fields Mobile currently supports. Other field names—including `attachments`—may be reported as unsupported, but their values are not projected. The code and tests are at [`cloudLibraryPreview.ts`](https://github.com/MedsonKasese/SnapNotes-Mobile/blob/058c4a7393a7c5b2b4925658acc7375f7cc61727/src/cloudLibraryPreview.ts#L50-L155) and [`cloudLibraryPreview.test.mjs`](https://github.com/MedsonKasese/SnapNotes-Mobile/blob/058c4a7393a7c5b2b4925658acc7375f7cc61727/tests/cloudLibraryPreview.test.mjs#L106-L176).

That filter protects the preview model, but **is not a storage or network boundary**: private and ordinary notes currently occupy the same Firestore page documents, which Mobile fetches before filtering. A new Mobile writer must not take the preview’s narrowed records and publish them as a replacement snapshot. The projection deliberately omits PWA-only fields and attachment values, so doing so could erase data.

There is also a legacy compatibility case to test: PWA import normalization can write ordinary records with `isPrivate: false` and `privateData: null` ([import normalization](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/app.js#L984-L1017)). Mobile currently excludes any record with its own `privateData` property, so those ordinary imports can be omitted from the preview too. Do not loosen that privacy filter as a quick fix; add explicit versioned classification and regression coverage first.

[PWA PR #74](https://github.com/MedsonKasese/SnapNotes/pull/74) hardened auth transitions and explicitly kept the existing full-snapshot writer, including encrypted Private Notes, unchanged. The writer packs the complete in-memory note and folder arrays into pages under `users/{uid}/libraries/{revision}/pages/{pageId}`, then switches the active revision. It does not filter out Private Notes or unknown note fields; inactive revisions are cleaned up afterward. See the [writer](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/firestore.js#L208-L358) and [page packer](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/note-sync.js#L198-L223). Filtering private records out of a future whole-library replacement without first preserving them elsewhere would therefore risk loss.

## Proposed shared note format: version 1

Use an explicit envelope around the complete source-compatible note record:

```json
{
  "format": "snapnotes.note",
  "schemaVersion": 1,
  "id": "note-id",
  "visibility": "ordinary",
  "record": {
    "id": "note-id",
    "title": "Example",
    "text": "…",
    "attachments": []
  }
}
```

For a Private Note, `visibility` is `private` and `record` retains the PWA’s complete encrypted record, including its neutralized top-level fields, `isPrivate`, and encrypted `privateData`. The envelope’s `schemaVersion` is separate from the PWA’s private-crypto `privateData.version` and any note edit-history `versions` array. Validate that the envelope `id` matches `record.id`.

The `record` is intentionally open-ended. It must retain the full original JSON object, including fields Mobile does not understand, rather than rebuild it from a whitelist. Examples already present in the PWA include tags, time labels, edit history, sync-conflict metadata, reminder fields, attachments, and Private Notes metadata. On an edit, a future writer should patch only fields it intentionally supports onto the preserved record; unknown fields must survive unchanged. A legacy PWA note without an envelope is treated as version 0 for reading and in-memory conversion only. Do not write it as version 1 until it has validated and all fields have been retained. Reject an unknown future schema version instead of silently normalizing or dropping it.

The PWA encrypts a Private Note payload with AES-GCM and stores its crypto parameters and ciphertext in `privateData`; the encrypted payload includes content, reminders, history, and attachment metadata ([private payload format](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/private-note-utils.js#L1-L18), [encryption/decryption](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/private-notes.js#L127-L169)). A serializer must preserve that envelope opaquely; Mobile must not decrypt, log, or copy it into an ordinary note.

### Attachment compatibility

Keep the PWA’s attachment descriptors inside the preserved `record.attachments` array. The PWA stores metadata and references there; file bytes live separately in IndexedDB and/or the private Supabase bucket, not in Firestore note pages. Current descriptors can include `id`, name, MIME type, size, creation time, `storageProvider`, `storagePath`, upload state, and private-encryption metadata. The PWA creates descriptors locally before upload and later records a provider/path reference ([attachment lifecycle](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/attachments.js#L397-L433), [new attachment records](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/js/attachments.js#L583-L611)). Its storage documentation says signed download URLs expire and durable metadata uses an object path ([Supabase storage](https://github.com/MedsonKasese/SnapNotes/blob/b1b695b594ee9bc2d930002cee73febbf56441c3/docs/SUPABASE_STORAGE.md#L17-L25)).

Until a separate attachment bridge is designed and tested, Mobile should preserve these descriptors as opaque source data and must not rewrite them from its local attachment manifest. Mobile’s `fileKey` identifies an app-private local file; it is not a PWA Supabase object path. Do not put file bytes or newly signed URLs in Firestore. Existing legacy descriptor values must not be discarded merely because Mobile cannot display or interpret them.

## Preserve Private Notes outside the ordinary library

Before changing the PWA’s writer, introduce and verify a PWA-owned preservation path. The target layout is:

```text
users/{uid}/libraries/{revision}/pages/{pageId}             # ordinary notes + folders
users/{uid}/privateLibraries/{revision}/pages/{pageId}      # encrypted Private Note envelopes only
users/{uid}                                                  # both active revision pointers + format metadata
```

This is a proposed shape, not an implemented schema. The normal library preview and ordinary sync read only the ordinary path. Private Notes code alone reads and writes the private path. For version 1, `visibility` is explicit and must agree with the record’s privacy markers. During legacy migration, classify `isPrivate: true` or a non-null `privateData` object as private; classify `isPrivate: false` plus `privateData: null` as ordinary only after tests confirm it is the PWA importer’s ordinary-record shape. Contradictory, malformed, or otherwise ambiguous legacy records block publication and leave the original revision intact. Do not treat key presence alone as proof of a valid private payload or as grounds to discard a record. Private content stays encrypted; the split does not authorize any new plaintext export.

Separate collection paths ensure the ordinary preview does not query private pages; they are not, by themselves, a server authorization boundary. Firebase rules govern access for the signed-in UID, so any stronger read restriction must be designed and reviewed separately rather than inferred from collection names.

Migration from today’s mixed pages must be a PWA operation: read one verified active source revision, partition the complete source records, write and validate both new page sets, compare ordinary/private record counts and stable record fingerprints, then atomically switch both pointers in one transaction. Keep the original mixed revision as a rollback copy until a restore from that copy and a PWA read/attachment check have passed. Cleanup must not remove that copy early. Do not mutate or backfill production data as part of this documentation PR.

A client-side version check alone cannot stop an older PWA build from publishing a legacy mixed snapshot after the split. Before rollout, coordinate a writer-format guard with the PWA release and a separately reviewed Firestore-rules change (or another server-enforced compatibility mechanism) so obsolete writers cannot reactivate the old format. This PR does not alter PWA code, deployed rules, or any rules file.

## Gates before any Mobile cloud write

1. **Legacy and round-trip tests:** Cover legacy root snapshots and paged revisions. Round-trip ordinary notes with PWA-only fields and attachment descriptors, proving unknown fields and nested values are retained. Unsupported or malformed schema versions must fail closed.
2. **Private preservation tests:** Cover locked and unlocked Private Notes, legacy metadata migration, encrypted payloads and encrypted attachments. Prove the split preserves each private record and its ciphertext exactly while ordinary results contain none. Test malformed flags/payloads and ensure failure never reclassifies private data as ordinary.
3. **Atomic migration and rollback:** Simulate interruption while writing either partition, pointer-transaction conflicts, retries, stale client versions, and restoration from the retained mixed revision. A failure must leave the prior active pointers and recoverable data intact.
4. **PWA behavior checks:** On a test account, confirm normal sync, Private Notes unlock/edit/lock, attachment open/upload/cleanup, sign-out/account switching, and restore continue to work after the PWA writer change. Use record counts/fingerprints without logging private plaintext.
5. **Mobile read-only check:** Until all preservation tests pass, Mobile remains read-only. Verify preview only queries the ordinary collection after the split, excludes private records, still reports unsupported fields without projecting their values, and never writes notes, folders, deletion markers, or attachment metadata.
6. **Separate write PR:** Only after the PWA preservation path is tested should a later, separate PR propose Mobile writes. That PR must define identity, supported-field patching, conflict/deletion semantics, version negotiation, attachment ownership, failure recovery, and its own security review. Passing this design’s tests does not itself authorize enabling writes.

## Scope of this PR

Documentation only: no PWA changes, Firestore-rule changes, runtime behavior, cloud writes, attachment uploads, data migration, or merge. The Mobile preview stays read-only. The verified starting point is Mobile `main` at [`058c4a7`](https://github.com/MedsonKasese/SnapNotes-Mobile/tree/058c4a7393a7c5b2b4925658acc7375f7cc61727); PWA references use `main` at [`b1b695b`](https://github.com/MedsonKasese/SnapNotes/tree/b1b695b594ee9bc2d930002cee73febbf56441c3), after Mobile PR #50 and PWA PR #74 were confirmed merged.
