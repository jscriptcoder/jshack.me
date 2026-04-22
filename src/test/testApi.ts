import type { GameState } from '../game/types';
import type { WifiConnection } from '../network/wifiTypes';
import type { FileSystemPatch } from '../filesystem/types';
import { loadFilesystemPatches, saveGameState, saveWifiState } from '../utils/storage';
import { getDatabase } from '../utils/storageCache';

export type TestApi = {
  readonly setGameState: (state: GameState) => Promise<void>;
  readonly setWifiConnected: (wifi: WifiConnection | null) => Promise<void>;
  readonly readFilesystemPatch: (machineId: string, path: string) => Promise<string | null>;
};

declare global {
  interface Window {
    __jshackTest?: TestApi;
  }
}

// Installs a narrow seam that e2e specs use to seed game state and inspect
// filesystem patches without reaching into the storage layer directly. Behind
// `import.meta.env.DEV` at the call site, so production bundles never see it.
// When storage migrates (e.g. to Supabase for multiplayer), only the bodies
// below change — the shape e2e helpers depend on stays stable.
export const installTestApi = (): void => {
  const requireDb = (): IDBDatabase => {
    const db = getDatabase();
    if (!db) throw new Error('testApi: storage not initialized');
    return db;
  };

  const api: TestApi = {
    setGameState: async (state) => {
      await saveGameState(requireDb(), state);
    },
    setWifiConnected: async (wifi) => {
      await saveWifiState(requireDb(), wifi);
    },
    readFilesystemPatch: async (machineId, path) => {
      const patches = (await loadFilesystemPatches(requireDb())) ?? [];
      const match = patches.find(
        (p: FileSystemPatch) => p.machineId === machineId && p.path === path,
      );
      return match?.content ?? null;
    },
  };

  window.__jshackTest = api;
};
