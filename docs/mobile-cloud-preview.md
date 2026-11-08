# Mobile read-only PWA cloud preview

The Account screen offers a clearly labeled, explicit preview action to verified signed-in users. Opening the modal, restoring an auth session, signing in, and reconnecting do not fetch the cloud library. The preview only reads the account document and, when applicable, the active revision's page collection. It does not sync, write, import, merge, decrypt, or modify device notes, drafts, folders, Private Notes, attachments, or deletion markers. A failed or incomplete read is shown as an error, never as an empty library.

The PWA's current full library snapshot can include encrypted Private Notes records. Mobile excludes a note before projection whenever `isPrivate` is truthy or the record has its own `privateData` property. It never displays or decrypts that private payload. Mobile-supported note fields are projected; unsupported PWA field names are listed for awareness. Attachment fields are reported by name only; attachment paths, URLs, and files are not read.

This is a preview only: it does not synchronize in either direction and never writes back to Firestore. Console verification of the read-only behavior and data rules remains outstanding; all automated preview tests use mocked read functions and make no production Firebase connections.
