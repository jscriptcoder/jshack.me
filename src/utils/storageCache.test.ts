import { describe, it, expect, beforeEach } from 'vitest';
import {
  initializeStorage,
  getCachedSessionState,
  getCachedWifiState,
  getCachedFilesystemPatches,
  getCachedMissionSeed,
  getDatabase,
  resetCache,
} from './storageCache';
import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';
import {
  openDatabase,
  saveFilesystemPatches,
  saveMissionSeed,
  saveSessionToTab,
  saveWifiState,
} from './storage';

const validSession: PersistedState = {
  session: {
    username: 'root',
    userType: 'root',
    machine: '192.168.1.50',
    currentPath: '/root',
    theme: 'amber',
  },
  sessionStack: [
    {
      username: 'jshacker',
      userType: 'user',
      machine: 'localhost',
      currentPath: '/home/jshacker',
      theme: 'amber',
    },
  ],
  ftpSession: null,
  ncSession: null,
};

const validPatches: readonly FileSystemPatch[] = [
  {
    machineId: 'localhost',
    path: '/tmp/output.txt',
    content: 'captured output',
    owner: 'user',
  },
];

const deleteDatabase = (): Promise<void> =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('jshack-db');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

describe('storageCache', () => {
  beforeEach(async () => {
    resetCache();
    await deleteDatabase();
    sessionStorage.clear();
  });

  describe('initializeStorage', () => {
    it('should return null session when no persisted data exists', async () => {
      await initializeStorage();
      expect(getCachedSessionState()).toBeNull();
    });

    it('should return empty patches when no persisted data exists', async () => {
      await initializeStorage();
      expect(getCachedFilesystemPatches()).toEqual([]);
    });

    it('should provide database instance after initialization', async () => {
      await initializeStorage();
      expect(getDatabase()).not.toBeNull();
    });

    it('should load session from sessionStorage', async () => {
      saveSessionToTab(validSession);

      await initializeStorage();
      expect(getCachedSessionState()).toEqual(validSession);
    });

    it('should load patches from IndexedDB', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      db.close();

      await initializeStorage();
      expect(getCachedFilesystemPatches()).toEqual(validPatches);
    });

    it('should return null mission seed when no seed exists', async () => {
      await initializeStorage();
      expect(getCachedMissionSeed()).toBeNull();
    });

    it('should load mission seed from IndexedDB', async () => {
      const db = await openDatabase();
      await saveMissionSeed(db, 'MEDTECH-4A7F-easy');
      db.close();

      await initializeStorage();
      expect(getCachedMissionSeed()).toBe('MEDTECH-4A7F-easy');
    });
  });

  describe('WiFi state (shared via IndexedDB)', () => {
    it('should default WiFi to false when no state exists', async () => {
      await initializeStorage();
      expect(getCachedWifiState()).toBe(false);
    });

    it('should load WiFi state from IndexedDB', async () => {
      const db = await openDatabase();
      await saveWifiState(db, true);
      db.close();

      await initializeStorage();
      expect(getCachedWifiState()).toBe(true);
    });

    it('should load WiFi=false from IndexedDB', async () => {
      const db = await openDatabase();
      await saveWifiState(db, false);
      db.close();

      await initializeStorage();
      expect(getCachedWifiState()).toBe(false);
    });
  });

  describe('resetCache', () => {
    it('should clear all cached values', async () => {
      saveSessionToTab(validSession);
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      await saveWifiState(db, true);
      db.close();

      await initializeStorage();
      expect(getCachedSessionState()).not.toBeNull();

      resetCache();
      expect(getCachedSessionState()).toBeNull();
      expect(getCachedWifiState()).toBe(false);
      expect(getCachedFilesystemPatches()).toEqual([]);
      expect(getCachedMissionSeed()).toBeNull();
      expect(getDatabase()).toBeNull();
    });
  });
});
