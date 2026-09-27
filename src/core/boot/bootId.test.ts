import { describe, expect, it } from 'vitest';
import {
  BOOT_ID_OWNER,
  BOOT_ID_PATH,
  BOOT_ID_PERMISSIONS,
  readBootId,
} from './bootId';
import { canRead, canWrite } from '../filesystem/walker';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';

/**
 * The marker a reboot leaves on a box. Reading it is what tells a shell already
 * standing there that the machine went down, so the reader has to answer for every
 * shape of tree a client can be holding — including the ones that barely have a
 * filesystem in them at all.
 */

const treeWithMarker = (content: string) =>
  buildDirectory({
    var: buildDirectory({ run: buildDirectory({ 'boot-id': buildFile(content, { owner: 'root' }) }) }),
  });

describe('readBootId', () => {
  it('reads the id the box is carrying', () => {
    expect(readBootId(treeWithMarker('boot-9f2\n'))).toBe('boot-9f2');
  });

  // The file on the box ends in a newline like every other line this world writes,
  // and the comparison is against a bare id — so a marker that round-trips through
  // the journal must not stop matching the session that read it a moment earlier.
  it('ignores the newline the box wrote it with', () => {
    expect(readBootId(treeWithMarker('boot-9f2'))).toBe('boot-9f2');
    expect(readBootId(treeWithMarker('  boot-9f2  \n'))).toBe('boot-9f2');
  });

  it('answers that a box with no marker has never rebooted', () => {
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'sshd.pid': buildFile('sshd:port=22') }) }),
    });

    expect(readBootId(tree)).toBeNull();
  });

  // An empty marker is not an id, and must read as the absence of one. Handing back
  // `''` would leave it unequal to the `null` a session recorded from the same box a
  // moment earlier, and evict a player over a file that says nothing.
  it('treats an empty marker as no marker rather than as an id', () => {
    expect(readBootId(treeWithMarker(''))).toBeNull();
    expect(readBootId(treeWithMarker('\n'))).toBeNull();
    expect(readBootId(treeWithMarker('   '))).toBeNull();
  });

  /**
   * The trees this is asked about are not always whole boxes. The reader who most
   * needs the marker holds no session — their rows were just closed — so what comes
   * back to them is pruned to the externally-observable allowlist, and a box with
   * nothing observable on it arrives with no `/var` in it at all. Answering that
   * with a crash would take down the shell on every line rather than the session.
   */
  it('answers about a tree that barely has a filesystem in it', () => {
    expect(readBootId(buildDirectory({}))).toBeNull();
    expect(readBootId(buildDirectory({ var: buildDirectory({}) }))).toBeNull();
    expect(readBootId(buildDirectory({ etc: buildDirectory({ passwd: buildFile('x') }) }))).toBeNull();
  });

  it('is not fooled by something that is not a file where the marker goes', () => {
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'boot-id': buildDirectory({}) }) }),
    });

    expect(readBootId(tree)).toBeNull();
  });

  it('is not fooled by a plain file where /var or /var/run should be', () => {
    expect(readBootId(buildDirectory({ var: buildFile('not a directory') }))).toBeNull();
    expect(
      readBootId(buildDirectory({ var: buildDirectory({ run: buildFile('not a directory') }) })),
    ).toBeNull();
  });
});

/**
 * Both halves of the marker's permissions are load-bearing, and in opposite
 * directions. It has to be readable by someone holding nothing, or the reboot that
 * closed their rows cannot reach their screen. It has to be writable only by root,
 * or a player who merely holds a user-tier shell could plant an id and convince
 * every other session on the box that it had gone down.
 */
describe('the marker the whole mechanism reads', () => {
  it('is readable at every tier, including one holding no session', () => {
    expect(canRead('guest', BOOT_ID_PERMISSIONS, []).allowed).toBe(true);
    expect(canRead('user', BOOT_ID_PERMISSIONS, []).allowed).toBe(true);
    expect(canRead('root', BOOT_ID_PERMISSIONS, []).allowed).toBe(true);
  });

  it('is writable by root alone, so a reboot cannot be forged from a user shell', () => {
    expect(canWrite('guest', BOOT_ID_PERMISSIONS, []).allowed).toBe(false);
    expect(canWrite('user', BOOT_ID_PERMISSIONS, []).allowed).toBe(false);
    expect(canWrite('root', BOOT_ID_PERMISSIONS, []).allowed).toBe(true);
  });

  it('is the system’s file, at the path that says what it is', () => {
    expect(BOOT_ID_OWNER).toBe('root');
    expect(BOOT_ID_PATH).toBe('/var/run/boot-id');
  });
});
