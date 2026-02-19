import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';
import { isValidPersistedState } from '../session/SessionContext';
import { isValidPatch } from '../filesystem/FileSystemContext';
import {
  openDatabase,
  loadSessionState,
  saveSessionState,
  loadFilesystemPatches,
  saveFilesystemPatches,
  loadMissionSeed,
} from './storage';
import { THEMES, DEFAULT_THEME_ID, isValidThemeId } from '../theme/themes';
import { applyTheme } from '../theme/applyTheme';

const LS_SESSION_KEY = 'jshack-session';
const LS_FILESYSTEM_KEY = 'jshack-filesystem';

type StorageCache = {
  readonly sessionState: PersistedState | null;
  readonly filesystemPatches: readonly FileSystemPatch[];
  readonly missionSeed: string | null;
  readonly db: IDBDatabase | null;
};

// Module-level cache — bridges async IndexedDB with sync React useState initializers.
// initializeStorage() populates this once in main.tsx BEFORE React mounts, so
// getCachedSessionState() and getCachedFilesystemPatches() can be called synchronously
// inside useState(() => ...) initializer functions. After that, it's read-only.
let cache: StorageCache = {
  sessionState: null,
  filesystemPatches: [],
  missionSeed: null,
  db: null,
};

const loadSessionFromLocalStorage = (): PersistedState | null => {
  try {
    const stored = localStorage.getItem(LS_SESSION_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isValidPersistedState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const loadPatchesFromLocalStorage = (): readonly FileSystemPatch[] => {
  try {
    const stored = localStorage.getItem(LS_FILESYSTEM_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every(isValidPatch)) return [];
    return parsed as readonly FileSystemPatch[];
  } catch {
    return [];
  }
};

export const initializeStorage = async (): Promise<void> => {
  try {
    const db = await openDatabase();

    let sessionState = await loadSessionState(db);
    let filesystemPatches = await loadFilesystemPatches(db);

    // One-time migration: v0 stored state in localStorage, v1 uses IndexedDB.
    // If IndexedDB is empty but localStorage has data, migrate it over and clean up.
    // This code can be removed once all users have migrated (no expiry date set).
    if (!sessionState) {
      const fromLS = loadSessionFromLocalStorage();
      if (fromLS) {
        await saveSessionState(db, fromLS);
        sessionState = fromLS;
        localStorage.removeItem(LS_SESSION_KEY);
      }
    }

    if (!filesystemPatches) {
      const fromLS = loadPatchesFromLocalStorage();
      if (fromLS.length > 0) {
        await saveFilesystemPatches(db, fromLS);
        filesystemPatches = fromLS;
        localStorage.removeItem(LS_FILESYSTEM_KEY);
      }
    }

    const missionSeed = await loadMissionSeed(db);

    cache = {
      sessionState,
      filesystemPatches: filesystemPatches ?? [],
      missionSeed,
      db,
    };

    const themeId = sessionState?.session?.theme;
    applyTheme(THEMES[isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID]);
  } catch {
    // IndexedDB unavailable — fall back to localStorage for initial load
    const fallbackSession = loadSessionFromLocalStorage();
    cache = {
      sessionState: fallbackSession,
      filesystemPatches: loadPatchesFromLocalStorage(),
      missionSeed: null,
      db: null,
    };

    const themeId = fallbackSession?.session?.theme;
    applyTheme(THEMES[isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID]);
  }
};

export const getCachedSessionState = (): PersistedState | null => cache.sessionState;

export const getCachedFilesystemPatches = (): readonly FileSystemPatch[] => cache.filesystemPatches;

export const getCachedMissionSeed = (): string | null => cache.missionSeed;

export const getDatabase = (): IDBDatabase | null => cache.db;

// Exposed for testing only
export const resetCache = (): void => {
  if (cache.db) {
    cache.db.close();
  }
  cache = { sessionState: null, filesystemPatches: [], missionSeed: null, db: null };
};
