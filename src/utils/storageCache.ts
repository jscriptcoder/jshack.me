import type { FileSystemPatch } from '../filesystem/types';
import {
  openDatabase,
  loadFilesystemPatches,
  loadMissionSeed,
  loadWifiState,
  loadBrickedMachines,
} from './storage';
import { loadSessionFromTab } from './storage';
import type { PersistedState } from '../session/SessionContext';
import { THEMES, DEFAULT_THEME_ID, isValidThemeId } from '../theme/themes';
import { applyTheme } from '../theme/applyTheme';

type StorageCache = {
  readonly sessionState: PersistedState | null;
  readonly wifiConnected: boolean;
  readonly brickedMachines: readonly string[];
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
  wifiConnected: false,
  brickedMachines: [],
  filesystemPatches: [],
  missionSeed: null,
  db: null,
};

export const initializeStorage = async (): Promise<void> => {
  // xterm() opens a new tab with ?fresh to prevent Chromium's sessionStorage
  // cloning. Clear the inherited session so this tab starts at localhost.
  const params = new URLSearchParams(window.location.search);
  if (params.has('fresh')) {
    sessionStorage.clear();
    window.history.replaceState(null, '', window.location.pathname);
  }

  // Session state is per-tab (sessionStorage) — load synchronously
  const sessionState = loadSessionFromTab();

  try {
    const db = await openDatabase();

    const filesystemPatches = await loadFilesystemPatches(db);
    const missionSeed = await loadMissionSeed(db);

    // WiFi and bricked state are shared across tabs (IndexedDB)
    const wifiFromDb = await loadWifiState(db);
    const brickedFromDb = await loadBrickedMachines(db);

    cache = {
      sessionState,
      wifiConnected: wifiFromDb ?? false,
      brickedMachines: brickedFromDb ?? [],
      filesystemPatches: filesystemPatches ?? [],
      missionSeed,
      db,
    };

    const themeId = sessionState?.session?.theme;
    applyTheme(THEMES[isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID]);
  } catch {
    // IndexedDB unavailable — session from sessionStorage still works
    cache = {
      sessionState,
      wifiConnected: false,
      brickedMachines: [],
      filesystemPatches: [],
      missionSeed: null,
      db: null,
    };

    const themeId = sessionState?.session?.theme;
    applyTheme(THEMES[isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID]);
  }
};

export const getCachedSessionState = (): PersistedState | null => cache.sessionState;

export const getCachedWifiState = (): boolean => cache.wifiConnected;

export const getCachedBrickedMachines = (): readonly string[] => cache.brickedMachines;

export const getCachedFilesystemPatches = (): readonly FileSystemPatch[] => cache.filesystemPatches;

export const getCachedMissionSeed = (): string | null => cache.missionSeed;

export const getDatabase = (): IDBDatabase | null => cache.db;

// Exposed for testing only
export const resetCache = (): void => {
  if (cache.db) {
    cache.db.close();
  }
  cache = {
    sessionState: null,
    wifiConnected: false,
    brickedMachines: [],
    filesystemPatches: [],
    missionSeed: null,
    db: null,
  };
};
