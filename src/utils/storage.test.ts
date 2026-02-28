import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDatabase,
  loadFilesystemPatches,
  saveFilesystemPatches,
  loadMissionSeed,
  saveMissionSeed,
  saveSessionToTab,
  loadSessionFromTab,
  clearSessionFromTab,
  saveWifiState,
  loadWifiState,
  clearAllData,
} from './storage';
import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';

const validSession: PersistedState = {
  session: {
    username: 'jshacker',
    userType: 'user',
    machine: 'localhost',
    currentPath: '/home/jshacker',
    theme: 'amber',
  },
  sessionStack: [],
  ftpSession: null,
  ncSession: null,
};

const validPatches: readonly FileSystemPatch[] = [
  {
    machineId: 'localhost',
    path: '/tmp/test.txt',
    content: 'hello world',
    owner: 'user',
  },
  {
    machineId: '192.168.1.50',
    path: '/home/ftpuser/data.bin',
    content: 'binary data',
    owner: 'root',
  },
];

describe('storage', () => {
  beforeEach(() => {
    indexedDB.deleteDatabase('jshack-db');
    sessionStorage.clear();
  });

  describe('openDatabase', () => {
    it('should create database with session and filesystem stores', async () => {
      const db = await openDatabase();
      expect(db.objectStoreNames.contains('session')).toBe(true);
      expect(db.objectStoreNames.contains('filesystem')).toBe(true);
      db.close();
    });

    it('should return same database on subsequent opens', async () => {
      const db1 = await openDatabase();
      db1.close();
      const db2 = await openDatabase();
      expect(db2.name).toBe('jshack-db');
      expect(db2.version).toBe(1);
      db2.close();
    });
  });

  describe('sessionStorage (per-tab session)', () => {
    it('should return null when no session exists', () => {
      expect(loadSessionFromTab()).toBeNull();
    });

    it('should save and load session state', () => {
      saveSessionToTab(validSession);
      expect(loadSessionFromTab()).toEqual(validSession);
    });

    it('should persist session with SSH stack', () => {
      const withStack: PersistedState = {
        ...validSession,
        sessionStack: [
          {
            username: 'admin',
            userType: 'user',
            machine: '192.168.1.1',
            currentPath: '/home/admin',
            theme: 'amber',
          },
        ],
      };
      saveSessionToTab(withStack);
      expect(loadSessionFromTab()?.sessionStack).toHaveLength(1);
      expect(loadSessionFromTab()?.sessionStack[0].username).toBe('admin');
    });

    it('should persist session with FTP session', () => {
      const withFtp: PersistedState = {
        ...validSession,
        ftpSession: {
          remoteMachine: '192.168.1.50',
          remoteUsername: 'ftpuser',
          remoteUserType: 'user',
          remoteCwd: '/srv/ftp',
          originMachine: 'localhost',
          originUsername: 'jshacker',
          originUserType: 'user',
          originCwd: '/home/jshacker',
        },
      };
      saveSessionToTab(withFtp);
      expect(loadSessionFromTab()?.ftpSession?.remoteMachine).toBe('192.168.1.50');
    });

    it('should return null for invalid stored data', () => {
      sessionStorage.setItem('jshack-tab-session', '{ "invalid": true }');
      expect(loadSessionFromTab()).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      sessionStorage.setItem('jshack-tab-session', 'not valid json!!!');
      expect(loadSessionFromTab()).toBeNull();
    });

    it('should overwrite previous session on save', () => {
      saveSessionToTab(validSession);
      const updated: PersistedState = {
        ...validSession,
        session: { ...validSession.session, username: 'root', userType: 'root' },
      };
      saveSessionToTab(updated);
      expect(loadSessionFromTab()?.session.username).toBe('root');
    });

    it('should clear session from tab', () => {
      saveSessionToTab(validSession);
      clearSessionFromTab();
      expect(loadSessionFromTab()).toBeNull();
    });
  });

  describe('WiFi state (IndexedDB shared)', () => {
    it('should return null when no WiFi state exists', async () => {
      const db = await openDatabase();
      const result = await loadWifiState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should save and load WiFi connected state', async () => {
      const db = await openDatabase();
      await saveWifiState(db, true);
      const result = await loadWifiState(db);
      expect(result).toBe(true);
      db.close();
    });

    it('should save and load WiFi disconnected state', async () => {
      const db = await openDatabase();
      await saveWifiState(db, false);
      const result = await loadWifiState(db);
      expect(result).toBe(false);
      db.close();
    });

    it('should overwrite previous WiFi state', async () => {
      const db = await openDatabase();
      await saveWifiState(db, true);
      await saveWifiState(db, false);
      const result = await loadWifiState(db);
      expect(result).toBe(false);
      db.close();
    });

    it('should return null for non-boolean stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put('not-a-boolean', 'wifiConnected');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadWifiState(db);
      expect(result).toBeNull();
      db.close();
    });
  });

  describe('filesystem patches', () => {
    it('should return null when no patches exist', async () => {
      const db = await openDatabase();
      const result = await loadFilesystemPatches(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should save and load patches', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      const result = await loadFilesystemPatches(db);
      expect(result).toEqual(validPatches);
      db.close();
    });

    it('should save empty patches array', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, []);
      const result = await loadFilesystemPatches(db);
      expect(result).toEqual([]);
      db.close();
    });

    it('should return null for invalid stored patches', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('filesystem', 'readwrite');
      const store = transaction.objectStore('filesystem');
      store.put([{ invalid: true }], 'patches');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadFilesystemPatches(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should return null for non-array stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('filesystem', 'readwrite');
      const store = transaction.objectStore('filesystem');
      store.put('not an array', 'patches');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadFilesystemPatches(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should overwrite previous patches on save', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      const updated: readonly FileSystemPatch[] = [validPatches[0]];
      await saveFilesystemPatches(db, updated);
      const result = await loadFilesystemPatches(db);
      expect(result).toHaveLength(1);
      db.close();
    });
  });

  describe('mission seed', () => {
    it('should return null when no seed exists', async () => {
      const db = await openDatabase();
      const result = await loadMissionSeed(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should save and load a seed', async () => {
      const db = await openDatabase();
      await saveMissionSeed(db, 'MEDTECH-4A7F-easy');
      const result = await loadMissionSeed(db);
      expect(result).toBe('MEDTECH-4A7F-easy');
      db.close();
    });

    it('should clear seed when saving null', async () => {
      const db = await openDatabase();
      await saveMissionSeed(db, 'MEDTECH-4A7F-easy');
      await saveMissionSeed(db, null);
      const result = await loadMissionSeed(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should return null for non-string stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put(12345, 'activeMissionSeed');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadMissionSeed(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should overwrite previous seed on save', async () => {
      const db = await openDatabase();
      await saveMissionSeed(db, 'SEED-A');
      await saveMissionSeed(db, 'SEED-B');
      const result = await loadMissionSeed(db);
      expect(result).toBe('SEED-B');
      db.close();
    });
  });

  describe('clearAllData', () => {
    it('should clear IndexedDB stores and sessionStorage', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      await saveMissionSeed(db, 'TEST-SEED');
      await saveWifiState(db, true);
      saveSessionToTab(validSession);

      await clearAllData(db);

      expect(await loadFilesystemPatches(db)).toBeNull();
      expect(await loadMissionSeed(db)).toBeNull();
      expect(await loadWifiState(db)).toBeNull();
      expect(loadSessionFromTab()).toBeNull();
      db.close();
    });
  });
});
