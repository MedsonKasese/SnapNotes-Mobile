import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';
import { getMobileAuth } from './firebase/firebaseAuth';
import { createCloudLibraryPreviewService } from './cloudLibraryPreview';

const cloudLibraryPreviewService = createCloudLibraryPreviewService({
  async getUserDocument(uid) {
    // Reuse the Firebase app that owns Mobile Auth; this module has no eager reads.
    const auth = getMobileAuth();
    if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed before preview loading.');
    const snapshot = await getDoc(doc(getFirestore(auth.app), 'users', uid));
    if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed during preview loading.');
    return snapshot;
  },
  async getLibraryPages(uid, revision) {
    const auth = getMobileAuth();
    if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed before preview loading.');
    const snapshot = await getDocs(collection(getFirestore(auth.app), 'users', uid, 'libraries', revision, 'pages'));
    if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed during preview loading.');
    return snapshot;
  },
});

export { cloudLibraryPreviewService };
