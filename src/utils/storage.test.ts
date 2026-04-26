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
  saveGameState,
  loadGameState,
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
    sessionId: null,
  },
  sessionStack: [],
  ftpSession: null,
  ncSession: null,
  mysqlSession: null,
  redisSession: null,
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
            reason: 'ssh',
            sessionId: null,
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

    it('should save and load WiFi connection object', async () => {
      const db = await openDatabase();
      const connection = { essid: 'JSHACK-CORP', bssid: 'A4:CF:12:D3:8B:7A' };
      await saveWifiState(db, connection);
      const result = await loadWifiState(db);
      expect(result).toEqual(connection);
      db.close();
    });

    it('should save and load null (disconnected)', async () => {
      const db = await openDatabase();
      await saveWifiState(db, { essid: 'JSHACK-CORP', bssid: 'A4:CF:12:D3:8B:7A' });
      await saveWifiState(db, null);
      const result = await loadWifiState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should overwrite previous WiFi state', async () => {
      const db = await openDatabase();
      await saveWifiState(db, { essid: 'NETWORK-A', bssid: 'AA:BB:CC:DD:EE:01' });
      const updated = { essid: 'NETWORK-B', bssid: 'AA:BB:CC:DD:EE:02' };
      await saveWifiState(db, updated);
      const result = await loadWifiState(db);
      expect(result).toEqual(updated);
      db.close();
    });

    it('should migrate legacy boolean true to null', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put(true, 'wifiConnected');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadWifiState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should migrate legacy boolean false to null', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put(false, 'wifiConnected');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadWifiState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should return null for invalid stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put('not-valid', 'wifiConnected');
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

  describe('game state (IndexedDB shared)', () => {
    it('should return null when no game state exists', async () => {
      const db = await openDatabase();
      const result = await loadGameState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should save and load game state', async () => {
      const db = await openDatabase();
      const state = {
        seed: 'abc123',
        workstationName: 'hacker-box',
        username: 'testuser',
        rootPassword: 'testpass',
      };
      await saveGameState(db, state);
      const result = await loadGameState(db);
      expect(result).toEqual(state);
      db.close();
    });

    it('should overwrite previous game state', async () => {
      const db = await openDatabase();
      await saveGameState(db, {
        seed: 'old',
        workstationName: 'old-box',
        username: 'testuser',
        rootPassword: 'testpass',
      });
      const updated = {
        seed: 'new',
        workstationName: 'new-box',
        username: 'testuser2',
        rootPassword: 'testpass2',
      };
      await saveGameState(db, updated);
      const result = await loadGameState(db);
      expect(result).toEqual(updated);
      db.close();
    });

    it('should return null for invalid stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put('not-valid', 'gameState');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadGameState(db);
      expect(result).toBeNull();
      db.close();
    });
  });

  describe('clearAllData', () => {
    it('should clear IndexedDB stores and sessionStorage', async () => {
      const db = await openDatabase();
      await saveFilesystemPatches(db, validPatches);
      await saveMissionSeed(db, 'TEST-SEED');
      await saveWifiState(db, { essid: 'TEST-NET', bssid: 'AA:BB:CC:DD:EE:FF' });
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
