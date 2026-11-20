import { describe, expect, it } from 'vitest';
import { cp } from './cp.js';
import { runCommandLine } from '../shell/runLine.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import { patchedBox } from '../../test/factories/patchedBox.js';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../filesystem/defaultPermissions.js';
import { asAbsPath, type UserType } from '../types.js';
import type { CommandResult, TerminalLine } from './types.js';
import type { Directory } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();

const PASSWD = 'root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000::/home/alice:/bin/bash\n';
const SHARED_PERMS = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
} as const;
const BACKUP_SCRIPT = '#!/bin/sh\ntar czf /tmp/home.tgz /home\n';

/** A box alice stands on as a `user`: a root-owned `/etc/passwd` everyone reads and
 *  only root writes, a root script everyone may run, and her own home. */
const aliceBox = (): Directory =>
  buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(PASSWD, {
        owner: 'root',
        perms: { read: ['root', 'user', 'guest'], write: ['root'] },
      }),
    }),
    usr: buildDirectory({
      local: buildDirectory({
        bin: buildDirectory({
          'backup.sh': buildFile(BACKUP_SCRIPT, {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], execute: ['root', 'user', 'guest'] },
          }),
        }),
      }),
    }),
    tmp: buildDirectory({}, { perms: { write: ['root', 'user', 'guest'] } }),
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile('buy milk\n', { owner: 'alice' }),
          'todo.txt': buildFile('call mum\n', { owner: 'alice' }),
          docs: buildDirectory(
            {
              'a.txt': buildFile('first\n', { owner: 'alice' }),
              sub: buildDirectory(
                { 'b.txt': buildFile('second\n', { owner: 'alice' }) },
                { owner: 'alice' },
              ),
            },
            { owner: 'alice' },
          ),
          // Someone else's file alice may write: an overwrite must leave it theirs, on
          // the terms they set.
          'shared.txt': buildFile('old\n', { owner: 'bob', perms: SHARED_PERMS }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const aliceAt = (options: { readonly tree?: Directory; readonly userType?: UserType } = {}) =>
  patchedBox({
    tree: options.tree ?? aliceBox(),
    userType: options.userType ?? 'user',
    username: 'alice',
    cwd: '/home/alice',
  });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error(`expected a sync result, got ${result.kind}`);
  return result;
};

const errorLines = (lines: readonly TerminalLine[]): readonly string[] =>
  lines.filter((line) => line.kind === 'error').map((line) => line.content);

describe('cp copying a file', () => {
  it("lands the copy as the copier's own file, which they can edit though the source is root's", async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['/etc/passwd', 'passwd.bak'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(errorLines(result.lines)).toEqual([]);
    const copy = view().stat(asAbsPath('/home/alice/passwd.bak'));
    expect(copy).toMatchObject({ kind: 'file', content: PASSWD, owner: 'alice' });
    expect(view().canWrite(asAbsPath('/home/alice/passwd.bak')).allowed).toBe(true);
    expect(view().read(asAbsPath('/etc/passwd'))).toEqual({ ok: true, content: PASSWD });
  });

  it('gives the copy the tier defaults, so a copied script is not executable until chmod', async () => {
    const { env, view } = aliceAt();

    sync(await cp.execute(env, ['/usr/local/bin/backup.sh', 'backup.sh'], NO_FLAGS));

    expect(view().stat(asAbsPath('/home/alice/backup.sh'))?.perms).toEqual(
      defaultFilePermissions('user'),
    );
  });
});

describe('cp into a directory', () => {
  it('copies into an existing directory under the source name', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['notes.txt', '/tmp'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(view().read(asAbsPath('/tmp/notes.txt'))).toEqual({
      ok: true,
      content: 'buy milk\n',
    });
  });

  it('copies several sources into one directory, trailing slash or not', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['notes.txt', 'todo.txt', '/tmp/'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(view().list(asAbsPath('/tmp'))).toEqual({
      ok: true,
      entries: ['notes.txt', 'todo.txt'],
    });
  });
});

