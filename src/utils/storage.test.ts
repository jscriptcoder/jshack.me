import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDatabase,
  loadSessionState,
  saveSessionState,
  loadFilesystemPatches,
  saveFilesystemPatches,
} from './storage';
import type { PersistedState } from '../session/SessionContext';
import type { FileSystemPatch } from '../filesystem/types';

const validSession: PersistedState = {
  session: {
    username: 'jshacker',
    userType: 'user',
    machine: 'localhost',
    currentPath: '/home/jshacker',
    wifiConnected: false,
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

  describe('session state', () => {
    it('should return null when no session exists', async () => {
      const db = await openDatabase();
      const result = await loadSessionState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should save and load session state', async () => {
      const db = await openDatabase();
      await saveSessionState(db, validSession);
      const result = await loadSessionState(db);
      expect(result).toEqual(validSession);
      db.close();
    });

    it('should persist session with SSH stack', async () => {
      const withStack: PersistedState = {
        ...validSession,
        sessionStack: [
          {
            username: 'admin',
            userType: 'user',
            machine: '192.168.1.1',
            currentPath: '/home/admin',
            wifiConnected: false,
            theme: 'amber',
          },
        ],
      };
      const db = await openDatabase();
      await saveSessionState(db, withStack);
      const result = await loadSessionState(db);
      expect(result?.sessionStack).toHaveLength(1);
      expect(result?.sessionStack[0].username).toBe('admin');
      db.close();
    });

    it('should persist session with FTP session', async () => {
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
      const db = await openDatabase();
      await saveSessionState(db, withFtp);
      const result = await loadSessionState(db);
      expect(result?.ftpSession?.remoteMachine).toBe('192.168.1.50');
      db.close();
    });

    it('should return null for invalid stored data', async () => {
      const db = await openDatabase();
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      store.put({ invalid: 'data' }, 'state');
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
      });
      const result = await loadSessionState(db);
      expect(result).toBeNull();
      db.close();
    });

    it('should overwrite previous session on save', async () => {
      const db = await openDatabase();
      await saveSessionState(db, validSession);
      const updated: PersistedState = {
        ...validSession,
        session: { ...validSession.session, username: 'root', userType: 'root' },
      };
      await saveSessionState(db, updated);
      const result = await loadSessionState(db);
      expect(result?.session.username).toBe('root');
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
});
