import { describe, expect, it } from 'vitest';
import { decideRotation, type PasswordDraw } from './rotate.js';
import { PATROL, publicBox, type PublicBox } from './publicBoxes.js';
import { accountsIn, PASSWD_PATH } from '../sessions/passwdAccount.js';
import { PASSWD_FILE } from '../generation/baseFs.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatPasswdLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import { md5 } from '../generation/md5.js';
import { CRACKABLE_PASSWORDS } from '../../test/passwords.js';
import { createFsView } from '../filesystem/fsView.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { asAbsPath, asGameTime } from '../types.js';
import type { Directory } from '../filesystem/types.js';

/**
 * The guardian changing a public website's passwords on its round. A generated box's
 * password is seeded, so a player who decodes the bundle could work a crackable word out
 * without the `hydra` run whose attempts are logged; a word drawn on the round comes from
 * no seed. Each account draws again from the pool it was generated from, so the box stays
 * exactly as hard as it was born.
 */

const NOW = Date.parse('2026-10-28T09:30:00.000Z');

const DRAW: PasswordDraw = {
  crackable: () => 'crackable-hash',
  uncrackable: () => 'uncrackable-hash',
};

const CRACKABLE_HASHES = new Set(CRACKABLE_PASSWORDS.map(md5));
const generatedCrackable = (hash: string): boolean => CRACKABLE_HASHES.has(hash);

const boxNamed = (name: string): PublicBox => {
  const box = publicBox(name);
  if (box === undefined) throw new Error(`${name} is no public website`);
  return box;
};

/** A patrolled box born holding both kinds of password, so a test can tell them apart. */
const boxHoldingBothKinds = (): PublicBox => {
  const box = PATROL.find((candidate) => {
    const hashes = accountsIn(candidate.baseFs()).map((account) => account.hash);
    return hashes.some(generatedCrackable) && !hashes.every(generatedCrackable);
  });
  if (box === undefined) throw new Error('no patrolled box holds both kinds of password');
  return box;
};

const journalRow = (overrides?: Partial<OwnerPatchRow>): OwnerPatchRow => ({
  path: '/var/www/html/index.html',
  content: 'defaced\n',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-10-22T10:00:00.000Z',
  writer_key: 'a'.repeat(64),
  ...overrides,
});

/** The box as a reader sees it once the rotation's rows land after `journal`. */
const afterRotation = (
  box: PublicBox,
  journal: readonly OwnerPatchRow[],
  rows: readonly Omit<OwnerPatchRow, 'updated_at'>[],
): Directory =>
  materializeMachineFs(box.baseFs(), [
    ...journal,
    ...rows.map((row) => ({ ...row, updated_at: '2026-10-28T10:00:00.000Z' })),
  ]);

const readAt = (tree: Directory, path: string): string => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  if (!result.ok) throw new Error(`${path} does not read`);
  return result.content;
};

const passwdText = (tree: Directory): string => readAt(tree, PASSWD_PATH);

/** The lines the `passwd` command leaves for `users`, at the round's moment. */
const logLines = (box: PublicBox, users: readonly string[]): string =>
  users
    .map(
      (user) =>
        `${formatPasswdLine({
          user,
          hostname: readAt(box.baseFs(), '/etc/hostname').trim(),
          time: asGameTime(NOW),
          pid: derivePid(NOW),
        })}\n`,
    )
    .join('');

/** Every passwd field but the hash. */
const withoutHashes = (passwd: string): readonly string[] =>
  passwd.split('\n').map((line) => line.split(':').toSpliced(1, 1).join(':'));

