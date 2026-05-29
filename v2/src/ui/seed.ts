/**
 * Seed state for the terminal slice — a throwaway starter workstation.
 *
 * This is hand-built bootstrap data, NOT the real thing: procedural
 * `generation/` + IndexedDB-persisted patches replace it in a later chunk.
 * It exists so `cat` has a real filesystem to read in the browser today.
 *
 * Permission note: `/etc/passwd` is readable by root + user only (NOT guest,
 * NOT world) — passwords live inline (jshack has no /etc/shadow), so leaking
 * passwd is a real privilege boundary.
 */

import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import type { Directory, FileEntry, FileNode, FilePermissions } from '../core/filesystem/types';
import type { Identity, Session } from '../core/commands/types';
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

export const SEED_HOST = 'workstation';
export const SEED_USERNAME = 'alice';
export const SEED_HOME = asAbsPath('/home/alice');

export const seedFs = (): Directory =>
  dir(
    {
      etc: dir(
        {
          passwd: file(
            'root:r00tpw:0:0:root:/root:/bin/bash\nalice:hunter2:1000:1000:Alice:/home/alice:/bin/bash\n',
            PASSWD,
          ),
          motd: file('Welcome to JSHACK.ME. Try: cat /etc/passwd\n', WORLD_FILE),
        },
        TRAVERSABLE_DIR,
      ),
      home: dir(
        {
          alice: dir(
            {
              'readme.txt': file(
                'This is your workstation.\nTry: cat /etc/passwd\n',
                USER_FILE,
                'alice',
              ),
            },
            HOME_DIR,
            'alice',
          ),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );

/** Build the bootstrap session for the player's own workstation. The machine
 *  id MUST be the identity-derived `computeWorkstationId` so the server's
 *  own-workstation L1 bypass (suffix match) accepts writes/reads, and the
 *  player_key MUST be the real pubkey the envelope is signed with. */
export const seedSession = (identity: Identity): Session => ({
  id: 'seed-session',
  playerKey: asPlayerKeyHex(identity.publicKeyHex),
  machineId: asMachineId(computeWorkstationId(SEED_HOST, identity.publicKeyHex)),
  username: SEED_USERNAME,
  userType: 'user',
  kind: 'su',
  createdAt: asEpochMs(0),
});
