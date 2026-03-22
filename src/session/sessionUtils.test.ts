import { describe, it, expect } from 'vitest';
import {
  isValidUserType,
  asRecord,
  isValidSession,
  isValidSessionSnapshot,
  isValidFtpSession,
  isValidNcSession,
  isValidPersistedState,
  createDefaultSession,
  normalizeSession,
  normalizeSnapshot,
} from './sessionUtils';
import type { Session, SessionSnapshot } from './SessionContext';

describe('isValidUserType', () => {
  it('accepts valid user types', () => {
    expect(isValidUserType('root')).toBe(true);
    expect(isValidUserType('user')).toBe(true);
    expect(isValidUserType('guest')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidUserType('admin')).toBe(false);
    expect(isValidUserType('')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidUserType(42)).toBe(false);
    expect(isValidUserType(null)).toBe(false);
    expect(isValidUserType(undefined)).toBe(false);
    expect(isValidUserType(true)).toBe(false);
  });
});

describe('asRecord', () => {
  it('returns the object for plain objects', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns null for null', () => {
    expect(asRecord(null)).toBe(null);
  });

  it('returns null for primitives', () => {
    expect(asRecord('string')).toBe(null);
    expect(asRecord(42)).toBe(null);
    expect(asRecord(undefined)).toBe(null);
    expect(asRecord(true)).toBe(null);
  });

  it('returns the array for arrays (typeof object)', () => {
    const arr = [1, 2];
    expect(asRecord(arr)).toBe(arr);
  });
});

const validSession: Session = {
  username: 'jshacker',
  userType: 'user',
  machine: 'localhost',
  currentPath: '/home/jshacker',
  theme: 'amber',
};

describe('isValidSession', () => {
  it('accepts a valid session', () => {
    expect(isValidSession(validSession)).toBe(true);
  });

  it('accepts a session without theme (optional)', () => {
    const { theme: _, ...noTheme } = validSession;
    expect(isValidSession(noTheme)).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isValidSession({ username: 'a', machine: 'b' })).toBe(false);
  });

  it('rejects invalid userType', () => {
    expect(isValidSession({ ...validSession, userType: 'admin' })).toBe(false);
  });

  it('rejects invalid theme', () => {
    expect(isValidSession({ ...validSession, theme: 'neon-pink' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidSession(null)).toBe(false);
    expect(isValidSession('string')).toBe(false);
  });
});

describe('isValidSessionSnapshot', () => {
  it('delegates to isValidSession', () => {
    expect(isValidSessionSnapshot(validSession)).toBe(true);
    expect(isValidSessionSnapshot({})).toBe(false);
  });
});

const validFtpSession = {
  remoteMachine: '192.168.1.50',
  remoteUsername: 'ftpuser',
  remoteUserType: 'user' as const,
  remoteCwd: '/home/ftpuser',
  originMachine: 'localhost',
  originUsername: 'jshacker',
  originUserType: 'user' as const,
  originCwd: '/home/jshacker',
};

describe('isValidFtpSession', () => {
  it('accepts a valid FTP session', () => {
    expect(isValidFtpSession(validFtpSession)).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isValidFtpSession({ remoteMachine: '1.2.3.4' })).toBe(false);
  });

  it('rejects invalid userTypes', () => {
    expect(isValidFtpSession({ ...validFtpSession, remoteUserType: 'admin' })).toBe(false);
    expect(isValidFtpSession({ ...validFtpSession, originUserType: 'admin' })).toBe(false);
  });
});

const validNcSession = {
  targetIP: '192.168.1.75',
  targetPort: 4444,
  service: 'elite',
  username: 'www-data',
  userType: 'user' as const,
  currentPath: '/home/www-data',
};

describe('isValidNcSession', () => {
  it('accepts a valid NC session', () => {
    expect(isValidNcSession(validNcSession)).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isValidNcSession({ targetIP: '1.2.3.4' })).toBe(false);
  });

  it('rejects non-number port', () => {
    expect(isValidNcSession({ ...validNcSession, targetPort: '4444' })).toBe(false);
  });
});

describe('isValidPersistedState', () => {
  it('accepts valid complete state', () => {
    const state = {
      session: validSession,
      sessionStack: [validSession],
      ftpSession: null,
      ncSession: null,
    };
    expect(isValidPersistedState(state)).toBe(true);
  });

  it('accepts state with FTP and NC sessions', () => {
    const state = {
      session: validSession,
      sessionStack: [],
      ftpSession: validFtpSession,
      ncSession: validNcSession,
    };
    expect(isValidPersistedState(state)).toBe(true);
  });

  it('rejects invalid session', () => {
    const state = {
      session: { username: 'a' },
      sessionStack: [],
      ftpSession: null,
      ncSession: null,
    };
    expect(isValidPersistedState(state)).toBe(false);
  });

  it('rejects invalid stack entries', () => {
    const state = {
      session: validSession,
      sessionStack: [{ bad: true }],
      ftpSession: null,
      ncSession: null,
    };
    expect(isValidPersistedState(state)).toBe(false);
  });

  it('accepts undefined ncSession for backward compatibility', () => {
    const state = {
      session: validSession,
      sessionStack: [],
      ftpSession: null,
      ncSession: undefined,
    };
    expect(isValidPersistedState(state)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isValidPersistedState(null)).toBe(false);
    expect(isValidPersistedState('string')).toBe(false);
  });
});

describe('createDefaultSession', () => {
  it('has the expected default values', () => {
    expect(createDefaultSession('jshacker')).toEqual({
      username: 'jshacker',
      userType: 'user',
      machine: 'localhost',
      currentPath: '/home/jshacker',
      theme: 'amber',
    });
  });

  it('uses the provided username', () => {
    const session = createDefaultSession('testuser');
    expect(session.username).toBe('testuser');
    expect(session.currentPath).toBe('/home/testuser');
  });
});

describe('normalizeSession', () => {
  it('passes through a valid theme', () => {
    const result = normalizeSession(validSession);
    expect(result.theme).toBe('amber');
  });

  it('falls back to default theme for invalid theme', () => {
    const bad = { ...validSession, theme: 'neon-pink' as Session['theme'] };
    const result = normalizeSession(bad);
    expect(result.theme).toBe('amber');
  });

  it('preserves all other fields', () => {
    const result = normalizeSession(validSession);
    expect(result.username).toBe(validSession.username);
    expect(result.machine).toBe(validSession.machine);
    expect(result.currentPath).toBe(validSession.currentPath);
    expect(result.userType).toBe(validSession.userType);
  });
});

describe('normalizeSnapshot', () => {
  it('passes through a valid theme', () => {
    const snapshot: SessionSnapshot = { ...validSession, reason: 'ssh' };
    const result = normalizeSnapshot(snapshot);
    expect(result.theme).toBe('amber');
  });

  it('falls back to default theme for invalid theme', () => {
    const bad = {
      ...validSession,
      theme: 'bogus' as SessionSnapshot['theme'],
      reason: 'ssh' as const,
    };
    const result = normalizeSnapshot(bad);
    expect(result.theme).toBe('amber');
  });

  it('defaults reason to ssh for old snapshots without reason', () => {
    // Old persisted snapshots won't have a reason field
    const oldSnapshot = { ...validSession } as SessionSnapshot;
    const result = normalizeSnapshot(oldSnapshot);
    expect(result.reason).toBe('ssh');
  });

  it('preserves su reason', () => {
    const snapshot: SessionSnapshot = { ...validSession, reason: 'su' };
    const result = normalizeSnapshot(snapshot);
    expect(result.reason).toBe('su');
  });
});
