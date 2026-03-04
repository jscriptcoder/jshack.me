import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';
import { isValidPersistedState } from '../session/SessionContext';
import { isValidPatch } from '../filesystem/fileSystemUtils';

const DB_NAME = 'jshack-db';
const DB_VERSION = 1;
const SESSION_STORE = 'session';
const FILESYSTEM_STORE = 'filesystem';
const FILESYSTEM_KEY = 'patches';
const MISSION_KEY = 'activeMissionSeed';
const WIFI_KEY = 'wifiConnected';
const TAB_SESSION_KEY = 'jshack-tab-session';

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
  clearSessionFromTab();
};

// --- sessionStorage helpers (per-tab session state) ---

export const saveSessionToTab = (state: PersistedState): void => {
  try {
    sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Non-critical — tab just won't survive a refresh
  }
};

export const loadSessionFromTab = (): PersistedState | null => {
  try {
    const stored = sessionStorage.getItem(TAB_SESSION_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isValidPersistedState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const clearSessionFromTab = (): void => {
  try {
    sessionStorage.removeItem(TAB_SESSION_KEY);
  } catch {
    // Non-critical
  }
};

// --- WiFi state in IndexedDB (shared across tabs) ---

export const saveWifiState = async (db: IDBDatabase, connected: boolean): Promise<void> => {
  try {
    await setValue(db, SESSION_STORE, WIFI_KEY, connected);
  } catch {
    // Non-critical — WiFi state still works in-memory
  }
};

export const loadWifiState = async (db: IDBDatabase): Promise<boolean | null> => {
  try {
    const data = await getValue<unknown>(db, SESSION_STORE, WIFI_KEY);
    if (typeof data === 'boolean') return data;
    return null;
  } catch {
    return null;
  }
};
