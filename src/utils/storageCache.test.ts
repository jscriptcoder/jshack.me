import { describe, it, expect, beforeEach } from 'vitest';
import {
  initializeStorage,
  getCachedSessionState,
  getCachedFilesystemPatches,
  getCachedMissionSeed,
  getDatabase,
  resetCache,
} from './storageCache';
import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';
import { openDatabase, saveSessionState, saveFilesystemPatches, saveMissionSeed } from './storage';

const validSession: PersistedState = {
  session: {
    username: 'root',
    userType: 'root',
    machine: '192.168.1.50',
    currentPath: '/root',
    wifiConnected: false,
    theme: 'amber',
  },
  sessionStack: [
    {
      username: 'jshacker',
      userType: 'user',
      machine: 'localhost',
      currentPath: '/home/jshacker',
      wifiConnected: false,
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
    localStorage.clear();
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

    it('should load session from IndexedDB', async () => {
      const db = await openDatabase();
      await saveSessionState(db, validSession);
      db.close();

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

  describe('migration from localStorage', () => {
    it('should migrate session from localStorage when IndexedDB is empty', async () => {
      localStorage.setItem('jshack-session', JSON.stringify(validSession));

      await initializeStorage();

      expect(getCachedSessionState()).toEqual(validSession);
    });

    it('should migrate patches from localStorage when IndexedDB is empty', async () => {
      localStorage.setItem('jshack-filesystem', JSON.stringify(validPatches));

      await initializeStorage();

      expect(getCachedFilesystemPatches()).toEqual(validPatches);
    });

    it('should remove localStorage keys after successful migration', async () => {
      localStorage.setItem('jshack-session', JSON.stringify(validSession));
      localStorage.setItem('jshack-filesystem', JSON.stringify(validPatches));

      await initializeStorage();

      expect(localStorage.getItem('jshack-session')).toBeNull();
      expect(localStorage.getItem('jshack-filesystem')).toBeNull();
    });

    it('should not migrate when IndexedDB already has session data', async () => {
      const db = await openDatabase();
      await saveSessionState(db, validSession);
      db.close();

      const differentSession: PersistedState = {
        ...validSession,
        session: { ...validSession.session, username: 'guest', userType: 'guest' },
      };
      localStorage.setItem('jshack-session', JSON.stringify(differentSession));

      await initializeStorage();

      expect(getCachedSessionState()?.session.username).toBe('root');
    });

    it('should not migrate when IndexedDB already has patches', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      db.close();

      const differentPatches: readonly FileSystemPatch[] = [
        { machineId: '192.168.1.1', path: '/tmp/other.txt', content: 'other', owner: 'root' },
      ];
      localStorage.setItem('jshack-filesystem', JSON.stringify(differentPatches));

      await initializeStorage();

      expect(getCachedFilesystemPatches()).toEqual(validPatches);
    });

    it('should skip migration for invalid localStorage session data', async () => {
      localStorage.setItem('jshack-session', 'not valid json!!!');

      await initializeStorage();

      expect(getCachedSessionState()).toBeNull();
    });

    it('should skip migration for invalid localStorage patch data', async () => {
      localStorage.setItem('jshack-filesystem', JSON.stringify([{ bad: true }]));

      await initializeStorage();

      expect(getCachedFilesystemPatches()).toEqual([]);
    });

    it('should not remove localStorage key when there is nothing to migrate', async () => {
      localStorage.setItem('jshack-filesystem', JSON.stringify([]));

      await initializeStorage();

      expect(localStorage.getItem('jshack-filesystem')).toBe('[]');
    });
  });

  describe('resetCache', () => {
    it('should clear all cached values', async () => {
      const db = await openDatabase();
      await saveSessionState(db, validSession);
      await saveFilesystemPatches(db, validPatches);
      db.close();

      await initializeStorage();
      expect(getCachedSessionState()).not.toBeNull();

      resetCache();
      expect(getCachedSessionState()).toBeNull();
      expect(getCachedFilesystemPatches()).toEqual([]);
      expect(getCachedMissionSeed()).toBeNull();
      expect(getDatabase()).toBeNull();
    });
  });
});
