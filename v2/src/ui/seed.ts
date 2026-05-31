/**
 * Seed state for the terminal slice — a throwaway starter workstation.
 *
 * This is hand-built bootstrap data, NOT the real thing: procedural
 * `generation/` + IndexedDB-persisted patches replace the FS tree in a later
 * chunk (the seeded-workstation-fs plan). It exists so `cat` has a real
 * filesystem to read in the browser today.
 *
 * What this slice DID change: the tree, prompt host, and session now derive
 * from the player's typed `GameConfig` (machine name + username) instead of
 * hardcoded `'alice'`/`'workstation'`. The passwords here are still scaffold
 * literals — real `md5`-hashed `/etc/passwd` generation lands with Story 1.
 *
 * Permission note: `/etc/passwd` is readable by root + user only (NOT guest,
 * NOT world) — passwords live inline (jshack has no /etc/shadow), so leaking
 * passwd is a real privilege boundary.
 */

import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex, type AbsPath } from '../core/types';
import type { Directory, FileEntry, FileNode, FilePermissions } from '../core/filesystem/types';
import type { Identity, Session } from '../core/commands/types';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import { computeWorkstationId } from '../core/identity/workstation';

const TRAVERSABLE_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
const HOME_DIR: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
};
const PASSWD: FilePermissions = { read: ['root', 'user'], write: ['root'], execute: ['root'] };
const WORLD_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};
const USER_FILE: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root'],
};

const file = (content: string, perms: FilePermissions, owner = 'root'): FileEntry => ({
  kind: 'file',
  content,
  owner,
  perms,
});

const dir = (
  entries: Record<string, FileNode>,
  perms: FilePermissions,
  owner = 'root',
): Directory => ({
  kind: 'directory',
  owner,
  perms,
  entries: new Map(Object.entries(entries)),
});

/** Default config used by tests + as the development fallback — reproduces the
 *  pre-intro `alice@workstation` workstation so existing behaviour is stable. */
export const SEED_CONFIG: GameConfig = {
  machineName: 'workstation',
  username: 'alice',
  rootPassword: 'hunter2',
};

/** The player's home directory path for a given username. */
export const homePathFor = (username: string): AbsPath => asAbsPath(`/home/${username}`);

export const seedFs = (config: GameConfig): Directory => {
  const { username } = config;
  return dir(
    {
      etc: dir(
        {
          passwd: file(
            `root:r00tpw:0:0:root:/root:/bin/bash\n${username}:hunter2:1000:1000:${username}:/home/${username}:/bin/bash\n`,
            PASSWD,
          ),
          motd: file('Welcome to JSHACK.ME. Try: cat /etc/passwd\n', WORLD_FILE),
        },
        TRAVERSABLE_DIR,
      ),
      home: dir(
        {
          [username]: dir(
            {
              'readme.txt': file(
                'This is your workstation.\nTry: cat /etc/passwd\n',
                USER_FILE,
                username,
              ),
            },
            HOME_DIR,
            username,
          ),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};

/** Build the bootstrap session for the player's own workstation. The machine
 *  id MUST be the identity-derived `computeWorkstationId` so the server's
 *  own-workstation L1 bypass (suffix match) accepts writes/reads, and the
 *  player_key MUST be the real pubkey the envelope is signed with. The
 *  machine name + username come from the player's typed `GameConfig`. */
export const seedSession = (identity: Identity, config: GameConfig): Session => ({
  id: 'seed-session',
  playerKey: asPlayerKeyHex(identity.publicKeyHex),
  machineId: asMachineId(computeWorkstationId(config.machineName, identity.publicKeyHex)),
  username: config.username,
  userType: 'user',
  kind: 'su',
  createdAt: asEpochMs(0),
});
