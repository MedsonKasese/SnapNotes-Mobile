import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNotesStorage } from './notesStorage';

export const deviceNotesStorage = createNotesStorage(AsyncStorage);