describe('decideRotation', () => {
  it('gives every account a fresh password from the pool it was generated from', () => {
    const box = boxHoldingBothKinds();
    const generated = accountsIn(box.baseFs());

    const rotation = decideRotation({ box, journal: null, draw: DRAW, now: NOW });

    expect(rotation.accounts).toEqual(generated.map((account) => account.username));
    expect(accountsIn(afterRotation(box, [], rotation.rows))).toEqual(
      generated.map((account) => ({
        ...account,
        hash: generatedCrackable(account.hash) ? 'crackable-hash' : 'uncrackable-hash',
      })),
    );
  });

  it('leaves every other byte of /etc/passwd as generated', () => {
    const box = boxHoldingBothKinds();

    const rotation = decideRotation({ box, journal: null, draw: DRAW, now: NOW });

    expect(withoutHashes(passwdText(afterRotation(box, [], rotation.rows)))).toEqual(
      withoutHashes(passwdText(box.baseFs())),
    );
  });

  it('writes /etc/passwd as the box itself, root-owned and as tight as generated', () => {
    const box = boxNamed('millbrook.gov');

    const rotation = decideRotation({ box, journal: null, draw: DRAW, now: NOW });

    expect(rotation.rows.find((row) => row.path === PASSWD_PATH)).toEqual(
      expect.objectContaining({
        owner: 'root',
        permissions: PASSWD_FILE,
        node_type: 'file',
        writer_key: `ap:${box.networkKey}`,
      }),
    );
  });

  it("puts a rooted player's accounts back as generated", () => {
    const box = boxHoldingBothKinds();
    const [first, ...rest] = accountsIn(box.baseFs());
    if (first === undefined) throw new Error('a box with no accounts');
    const tampered = [
      `${first.username}:${md5('the-intruders-word')}:0:0:${first.username}:/root:/bin/bash`,
      'backdoor:x:0:0:backdoor:/root:/bin/bash',
      '',
    ].join('\n');
    const journal = [journalRow({ path: PASSWD_PATH, content: tampered })];
    expect(rest.length).toBeGreaterThan(0);

    const rotation = decideRotation({ box, journal, draw: DRAW, now: NOW });

    expect(rotation.accounts).toEqual([first, ...rest].map((account) => account.username));
    expect(passwdText(afterRotation(box, journal, rotation.rows))).toBe(
      passwdText(
        afterRotation(box, [], decideRotation({ box, journal: null, draw: DRAW, now: NOW }).rows),
      ),
    );
  });

  it('draws again for every account on every round', () => {
    const box = boxNamed('millbrook.gov');
    let drawn = 0;
    const counting: PasswordDraw = {
      crackable: () => `crackable-${++drawn}`,
      uncrackable: () => `uncrackable-${++drawn}`,
    };

    const first = decideRotation({ box, journal: null, draw: counting, now: NOW });
    const second = decideRotation({ box, journal: null, draw: counting, now: NOW });

    const hashes = [first, second].flatMap((rotation) =>
      accountsIn(afterRotation(box, [], rotation.rows)).map((account) => account.hash),
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('leaves a bricked box alone: nobody can log in to change anything', () => {
    const box = boxNamed('millbrook.gov');

    const rotation = decideRotation({
      box,
      journal: [journalRow({ path: '/boot/vmlinuz', content: null, node_type: null })],
      draw: DRAW,
      now: NOW,
    });

    expect(rotation).toEqual({ accounts: [], rows: [] });
  });

  it("leaves a passwd line per account on the box's auth.log, after what it already holds", () => {
    const box = boxNamed('millbrook.gov');
    const earlier =
      'Oct 27 08:00:00 earlier sshd[1234]: Accepted password for guest from 10.0.0.9\n';
    const journal = [
      journalRow({ path: AUTH_LOG_PATH, content: earlier, writer_key: `ap:${box.networkKey}` }),
    ];

    const rotation = decideRotation({ box, journal, draw: DRAW, now: NOW });

    expect(readAt(afterRotation(box, journal, rotation.rows), AUTH_LOG_PATH)).toBe(
      earlier + logLines(box, rotation.accounts),
    );
    expect(rotation.rows.find((row) => row.path === AUTH_LOG_PATH)).toEqual(
      expect.objectContaining({
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
        writer_key: `ap:${box.networkKey}`,
      }),
    );
  });

  it('starts a wiped auth.log again from its own lines', () => {
    const box = boxNamed('millbrook.gov');
    const journal = [journalRow({ path: AUTH_LOG_PATH, content: null, node_type: null })];

    const rotation = decideRotation({ box, journal, draw: DRAW, now: NOW });

    expect(readAt(afterRotation(box, journal, rotation.rows), AUTH_LOG_PATH)).toBe(
      logLines(box, rotation.accounts),
    );
  });

  it('keeps an auth.log a rooted player made root-only, reading it as root does', () => {
    const box = boxNamed('millbrook.gov');
    const earlier =
      'Oct 27 08:00:00 earlier sshd[1234]: Accepted password for root from 10.0.0.9\n';
    const journal = [
      journalRow({
        path: AUTH_LOG_PATH,
        content: earlier,
        permissions: { read: ['root'], write: ['root'], execute: [] },
      }),
    ];

    const rotation = decideRotation({ box, journal, draw: DRAW, now: NOW });

    expect(readAt(afterRotation(box, journal, rotation.rows), AUTH_LOG_PATH)).toBe(
      earlier + logLines(box, rotation.accounts),
    );
  });

  it("names a fixed site's one account, root", () => {
    expect(
      decideRotation({ box: boxNamed('findit.io'), journal: null, draw: DRAW, now: NOW }).accounts,
    ).toEqual(['root']);
  });
});