describe('cp onto an existing file', () => {
  it('replaces the content and leaves the file its owner and permissions', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['notes.txt', 'shared.txt'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(view().stat(asAbsPath('/home/alice/shared.txt'))).toMatchObject({
      content: 'buy milk\n',
      owner: 'bob',
      perms: SHARED_PERMS,
    });
  });
});

describe('cp refusing', () => {
  const refusal = async (args: readonly string[], tree?: Directory) => {
    const { env, view } = aliceAt(tree === undefined ? {} : { tree });
    const result = sync(await cp.execute(env, args, NO_FLAGS));
    return { exitCode: result.exitCode, errors: errorLines(result.lines), view };
  };

  it('names a missing source and writes nothing', async () => {
    const { exitCode, errors, view } = await refusal(['ghost.txt', 'copy.txt']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: cannot stat 'ghost.txt': No such file or directory"]);
    expect(view().stat(asAbsPath('/home/alice/copy.txt'))).toBeNull();
  });

  it('refuses a source the shell cannot read', async () => {
    const tree = buildDirectory({
      root: buildDirectory({ 'loot.txt': buildFile('gold\n', { owner: 'root' }) }),
      home: buildDirectory({ alice: buildDirectory({}, { owner: 'alice' }) }),
    });

    const { exitCode, errors, view } = await refusal(['/root/loot.txt', 'loot.txt'], tree);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: cannot open '/root/loot.txt' for reading: Permission denied"]);
    expect(view().stat(asAbsPath('/home/alice/loot.txt'))).toBeNull();
  });

  it('refuses a new file in a directory the shell cannot write, named as it would land', async () => {
    const { exitCode, errors, view } = await refusal(['notes.txt', '/etc']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: cannot create regular file '/etc/notes.txt': Permission denied"]);
    expect(view().stat(asAbsPath('/etc/notes.txt'))).toBeNull();
  });

  it('refuses to overwrite a file the shell cannot write', async () => {
    const { exitCode, errors, view } = await refusal(['notes.txt', '/etc/passwd']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: cannot create regular file '/etc/passwd': Permission denied"]);
    expect(view().read(asAbsPath('/etc/passwd'))).toEqual({ ok: true, content: PASSWD });
  });

  it('refuses a destination whose directory does not exist', async () => {
    const { exitCode, errors } = await refusal(['notes.txt', 'nowhere/notes.txt']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      "cp: cannot create regular file 'nowhere/notes.txt': No such file or directory",
    ]);
  });

  it('refuses several sources onto something that is not a directory, writing none', async () => {
    const { exitCode, errors, view } = await refusal(['notes.txt', 'todo.txt', 'shared.txt']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: target 'shared.txt' is not a directory"]);
    expect(view().read(asAbsPath('/home/alice/shared.txt'))).toEqual({
      ok: true,
      content: 'old\n',
    });
  });

  it('refuses to copy a file onto itself', async () => {
    const { exitCode, errors } = await refusal(['notes.txt', '/home/alice/notes.txt']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: 'notes.txt' and '/home/alice/notes.txt' are the same file"]);
  });

  it('asks for a source when given nothing, and for a destination when given one path', async () => {
    expect((await refusal([])).errors).toEqual(['cp: missing file operand']);
    expect((await refusal(['notes.txt'])).errors).toEqual([
      "cp: missing destination file operand after 'notes.txt'",
    ]);
  });

  it('carries on past a refused source and still fails the command', async () => {
    const { exitCode, errors, view } = await refusal(['ghost.txt', 'notes.txt', '/tmp']);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["cp: cannot stat 'ghost.txt': No such file or directory"]);
    expect(view().read(asAbsPath('/tmp/notes.txt'))).toEqual({ ok: true, content: 'buy milk\n' });
  });
});

describe('cp with directories', () => {
  const RECURSIVE = new Map<string, string | true>([['-r', true]]);
  const RECURSIVE_UPPER = new Map<string, string | true>([['-R', true]]);

  it('omits a directory without -r', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', 'backup'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result.lines)).toEqual(["cp: -r not specified; omitting directory 'docs'"]);
    expect(view().stat(asAbsPath('/home/alice/backup'))).toBeNull();
  });

  it('copies the whole tree under a new name with -r, every directory owned by the copier', async () => {
    const { env, view } = aliceAt({ userType: 'user' });

    const result = sync(await cp.execute(env, ['docs', 'backup'], RECURSIVE));

    expect(result.exitCode).toBe(0);
    expect(view().read(asAbsPath('/home/alice/backup/a.txt'))).toEqual({
      ok: true,
      content: 'first\n',
    });
    expect(view().read(asAbsPath('/home/alice/backup/sub/b.txt'))).toEqual({
      ok: true,
      content: 'second\n',
    });
    expect(view().stat(asAbsPath('/home/alice/backup/sub'))).toMatchObject({
      kind: 'directory',
      owner: 'alice',
      perms: defaultDirectoryPermissions('user'),
    });
  });

  it('copies a tree into an existing directory with -R', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', '/tmp'], RECURSIVE_UPPER));

    expect(result.exitCode).toBe(0);
    expect(view().read(asAbsPath('/tmp/docs/sub/b.txt'))).toEqual({
      ok: true,
      content: 'second\n',
    });
  });

  it('refuses to copy a directory into itself', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', 'docs/sub'], RECURSIVE));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result.lines)).toEqual([
      "cp: cannot copy a directory, 'docs', into itself, 'docs/sub/docs'",
    ]);
    expect(view().stat(asAbsPath('/home/alice/docs/sub/docs'))).toBeNull();
  });

  it('refuses a directory onto a file', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', 'notes.txt'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot overwrite non-directory 'notes.txt' with directory 'docs'",
    ]);
  });

  it('refuses a tree in a directory the shell cannot write', async () => {
    const { env, view } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', '/etc'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot create directory '/etc/docs': Permission denied",
    ]);
    expect(view().stat(asAbsPath('/etc/docs'))).toBeNull();
  });

  it('copies what it can of a tree and names each file it could not read', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            stash: buildDirectory(
              {
                'mine.txt': buildFile('mine\n', { owner: 'alice' }),
                'roots.txt': buildFile('theirs\n', { owner: 'root' }),
              },
              { owner: 'alice' },
            ),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const { env, view } = aliceAt({ tree });

    const result = sync(await cp.execute(env, ['stash', 'copy'], RECURSIVE));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result.lines)).toEqual([
      "cp: cannot open 'stash/roots.txt' for reading: Permission denied",
    ]);
    expect(view().read(asAbsPath('/home/alice/copy/mine.txt'))).toEqual({
      ok: true,
      content: 'mine\n',
    });
    expect(view().stat(asAbsPath('/home/alice/copy/roots.txt'))).toBeNull();
  });
});

