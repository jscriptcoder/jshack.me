/**
 * Game configuration — the player-chosen workstation identity captured at the
 * intro screen and persisted across loads.
 *
 * These three fields are CONFIG, not generation entropy: the Ed25519 identity
 * pubkey is the world seed (see network-generator epic). `rootPassword` later
 * becomes `md5(rootPassword)` in the generated `/etc/passwd`; `username` and
 * `machineName` shape the home dir + prompt.
 *
 * Validation rules are ported verbatim from the legacy intro screen
 * (`src/components/IntroScreen.tsx`). Each validator returns `null` when the
 * value is acceptable, or a human-readable error message when it is not.
 */

export type GameConfig = {
  readonly machineName: string;
  readonly username: string;
  readonly rootPassword: string;
};

const MAX_NAME_LENGTH = 24;
const MIN_PASSWORD_LENGTH = 4;

// A hostname is a single char, or starts+ends with [a-z0-9] with hyphens allowed
// between. Mirrors legacy HOSTNAME_REGEX.
const MACHINE_NAME_REGEX = /^[a-z0-9][-a-z0-9]*[a-z0-9]$|^[a-z0-9]$/;

// A username starts with a lowercase letter, then letters/digits/hyphens/underscores.
const USERNAME_REGEX = /^[a-z][a-z0-9_-]*$/;

// System names a player must not claim — they collide with generated accounts.
const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'root',
  'guest',
  'admin',
  'daemon',
  'bin',
  'sys',
  'nobody',
]);

export const validateMachineName = (value: string): string | null => {
  if (!value) return 'Enter a name for your workstation';
  if (value.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or less`;
  if (!MACHINE_NAME_REGEX.test(value)) return 'Use letters, numbers, and hyphens only';
  return null;
};

export const validateUsername = (value: string): string | null => {
  if (!value) return 'Enter a username';
  if (value.length > MAX_NAME_LENGTH)
    return `Username must be ${MAX_NAME_LENGTH} characters or less`;
  if (!USERNAME_REGEX.test(value))
    return 'Start with a letter, then letters, numbers, hyphens, or underscores';
  if (RESERVED_USERNAMES.has(value)) return `"${value}" is a reserved system name`;
  return null;
};

export const validatePassword = (value: string): string | null => {
  if (value.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return null;
};

/** True only when every field is present, a string, and passes its validator.
 *  Load re-validates rather than trusting persisted bytes — a hand-tampered
 *  store (e.g. username 'root') must not boot as a valid game. */
const isValidConfig = (value: GameConfig): boolean =>
  validateMachineName(value.machineName) === null &&
  validateUsername(value.username) === null &&
  validatePassword(value.rootPassword) === null;

export const serializeGameConfig = (config: GameConfig): string =>
  JSON.stringify({
    machineName: config.machineName,
    username: config.username,
    rootPassword: config.rootPassword,
  });

/** Defensive load (mirrors `loadIdentity`): any malformed or invalid input —
 *  null, non-JSON, non-object, missing/wrong-typed field, or a value that
 *  fails validation — returns null so the boot flow shows the intro screen
 *  instead of crashing or trusting bad data. */
export const loadGameConfig = (raw: string | null): GameConfig | null => {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { machineName, username, rootPassword } = parsed as Record<string, unknown>;
  if (
    typeof machineName !== 'string' ||
    typeof username !== 'string' ||
    typeof rootPassword !== 'string'
  ) {
    return null;
  }

  const config: GameConfig = { machineName, username, rootPassword };
  return isValidConfig(config) ? config : null;
};

/** The minimal storage surface the get/store helpers need — a subset of the
 *  DOM `Storage` interface so it's unit-testable with a fake (mirrors
 *  `IdentityStorage`). */
export type GameConfigStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const GAMECONFIG_STORAGE_KEY = 'jshack.gameConfig';

/** Read + defensively-load the persisted config; null when absent or invalid. */
export const getStoredGameConfig = (storage: GameConfigStorage): GameConfig | null =>
  loadGameConfig(storage.getItem(GAMECONFIG_STORAGE_KEY));

export const storeGameConfig = (storage: GameConfigStorage, config: GameConfig): void => {
  storage.setItem(GAMECONFIG_STORAGE_KEY, serializeGameConfig(config));
};
