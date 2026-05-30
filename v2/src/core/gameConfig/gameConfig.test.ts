import { describe, expect, it } from 'vitest';
import {
  type GameConfig,
  GAMECONFIG_STORAGE_KEY,
  getStoredGameConfig,
  loadGameConfig,
  serializeGameConfig,
  storeGameConfig,
  validateMachineName,
  validatePassword,
  validateUsername,
} from './gameConfig';

const getMockConfig = (overrides?: Partial<GameConfig>): GameConfig => ({
  machineName: 'skylab',
  username: 'alice',
  rootPassword: 'hunter2',
  ...overrides,
});

/** Minimal in-memory Storage stand-in (mirrors the identity tests' fake). */
const fakeStorage = (initial?: Record<string, string>): Pick<Storage, 'getItem' | 'setItem'> => {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
};

// Validators return null when the value is acceptable, or a NON-EMPTY error
// message when it is not. Tests pin the valid/invalid DECISION (the behaviour
// that matters) and that the error is a real, displayable message — invalid
// cases assert `.toBeTruthy()` (kills "message mutated to empty string"
// mutants), not the exact wording.

describe('validateMachineName', () => {
  it('accepts a normal lowercase hostname', () => {
    expect(validateMachineName('skylab')).toBeNull();
  });

  it('accepts a single character', () => {
    expect(validateMachineName('a')).toBeNull();
  });

  it('accepts internal hyphens and digits', () => {
    expect(validateMachineName('web-01')).toBeNull();
  });

  it('rejects an empty name with a non-empty message', () => {
    expect(validateMachineName('')).toBeTruthy();
  });

  it('accepts exactly 24 characters (upper boundary)', () => {
    expect(validateMachineName('a'.repeat(24))).toBeNull();
  });

  it('rejects 25 characters with a non-empty message (just over the boundary)', () => {
    expect(validateMachineName('a'.repeat(25))).toBeTruthy();
  });

  it('rejects a leading hyphen', () => {
    expect(validateMachineName('-box')).toBeTruthy();
  });

  it('rejects a trailing hyphen', () => {
    expect(validateMachineName('box-')).toBeTruthy();
  });

  it('rejects uppercase letters', () => {
    expect(validateMachineName('Skylab')).toBeTruthy();
  });

  it('rejects spaces and other punctuation', () => {
    expect(validateMachineName('my box')).toBeTruthy();
  });
});

describe('validateUsername', () => {
  it('accepts a normal username', () => {
    expect(validateUsername('alice')).toBeNull();
  });

  it('accepts letters, digits, hyphens, and underscores after a leading letter', () => {
    expect(validateUsername('a_b-c9')).toBeNull();
  });

  it('rejects an empty username with a non-empty message', () => {
    expect(validateUsername('')).toBeTruthy();
  });

  it('accepts exactly 24 characters (upper boundary)', () => {
    expect(validateUsername(`a${'b'.repeat(23)}`)).toBeNull();
  });

  it('rejects 25 characters with a non-empty message (just over the boundary)', () => {
    expect(validateUsername(`a${'b'.repeat(24)}`)).toBeTruthy();
  });

  it('rejects a name starting with a digit', () => {
    expect(validateUsername('1alice')).toBeTruthy();
  });

  it('rejects a name starting with a hyphen', () => {
    expect(validateUsername('-alice')).toBeTruthy();
  });

  it('rejects uppercase letters', () => {
    expect(validateUsername('Alice')).toBeTruthy();
  });

  it('rejects a trailing invalid character (anchors the end-of-string $)', () => {
    // Without the trailing `$`, the regex would match the valid prefix of
    // `alice!` and wrongly accept it.
    expect(validateUsername('alice!')).toBeTruthy();
  });

  it('rejects the reserved name "root"', () => {
    expect(validateUsername('root')).toBeTruthy();
  });

  it('rejects the reserved name "guest"', () => {
    expect(validateUsername('guest')).toBeTruthy();
  });

  it('rejects the reserved name "admin"', () => {
    expect(validateUsername('admin')).toBeTruthy();
  });

  it('rejects the reserved name "daemon"', () => {
    expect(validateUsername('daemon')).toBeTruthy();
  });

  it('rejects the reserved name "bin"', () => {
    expect(validateUsername('bin')).toBeTruthy();
  });

  it('rejects the reserved name "sys"', () => {
    expect(validateUsername('sys')).toBeTruthy();
  });

  it('rejects the reserved name "nobody"', () => {
    expect(validateUsername('nobody')).toBeTruthy();
  });
});

