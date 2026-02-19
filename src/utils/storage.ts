import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';
import { isValidPersistedState } from '../session/SessionContext';
import { isValidPatch } from '../filesystem/FileSystemContext';

const DB_NAME = 'jshack-db';
const DB_VERSION = 1;
const SESSION_STORE = 'session';
const FILESYSTEM_STORE = 'filesystem';
const SESSION_KEY = 'state';
const FILESYSTEM_KEY = 'patches';
const MISSION_KEY = 'activeMissionSeed';

export const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE);
      }
      if (!db.objectStoreNames.contains(FILESYSTEM_STORE)) {
        db.createObjectStore(FILESYSTEM_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getValue = <T>(db: IDBDatabase, storeName: string, key: string): Promise<T | null> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve((request.result ?? null) as T | null);
    request.onerror = () => reject(request.error);
  });

const setValue = <T>(db: IDBDatabase, storeName: string, key: string, value: T): Promise<void> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

export const loadSessionState = async (db: IDBDatabase): Promise<PersistedState | null> => {
  try {
    const data = await getValue<unknown>(db, SESSION_STORE, SESSION_KEY);
    if (!data || !isValidPersistedState(data)) return null;
    return data;
  } catch {
    return null;
  }
};

export const saveSessionState = async (db: IDBDatabase, state: PersistedState): Promise<void> => {
  try {
    await setValue(db, SESSION_STORE, SESSION_KEY, state);
  } catch {
    // Write failures are non-critical — the app still works in-memory, the user
    // just loses persistence on refresh. Logging would clutter the console in
    // environments where IndexedDB is restricted (e.g. some privacy modes).
  }
};

export const loadFilesystemPatches = async (
  db: IDBDatabase,
): Promise<readonly FileSystemPatch[] | null> => {
  try {
    const data = await getValue<unknown>(db, FILESYSTEM_STORE, FILESYSTEM_KEY);
    if (!data) return null;
    if (!Array.isArray(data) || !data.every(isValidPatch)) return null;
    return data as readonly FileSystemPatch[];
  } catch {
    return null;
  }
};

export const saveFilesystemPatches = async (
  db: IDBDatabase,
  patches: readonly FileSystemPatch[],
): Promise<void> => {
  try {
    await setValue(db, FILESYSTEM_STORE, FILESYSTEM_KEY, [...patches]);
  } catch {
    // Non-critical — see saveSessionState comment above
  }
};

const clearStore = (db: IDBDatabase, storeName: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

export const loadMissionSeed = async (db: IDBDatabase): Promise<string | null> => {
  try {
    const data = await getValue<unknown>(db, SESSION_STORE, MISSION_KEY);
    if (typeof data === 'string') return data;
    return null;
  } catch {
    return null;
  }
};

export const saveMissionSeed = async (db: IDBDatabase, seed: string | null): Promise<void> => {
  try {
    if (seed === null) {
      const transaction = db.transaction(SESSION_STORE, 'readwrite');
      const store = transaction.objectStore(SESSION_STORE);
      store.delete(MISSION_KEY);
    } else {
      await setValue(db, SESSION_STORE, MISSION_KEY, seed);
    }
  } catch {
    // Non-critical — see saveSessionState comment above
  }
};

export const clearAllData = async (db: IDBDatabase): Promise<void> => {
  await clearStore(db, SESSION_STORE);
  await clearStore(db, FILESYSTEM_STORE);
};