describe('cp and a directory the shell cannot list', () => {
  it('refuses to open it, so no name inside it leaks and nothing is created', async () => {
    const tree = buildDirectory({
      root: buildDirectory(
        {
          'plans.txt': buildFile('take over\n', {
            owner: 'root',
            perms: { read: ['root', 'guest'] },
          }),
        },
        { perms: { read: ['root'], execute: ['root'] } },
      ),
      tmp: buildDirectory({}, { perms: { write: ['root', 'user', 'guest'] } }),
    });
    const { env, view } = patchedBox({ tree, userType: 'guest', username: 'guest', cwd: '/tmp' });

    const result = sync(await cp.execute(env, ['/root', 'loot'], new Map([['-r', true]])));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result.lines)).toEqual([
      "cp: cannot open directory '/root': Permission denied",
    ]);
    expect(view().stat(asAbsPath('/tmp/loot'))).toBeNull();
  });
});

describe('cp typed at the shell', () => {
  it('reads -r and -R off the line', async () => {
    const box = aliceAt();
    const commands = new Map([['cp', cp]]);

    sync(await runCommandLine(box.env, 'cp -r docs backup', commands));
    sync(await runCommandLine(box.env, 'cp -R docs /tmp', commands));

    expect(box.view().read(asAbsPath('/home/alice/backup/sub/b.txt'))).toEqual({
      ok: true,
      content: 'second\n',
    });
    expect(box.view().read(asAbsPath('/tmp/docs/a.txt'))).toEqual({ ok: true, content: 'first\n' });
  });
});