describe('validatePassword', () => {
  it('accepts a 4-character password (lower boundary)', () => {
    expect(validatePassword('pass')).toBeNull();
  });

  it('rejects a 3-character password with a non-empty message (just under the boundary)', () => {
    expect(validatePassword('abc')).toBeTruthy();
  });

  it('rejects an empty password with a non-empty message', () => {
    expect(validatePassword('')).toBeTruthy();
  });

  it('accepts a long password', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull();
  });
});

describe('loadGameConfig / serializeGameConfig', () => {
  it('round-trips a config through serialize → load', () => {
    const config = getMockConfig();
    expect(loadGameConfig(serializeGameConfig(config))).toEqual(config);
  });

  it('preserves each field through the round-trip', () => {
    const config = getMockConfig({
      machineName: 'web-01',
      username: 'bob_dev',
      rootPassword: 'p@ss with spaces',
    });
    expect(loadGameConfig(serializeGameConfig(config))).toEqual(config);
  });

  it('returns null for null input (no stored config)', () => {
    expect(loadGameConfig(null)).toBeNull();
  });

  it('returns null for non-JSON input rather than throwing', () => {
    expect(loadGameConfig('not json{')).toBeNull();
  });

  it('returns null for a JSON value that is not an object', () => {
    expect(loadGameConfig('"a string"')).toBeNull();
  });

  it('returns null for the JSON literal null (parses to null, not an object)', () => {
    // `JSON.parse('null')` is `null` — the `parsed === null` guard must catch
    // it before the property destructure throws.
    expect(loadGameConfig('null')).toBeNull();
  });

  it('returns null when machineName is missing', () => {
    expect(
      loadGameConfig(JSON.stringify({ username: 'alice', rootPassword: 'hunter2' })),
    ).toBeNull();
  });

  it('returns null when username is missing', () => {
    expect(
      loadGameConfig(JSON.stringify({ machineName: 'skylab', rootPassword: 'hunter2' })),
    ).toBeNull();
  });

  it('returns null when rootPassword is missing', () => {
    expect(loadGameConfig(JSON.stringify({ machineName: 'skylab', username: 'alice' }))).toBeNull();
  });

  it('returns null when machineName is the wrong type', () => {
    expect(
      loadGameConfig(JSON.stringify({ machineName: 5, username: 'alice', rootPassword: 'hunter2' })),
    ).toBeNull();
  });

  it('returns null when username is the wrong type', () => {
    expect(
      loadGameConfig(JSON.stringify({ machineName: 'skylab', username: 5, rootPassword: 'hunter2' })),
    ).toBeNull();
  });

  it('returns null when username is a non-string that string-coerces to a valid name', () => {
    // `['alice']` stringifies to "alice" — which would PASS the regex if the
    // typeof guard were skipped. Pins that the guard rejects on the JS type,
    // not on the coerced string (kills the dropped-username-typeof mutant).
    expect(
      loadGameConfig(
        JSON.stringify({ machineName: 'skylab', username: ['alice'], rootPassword: 'hunter2' }),
      ),
    ).toBeNull();
  });

  it('returns null when rootPassword is the wrong type', () => {
    expect(
      loadGameConfig(JSON.stringify({ machineName: 'skylab', username: 'alice', rootPassword: 5 })),
    ).toBeNull();
  });

  it('returns null when the stored machineName fails validation', () => {
    // Defensive: a hand-tampered store with an invalid machine name must not
    // load — load re-validates the machineName branch, not just the username.
    expect(loadGameConfig(serializeGameConfig(getMockConfig({ machineName: 'Bad Name' })))).toBeNull();
  });

  it('returns null when the stored username fails validation (reserved name)', () => {
    expect(loadGameConfig(serializeGameConfig(getMockConfig({ username: 'root' })))).toBeNull();
  });

  it('returns null when the stored rootPassword fails validation (too short)', () => {
    expect(loadGameConfig(serializeGameConfig(getMockConfig({ rootPassword: 'ab' })))).toBeNull();
  });
});

describe('getStoredGameConfig / storeGameConfig', () => {
  it('returns null when storage holds no config', () => {
    expect(getStoredGameConfig(fakeStorage())).toBeNull();
  });

  it('reads back a config that storeGameConfig persisted', () => {
    const storage = fakeStorage();
    const config = getMockConfig();
    storeGameConfig(storage, config);
    expect(getStoredGameConfig(storage)).toEqual(config);
  });

  it('persists under the canonical storage key', () => {
    const storage = fakeStorage();
    storeGameConfig(storage, getMockConfig());
    expect(storage.getItem(GAMECONFIG_STORAGE_KEY)).not.toBeNull();
  });

  it('returns null when stored bytes are corrupt, rather than throwing', () => {
    expect(getStoredGameConfig(fakeStorage({ [GAMECONFIG_STORAGE_KEY]: 'garbage{' }))).toBeNull();
  });
});
