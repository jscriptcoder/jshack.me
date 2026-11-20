import { describe, expect, it } from 'vitest';
import { mv } from './mv.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import { patchedBox } from '../../test/factories/patchedBox.js';
import { canBoot } from '../boot/bootFiles.js';
import { asAbsPath, type UserType } from '../types.js';
import type { CommandResult, TerminalLine } from './types.js';
import type { Directory, FilePermissions } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();

/** Terms no tier default would ever produce, so a move that restamped them shows. */
const ODD_FILE_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
const ODD_DIR_PERMS: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
};

/** A box alice stands on: her home holds her notes, a tool someone else installed
 *  on odd terms, a directory tree on odd terms, and a file only root may read. */
const aliceBox = (): Directory =>
  buildDirectory({
    boot: buildDirectory({
      vmlinuz: buildFile('kernel'),
      'initrd.img': buildFile('initrd'),
    }),
    etc: buildDirectory({ hosts: buildFile('127.0.0.1 localhost\n') }),
    tmp: buildDirectory({}, { perms: { write: ['root', 'user', 'guest'] } }),
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile('buy milk\n', { owner: 'alice' }),
          'todo.txt': buildFile('call mum\n', { owner: 'alice' }),
          'tool.sh': buildFile('#!/bin/sh\n', { owner: 'bob', perms: ODD_FILE_PERMS }),
          'sealed.txt': buildFile('root only\n', {
            owner: 'root',
            perms: { read: ['root'], write: ['root'], execute: [] },
          }),
          stash: buildDirectory(
            {
              'a.txt': buildFile('first\n', { owner: 'bob', perms: ODD_FILE_PERMS }),
              deeper: buildDirectory(
                { 'b.txt': buildFile('second\n', { owner: 'alice' }) },
                { owner: 'bob', perms: ODD_DIR_PERMS },
              ),
            },
            { owner: 'bob', perms: ODD_DIR_PERMS },
          ),
          empty: buildDirectory({}, { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const aliceAt = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly failingPaths?: readonly string[];
    readonly failingMkdirs?: readonly string[];
  } = {},
) =>
  patchedBox({
    tree: options.tree ?? aliceBox(),
    userType: options.userType ?? 'user',
    username: 'alice',
    cwd: '/home/alice',
    ...(options.failingPaths === undefined ? {} : { failingPaths: options.failingPaths }),
    ...(options.failingMkdirs === undefined ? {} : { failingMkdirs: options.failingMkdirs }),
  });

const run = async (box: ReturnType<typeof aliceAt>, args: readonly string[]) => {
  const result: CommandResult = await mv.execute(box.env, args, NO_FLAGS);
  if (result.kind !== 'sync') throw new Error(`expected a sync result, got ${result.kind}`);
  const errors = result.lines
    .filter((line: TerminalLine) => line.kind === 'error')
    .map((line) => line.content);
  return { exitCode: result.exitCode, errors };
};

const at = (path: string) => asAbsPath(path);

describe('mv renaming and moving', () => {
  it('renames a file, which keeps its owner and permissions', async () => {
    const box = aliceAt();

    const { exitCode, errors } = await run(box, ['tool.sh', 'helper.sh']);

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(box.view().stat(at('/home/alice/tool.sh'))).toBeNull();
    expect(box.view().stat(at('/home/alice/helper.sh'))).toMatchObject({
      kind: 'file',
      content: '#!/bin/sh\n',
      owner: 'bob',
      perms: ODD_FILE_PERMS,
    });
  });

  it('moves several files into a directory', async () => {
    const box = aliceAt();

    const { exitCode } = await run(box, ['notes.txt', 'todo.txt', '/tmp']);

    expect(exitCode).toBe(0);
    expect(box.view().list(at('/tmp'))).toEqual({ ok: true, entries: ['notes.txt', 'todo.txt'] });
    expect(box.view().stat(at('/home/alice/notes.txt'))).toBeNull();
  });

  it('moves a whole tree, every directory and file on its own terms', async () => {
    const box = aliceAt();

    const { exitCode } = await run(box, ['stash', '/tmp/hidden']);

    expect(exitCode).toBe(0);
    expect(box.view().stat(at('/home/alice/stash'))).toBeNull();
    expect(box.view().stat(at('/tmp/hidden'))).toMatchObject({
      owner: 'bob',
      perms: ODD_DIR_PERMS,
    });
    expect(box.view().stat(at('/tmp/hidden/deeper'))).toMatchObject({
      owner: 'bob',
      perms: ODD_DIR_PERMS,
    });
    expect(box.view().stat(at('/tmp/hidden/a.txt'))).toMatchObject({
      content: 'first\n',
      owner: 'bob',
      perms: ODD_FILE_PERMS,
    });
    expect(box.view().read(at('/tmp/hidden/deeper/b.txt'))).toEqual({
      ok: true,
      content: 'second\n',
    });
  });

  it('moves a file the shell cannot read, as a rename never opens it', async () => {
    const box = aliceAt();

    const { exitCode } = await run(box, ['sealed.txt', '/tmp']);

    expect(exitCode).toBe(0);
    expect(box.view().stat(at('/tmp/sealed.txt'))).toMatchObject({
      content: 'root only\n',
      owner: 'root',
    });
    expect(box.view().read(at('/tmp/sealed.txt'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  // Not the owner: a write over a file already standing never relabels it — the
  // journal's replay keeps the standing file's owner — and the label is all it is,
  // since tiers, not owners, decide who may touch a file.
  it('replaces an existing file with the moved one, content and permissions both', async () => {
    const box = aliceAt();

    await run(box, ['tool.sh', 'notes.txt']);

    expect(box.view().stat(at('/home/alice/notes.txt'))).toMatchObject({
      content: '#!/bin/sh\n',
      perms: ODD_FILE_PERMS,
    });
    expect(box.view().stat(at('/home/alice/tool.sh'))).toBeNull();
  });

  it('can move a moved file back where it was', async () => {
    const box = aliceAt();

    await run(box, ['notes.txt', '/tmp']);
    await run(box, ['/tmp/notes.txt', '/home/alice/']);

    expect(box.view().read(at('/home/alice/notes.txt'))).toEqual({
      ok: true,
      content: 'buy milk\n',
    });
    expect(box.view().stat(at('/tmp/notes.txt'))).toBeNull();
  });

  it('takes a kernel out of /boot, so the box no longer boots, and back in, so it does', async () => {
    const box = aliceAt({ userType: 'root' });

    await run(box, ['/boot/vmlinuz', '/tmp']);
    expect(canBoot(box.box())).toEqual({ ok: false, missing: 'vmlinuz' });

    await run(box, ['/tmp/vmlinuz', '/boot']);
    expect(canBoot(box.box())).toEqual({ ok: true });
  });
});

describe('mv refusing', () => {
  it('names a missing source', async () => {
    const { exitCode, errors } = await run(aliceAt(), ['ghost.txt', 'x.txt']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["mv: cannot stat 'ghost.txt': No such file or directory"]);
  });

  it('refuses to take a file out of a directory the shell cannot write', async () => {
    const box = aliceAt();

    const { exitCode, errors } = await run(box, ['/etc/hosts', '/tmp']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["mv: cannot move '/etc/hosts' to '/tmp/hosts': Permission denied"]);
    expect(box.view().stat(at('/tmp/hosts'))).toBeNull();
    expect(box.view().stat(at('/etc/hosts'))).not.toBeNull();
  });

  it('refuses to put a file into a directory the shell cannot write', async () => {
    const box = aliceAt();

    const { errors } = await run(box, ['notes.txt', '/etc']);

    expect(errors).toEqual(["mv: cannot move 'notes.txt' to '/etc/notes.txt': Permission denied"]);
    expect(box.view().stat(at('/home/alice/notes.txt'))).not.toBeNull();
  });

  it('refuses a destination whose directory does not exist', async () => {
    const { errors } = await run(aliceAt(), ['notes.txt', 'nowhere/notes.txt']);

    expect(errors).toEqual([
      "mv: cannot move 'notes.txt' to 'nowhere/notes.txt': No such file or directory",
    ]);
  });

  it('refuses several sources onto something that is not a directory', async () => {
    const box = aliceAt();

    const { errors } = await run(box, ['notes.txt', 'todo.txt', 'tool.sh']);

    expect(errors).toEqual(["mv: target 'tool.sh' is not a directory"]);
    expect(box.view().stat(at('/home/alice/notes.txt'))).not.toBeNull();
  });

  it('refuses to move a directory into its own subtree', async () => {
    const box = aliceAt();

    const { errors } = await run(box, ['stash', 'stash/deeper']);

    expect(errors).toEqual([
      "mv: cannot move 'stash' to a subdirectory of itself, 'stash/deeper/stash'",
    ]);
    expect(box.view().stat(at('/home/alice/stash/a.txt'))).not.toBeNull();
  });

  it('refuses a path onto itself', async () => {
    const { errors } = await run(aliceAt(), ['notes.txt', '/home/alice/notes.txt']);

    expect(errors).toEqual(["mv: 'notes.txt' and '/home/alice/notes.txt' are the same file"]);
  });

  it('refuses a file onto a directory of its name, and a directory onto a file', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('buy milk\n', { owner: 'alice' }),
            box: buildDirectory(
              { 'notes.txt': buildDirectory({}, { owner: 'alice' }) },
              { owner: 'alice' },
            ),
            stash: buildDirectory({}, { owner: 'alice' }),
            'stash.txt': buildFile('', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    expect((await run(aliceAt({ tree }), ['notes.txt', 'box'])).errors).toEqual([
      "mv: cannot overwrite directory 'box/notes.txt' with non-directory",
    ]);
    expect((await run(aliceAt({ tree }), ['stash', 'stash.txt'])).errors).toEqual([
      "mv: cannot overwrite non-directory 'stash.txt' with directory 'stash'",
    ]);
  });

  it('moves a directory over an empty one of its name, but not over one that holds files', async () => {
    const withStashAt = (inTmp: Directory) =>
      aliceAt({
        tree: buildDirectory({
          tmp: buildDirectory({ stash: inTmp }, { perms: { write: ['root', 'user', 'guest'] } }),
          home: buildDirectory({
            alice: buildDirectory(
              { stash: buildDirectory({ 'a.txt': buildFile('mine\n', { owner: 'alice' }) }) },
              { owner: 'alice' },
            ),
          }),
        }),
      });
    const ontoEmpty = withStashAt(buildDirectory({}, { owner: 'alice' }));
    const ontoFull = withStashAt(
      buildDirectory({ 'b.txt': buildFile('theirs\n', { owner: 'alice' }) }, { owner: 'alice' }),
    );

    expect((await run(ontoEmpty, ['stash', '/tmp'])).errors).toEqual([]);
    expect(ontoEmpty.view().read(at('/tmp/stash/a.txt'))).toEqual({ ok: true, content: 'mine\n' });

    expect((await run(ontoFull, ['stash', '/tmp'])).errors).toEqual([
      "mv: cannot move 'stash' to '/tmp/stash': Directory not empty",
    ]);
    expect(ontoFull.view().stat(at('/tmp/stash/a.txt'))).toBeNull();
    expect(ontoFull.view().stat(at('/home/alice/stash/a.txt'))).not.toBeNull();
  });

  it('asks for a source when given nothing, and for a destination when given one path', async () => {
    expect((await run(aliceAt(), [])).errors).toEqual(['mv: missing file operand']);
    expect((await run(aliceAt(), ['notes.txt'])).errors).toEqual([
      "mv: missing destination file operand after 'notes.txt'",
    ]);
  });

  it('carries on past a refused source and still fails the command', async () => {
    const box = aliceAt();

    const { exitCode } = await run(box, ['ghost.txt', 'notes.txt', '/tmp']);

    expect(exitCode).toBe(1);
    expect(box.view().stat(at('/tmp/notes.txt'))).not.toBeNull();
  });

  it('leaves the source whole when a write fails part-way through a tree', async () => {
    const box = aliceAt({ failingPaths: ['/tmp/hidden/deeper/b.txt'] });

    const { exitCode, errors } = await run(box, ['stash', '/tmp/hidden']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["mv: cannot move 'stash' to '/tmp/hidden': I/O error"]);
    expect(box.view().read(at('/home/alice/stash/deeper/b.txt'))).toEqual({
      ok: true,
      content: 'second\n',
    });
  });
});

describe('mv claiming new files', () => {
  it('claims what lands where nothing stood as new, and not a file it replaces', async () => {
    const box = aliceAt();

    await run(box, ['stash', '/tmp/hidden']);
    await run(box, ['todo.txt', 'notes.txt']);

    expect(box.claimedNew()).toEqual([
      '/tmp/hidden',
      '/tmp/hidden/a.txt',
      '/tmp/hidden/deeper',
      '/tmp/hidden/deeper/b.txt',
    ]);
  });
});

describe('mv refusing, further', () => {
  it('stops before the rest of a tree when a directory in it will not be created', async () => {
    const box = aliceAt({ failingMkdirs: ['/tmp/hidden/deeper'] });

    const { errors } = await run(box, ['stash', '/tmp/hidden']);

    expect(errors).toEqual(["mv: cannot move 'stash' to '/tmp/hidden': I/O error"]);
    expect(box.view().stat(at('/tmp/hidden/deeper'))).toBeNull();
    expect(box.view().stat(at('/home/alice/stash/deeper/b.txt'))).not.toBeNull();
  });

  it('refuses a destination beneath a file', async () => {
    const { errors } = await run(aliceAt(), ['todo.txt', 'notes.txt/todo.txt']);

    expect(errors).toEqual(["mv: cannot move 'todo.txt' to 'notes.txt/todo.txt': Not a directory"]);
  });

  it('refuses a file moved beneath itself the same way', async () => {
    const { errors } = await run(aliceAt(), ['notes.txt', 'notes.txt/x']);

    expect(errors).toEqual(["mv: cannot move 'notes.txt' to 'notes.txt/x': Not a directory"]);
  });
});