describe('cp claiming new files', () => {
  it('claims every file and directory it creates as new, and no file it overwrites', async () => {
    const box = aliceAt();

    sync(await cp.execute(box.env, ['notes.txt', 'copy.txt'], NO_FLAGS));
    sync(await cp.execute(box.env, ['todo.txt', 'shared.txt'], NO_FLAGS));
    sync(await cp.execute(box.env, ['docs', 'backup'], new Map([['-r', true]])));

    expect(box.claimedNew()).toEqual([
      '/home/alice/backup',
      '/home/alice/backup/a.txt',
      '/home/alice/backup/sub',
      '/home/alice/backup/sub/b.txt',
      '/home/alice/copy.txt',
    ]);
  });
});

describe('cp refusing, further', () => {
  const RECURSIVE = new Map<string, string | true>([['-r', true]]);

  it('refuses a tree whose landing directory has no parent', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', 'nowhere/backup'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot create directory 'nowhere/backup': No such file or directory",
    ]);
  });

  it('stops a tree whose directory the server would not create', async () => {
    const box = patchedBox({
      tree: aliceBox(),
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
      failingMkdirs: ['/home/alice/backup'],
    });

    const result = sync(await cp.execute(box.env, ['docs', 'backup'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual(["cp: cannot create directory 'backup': I/O error"]);
    expect(box.view().stat(asAbsPath('/home/alice/backup/a.txt'))).toBeNull();
  });

  it('merges a tree into a directory already standing, asking about each file in it', async () => {
    const standing = buildDirectory({
      'a.txt': buildFile('roots\n', { owner: 'root', perms: { read: ['root', 'user'] } }),
    });
    const tree = buildDirectory({
      tmp: buildDirectory({ docs: standing }, { perms: { write: ['root', 'user', 'guest'] } }),
      home: aliceBox().entries.get('home') ?? buildDirectory(),
    });
    const box = aliceAt({ tree });

    const result = sync(await cp.execute(box.env, ['docs', '/tmp'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot create regular file '/tmp/docs/a.txt': Permission denied",
      "cp: cannot create directory '/tmp/docs/sub': Permission denied",
    ]);
    expect(box.view().read(asAbsPath('/tmp/docs/a.txt'))).toEqual({ ok: true, content: 'roots\n' });
    // Merging into a directory is not re-creating it: a `mkdir` row over one standing
    // replays as a permission change, and would quietly reset what it allows.
    expect(box.view().stat(asAbsPath('/tmp/docs'))?.perms).toEqual(standing.perms);
  });

  it('refuses a file onto a directory of its name', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('buy milk\n', { owner: 'alice' }),
            box: buildDirectory(
              { 'notes.txt': buildDirectory({}, { owner: 'alice' }) },
              { owner: 'alice' },
            ),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const { env } = aliceAt({ tree });

    const result = sync(await cp.execute(env, ['notes.txt', 'box'], NO_FLAGS));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot overwrite directory 'box/notes.txt' with non-directory",
    ]);
  });

  it('names a missing source even when the destination is the same path', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['ghost.txt', 'ghost.txt'], NO_FLAGS));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot stat 'ghost.txt': No such file or directory",
    ]);
  });

  it('names a refused landing under a destination typed with a trailing slash', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['notes.txt', '/etc/'], NO_FLAGS));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot create regular file '/etc/notes.txt': Permission denied",
    ]);
  });

  it('calls a directory copied onto its own path the same file', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['docs', '.'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual(["cp: 'docs' and './docs' are the same file"]);
  });

  it('refuses to copy the whole box into a corner of itself', async () => {
    const { env } = aliceAt();

    const result = sync(await cp.execute(env, ['/', '/tmp/everything'], RECURSIVE));

    expect(errorLines(result.lines)).toEqual([
      "cp: cannot copy a directory, '/', into itself, '/tmp/everything'",
    ]);
  });
});
