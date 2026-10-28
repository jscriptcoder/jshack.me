/**
 * The guardian's password round: every account on a public website given a fresh password,
 * each from the pool the account was generated from.
 *
 * A generated box's passwords are seeded, so a player who decodes the bundle can work a
 * crackable word out and log in on the first try, without the `hydra` run whose attempts
 * land in `auth.log`. A word the operator draws on the round comes from no seed. Drawing
 * from the account's own pool keeps the box exactly as hard as it was born: `hydra` still
 * opens what it opened, and only the shortcut goes.
 *
 * The file is written as generated, not edited: an account a rooted player added is gone,
 * one they deleted is back, and a hash they set is replaced. The kind is read off the box
 * as generated, so a hash nobody generated is never classified. Written as the box itself,
 * like the patch beside it. A bricked box is left alone, as a patch leaves it.
 *
 * Pure, framework-agnostic (core/): the draw is supplied by the script.
 */

import { canBoot } from '../boot/bootFiles.js';
import { PASSWD_FILE } from '../generation/baseFs.js';
import { md5 } from '../generation/md5.js';
import { CRACKABLE_PASSWORDS } from '../generation/passwordPools.js';
import { createFsView } from '../filesystem/fsView.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatPasswdLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import {
  accountsIn,
  PASSWD_OWNER,
  PASSWD_PATH,
  withAccountHashes,
} from '../sessions/passwdAccount.js';
import { asAbsPath, asGameTime } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import type { PatchRow } from './patch.js';
import type { PublicBox } from './publicBoxes.js';

/** A fresh password hash from each pool. Never seeded: a seeded draw is only a new
 *  shortcut for whoever decodes the seed. */
export type PasswordDraw = {
  readonly crackable: () => string;
  readonly uncrackable: () => string;
};

export type RotationInput = {
  readonly box: PublicBox;
  /** Every row the box's journal holds, or null for a box nobody has written to. */
  readonly journal: readonly OwnerPatchRow[] | null;
  readonly draw: PasswordDraw;
  /** The round's moment, in epoch ms: the time and pid on the box's `auth.log` lines. */
  readonly now: number;
};

export type Rotation = {
  /** Every account whose password changed, in passwd order. */
  readonly accounts: readonly string[];
  readonly rows: readonly PatchRow[];
};

const CRACKABLE_HASHES: ReadonlySet<string> = new Set(CRACKABLE_PASSWORDS.map(md5));

const readAt = (tree: Directory, path: string): string | null => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  return result.ok ? result.content : null;
};

/** What a password round does to `box`, given everything written to it so far. */
export const decideRotation = ({ box, journal, draw, now }: RotationInput): Rotation => {
  const standing = materializeMachineFs(box.baseFs(), journal);
  if (!canBoot(standing).ok) return { accounts: [], rows: [] };
  const generated = box.baseFs();
  const accounts = accountsIn(generated).map((account) => account.username);
  const hostname = (readAt(generated, '/etc/hostname') ?? '').trim();
  // The line the `passwd` command leaves, one per account, appended to the log as the box
  // holds it now; a wiped log starts again from these.
  const lines = accounts.map(
    (user) =>
      `${formatPasswdLine({ user, hostname, time: asGameTime(now), pid: derivePid(now) })}\n`,
  );
  const writerKey = apGatewayLogWriterKey(box.networkKey);
  return {
    accounts,
    rows: [
      {
        path: PASSWD_PATH,
        content: withAccountHashes(generated, (account) =>
          CRACKABLE_HASHES.has(account.hash) ? draw.crackable() : draw.uncrackable(),
        ),
        owner: PASSWD_OWNER,
        permissions: PASSWD_FILE,
        node_type: 'file',
        writer_key: writerKey,
      },
      {
        path: AUTH_LOG_PATH,
        content: (readAt(standing, AUTH_LOG_PATH) ?? '') + lines.join(''),
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
        writer_key: writerKey,
      },
    ],
  };
};
