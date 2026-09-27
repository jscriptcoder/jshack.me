import { describe, expect, it, vi } from 'vitest';
import { chmod } from './chmod';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath, type UserType } from '../types';
import type { CommandEnv, PatchApi, TerminalLine } from './types';
import type { Directory, FilePermissions } from '../filesystem/types';

const NO_FLAGS = new Map<string, string | true>();

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** A box holding one file the lower tiers cannot open. `/etc/shadow` is the
 *  canonical example and the one a player reaches for first: root-readable,
 *  root-writable, invisible to everyone else. */
const boxWithASecret = (): Directory =>
  buildDirectory({
    etc: buildDirectory({
      shadow: buildFile('root:$1$saltysalt$hash:19000:0:99999:7:::\n', {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: [] },
      }),
    }),
  });

const chmodEnv = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly username?: string;
    readonly cwd?: string;
    /** The tree the machine answers with when the command re-reads it. Absent,
     *  a reload hands back the same tree — a box nobody else is writing. */
    readonly reloadTo?: Directory;
  } = {},
): {
  readonly env: CommandEnv;
  readonly writeFn: ReturnType<typeof vi.fn>;
  readonly setDirPermsFn: ReturnType<typeof vi.fn>;
} => {
  const writeFn = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
  const setDirPermsFn = vi.fn<PatchApi['setDirectoryPermissions']>(async () => ({ ok: true }));
  const reloaded = options.reloadTo;
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(options.tree ?? boxWithASecret(), {
      userType: options.userType ?? 'root',
      cwd: asAbsPath(options.cwd ?? '/'),
      ...(reloaded === undefined ? {} : { onReload: async () => reloaded }),
    }),
    session: mockSession({
      username: options.username ?? 'root',
      userType: options.userType ?? 'root',
    }),
    patches: {
      write: writeFn,
      remove: async () => ({ ok: true }),
      mkdir: async () => ({ ok: true }),
      setDirectoryPermissions: setDirPermsFn,
    },
  });
  return { env, writeFn, setDirPermsFn };
};

/** Replay the patch the command actually sent over the tree it was given.
 *
 *  A test that asserted on the permissions ARRAY the command passed would pass
 *  just as happily for a chmod whose patch never reaches the machine, and would
 *  say nothing about whether the WALKER agrees with the new arrays — which is
 *  the only thing the player experiences. Folding the real patch through the
 *  real materializer and then asking the real view closes both gaps. */
const treeAfterWrite = (tree: Directory, writeFn: ReturnType<typeof vi.fn>): Directory => {
  const [path, content, patchOptions] = writeFn.mock.calls[0] as Parameters<PatchApi['write']>;
  const patch: Patch = {
    path,
    content,
    owner: patchOptions?.owner ?? 'root',
    ...(patchOptions?.permissions ? { permissions: patchOptions.permissions } : {}),
  };
  return applyPatches(tree, [patch]);
};

const readAs = (tree: Directory, userType: UserType, path: string) =>
  createFsView(tree, { userType }).read(asAbsPath(path));

describe('chmod — a file opens to a tier that could not read it', () => {
  it('lets the guest tier read a root-only file after chmod o+r', async () => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    // The precondition is half the test: without it, an implementation that
    // widened nothing at all would still satisfy the assertion below on a tree
    // that had been readable all along.
    expect(readAs(tree, 'guest', '/etc/shadow').ok).toBe(false);

    const result = await chmod.execute(env, ['o+r', '/etc/shadow'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
    // Silent on success, as every Unix chmod is.
    expect(result.lines).toEqual([]);

    const opened = readAs(treeAfterWrite(tree, writeFn), 'guest', '/etc/shadow');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // The content rides along untouched: a permission change that rewrote the
    // file would be a data-loss bug wearing a chmod's clothes.
    expect(opened.content).toBe('root:$1$saltysalt$hash:19000:0:99999:7:::\n');
  });

  it('leaves write and execute alone when only the read bit was asked for', async () => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['o+r', '/etc/shadow'], NO_FLAGS);

    const after = treeAfterWrite(tree, writeFn);
    const node = createFsView(after, { userType: 'root' }).stat(asAbsPath('/etc/shadow'));
    expect(node?.perms.read).toContain('guest');
    // `o+r` says one thing about one operation. A mode parser that applied the
    // change to every list would hand the guest tier write access to the
    // password file, which is the opposite of what the player typed.
    expect(node?.perms.write).not.toContain('guest');
    expect(node?.perms.execute).not.toContain('guest');
  });
});

/** One file, wide open, so a mode string can only ever NARROW it — the shape
 *  that makes a `-` test say something. Owned by alice at the user tier. */
const boxWithAnOpenFile = (): Directory =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile('the safe combination is 12-24-36\n', {
            owner: 'alice',
            perms: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user', 'guest'],
              execute: ['root', 'user', 'guest'],
            },
          }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const permsAfter = (
  tree: Directory,
  writeFn: ReturnType<typeof vi.fn>,
  path: string,
): FilePermissions | undefined =>
  createFsView(treeAfterWrite(tree, writeFn), { userType: 'root' }).stat(asAbsPath(path))?.perms;

describe('chmod — which tiers a mode string names', () => {
  it('gives g the user tier and o the guest tier, exactly as ls -l orders them', async () => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['g+w', '/etc/shadow'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/etc/shadow');
    // The two letters have to be distinguishable from each other. A parser that
    // mapped both to the same tier would pass any test that only ever asked
    // about one of them.
    expect(perms?.write).toContain('user');
    expect(perms?.write).not.toContain('guest');
  });

  it('gives a all three tiers, and applies every permission letter asked for', async () => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['a+rx', '/etc/shadow'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/etc/shadow');
    expect(perms?.read).toEqual(expect.arrayContaining(['root', 'user', 'guest']));
    expect(perms?.execute).toEqual(expect.arrayContaining(['root', 'user', 'guest']));
    // Two letters were named and a third was not: `w` stays where it was.
    expect(perms?.write).not.toContain('guest');
  });

  it('treats a bare +x as a, the way every chmod does', async () => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['+x', '/etc/shadow'], NO_FLAGS);

    expect(permsAfter(tree, writeFn, '/etc/shadow')?.execute).toEqual(
      expect.arrayContaining(['root', 'user', 'guest']),
    );
  });

  it('takes away with - what + would have given', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['o-r', 'notes.txt'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/home/alice/notes.txt');
    expect(perms?.read).not.toContain('guest');
    // The tier that was not named keeps what it had, in the list that WAS
    // named — otherwise a lockdown would be indistinguishable from a reset.
    expect(perms?.read).toContain('user');
  });

  it('locks a file down to its owner with one go-rwx', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['go-rwx', 'notes.txt'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/home/alice/notes.txt');
    // Multiple who letters and multiple permission letters in one string: the
    // combination is the point, since it is how a player actually locks a file.
    expect(perms?.read).toEqual(['root']);
    expect(perms?.write).toEqual(['root']);
    expect(perms?.execute).toEqual(['root']);
  });
});

/** A box whose four files are owned by four different kinds of owner, and whose
 *  `/etc/passwd` names three of them. `u` has to answer differently for each.
 *
 *  Each file starts with the tier `u` should resolve to MISSING from the list
 *  under test, so a `u+…` that resolved to the wrong tier — or to all of them —
 *  is visible rather than absorbed by a permission that was already there. */
const boxWithFourOwners = (): Directory =>
  buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(
        'root:x:0:0:root:/root:/bin/bash\n' +
          'alice:x:1000:1000::/home/alice:/bin/bash\n' +
          'guest:x:1001:1001::/home/guest:/bin/sh\n',
      ),
      // Root-owned, and root is the one tier NOT in its read list — contrived,
      // and the only way to see `u` reach root at all, since root passes the
      // walker without consulting a single array.
      oddity: buildFile('kept for the shape of it\n', {
        owner: 'root',
        perms: { read: ['user'], write: ['root'], execute: [] },
      }),
    }),
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile('mine\n', {
            owner: 'alice',
            perms: { read: ['root'], write: ['root'], execute: [] },
          }),
        },
        { owner: 'alice' },
      ),
    }),
    tmp: buildDirectory({
      scratch: buildFile('anyone can leave something here\n', {
        owner: 'guest',
        perms: { read: ['root'], write: ['root'], execute: [] },
      }),
    }),
    var: buildDirectory({
      run: buildDirectory({
        // Owned by a service account that owns files but holds no account row —
        // `mysql` and `redis` are stamped as owners by the generators and never
        // appear in any `/etc/passwd`.
        'mysqld.pid': buildFile('4127\n', {
          owner: 'mysql',
          perms: { read: ['root'], write: ['root'], execute: [] },
        }),
      }),
    }),
  });

describe('chmod — u is the tier of the account that owns the node', () => {
  it('resolves u to the user tier for a file owned by the box user', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u+r', '/home/alice/notes.txt'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/home/alice/notes.txt');
    expect(perms?.read).toContain('user');
    expect(perms?.read).not.toContain('guest');
  });

  it('resolves u to root for a root-owned file', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u+r', '/etc/oddity'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/etc/oddity');
    expect(perms?.read).toContain('root');
    expect(perms?.read).not.toContain('guest');
  });

  it('resolves u to the guest tier for a file owned by the guest account', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u+w', '/tmp/scratch'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/tmp/scratch');
    expect(perms?.write).toContain('guest');
    expect(perms?.write).not.toContain('user');
  });

  it('treats an owner with no account row as an other', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u+r', '/var/run/mysqld.pid'], NO_FLAGS);

    // `mysql` owns the file but is nobody on this box. An owner that holds no
    // account is an outsider like any other, which keeps `u` answerable on
    // every node rather than only on the ones a person owns.
    const perms = permsAfter(tree, writeFn, '/var/run/mysqld.pid');
    expect(perms?.read).toContain('guest');
    expect(perms?.read).not.toContain('user');
  });

  it('reads the owner from the node, not from whoever is running the command', async () => {
    const tree = boxWithFourOwners();
    // Root is at the prompt; the file belongs to alice. If `u` meant "me", this
    // would widen to root — which root already has — and the guest-tier read
    // below would stay shut for the wrong reason.
    const { env, writeFn } = chmodEnv({ tree, userType: 'root', username: 'root' });

    await chmod.execute(env, ['u+r', '/home/alice/notes.txt'], NO_FLAGS);

    expect(permsAfter(tree, writeFn, '/home/alice/notes.txt')?.read).toContain('user');
  });
});

describe('chmod — what the grammar refuses', () => {
  it.each([
    ['644', 'octal, which this permission model has no bits for'],
    ['755', 'octal again, and the one a player types out of habit'],
    ['a+q', 'a permission letter that names no operation'],
    ['a+', 'an operator with nothing after it'],
    ['+', 'an operator with nothing on either side'],
    ['rwx', 'permissions with no operator at all'],
    ['o=r', 'the = form real chmod has and this one does not'],
    ['x+r', 'a who letter that is not one of ugoa'],
  ])('refuses %s — %s', async (mode) => {
    const tree = boxWithASecret();
    const { env, writeFn } = chmodEnv({ tree });

    const result = await chmod.execute(env, [mode, '/etc/shadow'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual([`chmod: invalid mode: '${mode}'`]);
    expect(result.exitCode).toBe(1);
    // A refusal that still wrote would be the worst of both answers: the player
    // is told nothing happened while the machine says otherwise.
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('says which mode it did not understand, so a typo is visible', async () => {
    const { env } = chmodEnv();

    const result = await chmod.execute(env, ['a+rwz', '/etc/shadow'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The mode is echoed back as typed. `a+rw` would be valid and `a+rwz` is
    // not, and the difference is one character a player will not find unaided.
    expect(errorLines(result)).toEqual(["chmod: invalid mode: 'a+rwz'"]);
  });
});

describe('chmod — the root tier survives every removal', () => {
  it('keeps root when a-rwx strips everyone else', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['a-rwx', 'notes.txt'], NO_FLAGS);

    const perms = permsAfter(tree, writeFn, '/home/alice/notes.txt');
    // `canRead` and `canWrite` answer ALLOWED for root before they look at a
    // single array, so a cleared root bit takes nothing away — it only makes
    // `ls -l` print a lie about who can reach the file. The lists stay honest.
    expect(perms?.read).toEqual(['root']);
    expect(perms?.write).toEqual(['root']);
    expect(perms?.execute).toEqual(['root']);
  });

  it('keeps root when u names it on a root-owned file', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u-w', '/etc/oddity'], NO_FLAGS);

    // `u` resolves to root here, so this is the same rule reached by the other
    // letter — the guard belongs to the removal, not to the character 'a'.
    expect(permsAfter(tree, writeFn, '/etc/oddity')?.write).toContain('root');
  });

  it('still takes the tier away from everyone the removal actually names', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['a-w', 'notes.txt'], NO_FLAGS);

    // The guard is narrow: root is exempt, nobody else is. A removal that
    // protected everything would be a chmod that cannot lock a file.
    const perms = permsAfter(tree, writeFn, '/home/alice/notes.txt');
    expect(perms?.write).toEqual(['root']);
    expect(perms?.read).toEqual(expect.arrayContaining(['user', 'guest']));
  });
});

/** A file every tier may READ and only root may WRITE — the shape that tells
 *  the two refusals apart. On a root-only file both checks would fire, and a
 *  test could not say which one the command actually made. */
const boxWithAReadOnlyFile = (): Directory =>
  buildDirectory({
    etc: buildDirectory({
      motd: buildFile('welcome to the box\n', {
        owner: 'root',
        perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
      }),
    }),
  });

describe('chmod — whoever may write the node may chmod it', () => {
  it.each(['user', 'guest'] as const)(
    'refuses a %s-tier session on a file only root may write',
    async (userType) => {
      const tree = boxWithAReadOnlyFile();
      const { env, writeFn } = chmodEnv({ tree, userType, username: 'alice' });

      const result = await chmod.execute(env, ['o+w', '/etc/motd'], NO_FLAGS);

      expect(result.kind).toBe('sync');
      if (result.kind !== 'sync') return;
      expect(errorLines(result)).toEqual([
        "chmod: changing permissions of '/etc/motd': Operation not permitted",
      ]);
      expect(result.exitCode).toBe(1);
      // The refusal has to happen BEFORE the patch, not be discovered by the
      // server afterwards: a write that left and came back denied would still
      // have told another player's box that someone is poking at it.
      expect(writeFn).not.toHaveBeenCalled();
    },
  );

  it('lets root through on the same file', async () => {
    const tree = boxWithAReadOnlyFile();
    const { env, writeFn } = chmodEnv({ tree });

    const result = await chmod.execute(env, ['o+w', '/etc/motd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('lets a player chmod a file they own, which is the ordinary case', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    const result = await chmod.execute(env, ['go-r', 'notes.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('reports the path as the player typed it', async () => {
    const tree = boxWithAReadOnlyFile();
    const { env } = chmodEnv({ tree, userType: 'user', username: 'alice', cwd: '/etc' });

    const result = await chmod.execute(env, ['o+w', 'motd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // A relative argument comes back relative. Resolving it in the message
    // would read as the shell being somewhere the player did not expect.
    expect(errorLines(result)).toEqual([
      "chmod: changing permissions of 'motd': Operation not permitted",
    ]);
  });
});

/** A file the user tier may WRITE but may not READ. Rare, and the only shape
 *  that reaches the refusal below: everywhere else, a caller that cannot read
 *  cannot write either, and the authorization check answers first. */
const boxWithAWriteOnlyFile = (): Directory =>
  buildDirectory({
    etc: buildDirectory({
      dropbox: buildFile('secrets nobody may read back\n', {
        owner: 'root',
        perms: { read: ['root'], write: ['root', 'user'], execute: [] },
      }),
    }),
  });

describe('chmod — a file it cannot read', () => {
  it('refuses rather than rewriting content it was never shown', async () => {
    const tree = boxWithAWriteOnlyFile();
    const { env, writeFn } = chmodEnv({ tree, userType: 'user', username: 'alice' });

    const result = await chmod.execute(env, ['o+r', '/etc/dropbox'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The change travels as a whole-file write carrying the same content, so a
    // caller who cannot see the content cannot compose one. Guessing at it —
    // writing an empty string, say — would silently destroy the file.
    expect(errorLines(result)).toEqual(["chmod: cannot access '/etc/dropbox': Permission denied"]);
    expect(result.exitCode).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('never bites root, which reads everything', async () => {
    const tree = boxWithAWriteOnlyFile();
    const { env, writeFn } = chmodEnv({ tree });

    const result = await chmod.execute(env, ['o+r', '/etc/dropbox'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('never bites a player on their own file', async () => {
    const tree = boxWithAnOpenFile();
    const { env } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    const result = await chmod.execute(env, ['o+r', 'notes.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
  });
});

const writeOptions = (writeFn: ReturnType<typeof vi.fn>) =>
  (writeFn.mock.calls[0] as Parameters<PatchApi['write']>)[2];

describe('chmod — what the write carries', () => {
  it('leaves the file belonging to whoever owned it', async () => {
    const tree = boxWithFourOwners();
    const { env, writeFn } = chmodEnv({ tree });

    await chmod.execute(env, ['g+r', '/home/alice/notes.txt'], NO_FLAGS);

    // The patch layer stamps the SESSION's username on a write unless the
    // caller names an owner, which is right for every writer that means "this
    // is mine" and wrong for the one that means "this is still theirs". Without
    // it, root adjusting one bit would quietly take the file.
    expect(writeOptions(writeFn)?.owner).toBe('alice');
    const node = createFsView(treeAfterWrite(tree, writeFn), { userType: 'root' }).stat(
      asAbsPath('/home/alice/notes.txt'),
    );
    expect(node?.owner).toBe('alice');
  });

  it('names the permissions rather than letting the write default them', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['go-w', 'notes.txt'], NO_FLAGS);

    // A write with no permissions field is stamped with the tier defaults, so
    // an omission here would not merely fail to apply the mode — it would reset
    // the whole node to a shape nobody asked for.
    expect(writeOptions(writeFn)?.permissions).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    });
  });

  it('sends the content it just read as the base for the write', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['o-r', 'notes.txt'], NO_FLAGS);

    // Naming the base makes the write conditional: if a fellow occupant edited
    // the file between the read and the send, the server refuses instead of
    // letting a permission change quietly revert their edit.
    expect(writeOptions(writeFn)?.baseContent).toBe('the safe combination is 12-24-36\n');
  });

  it('does not claim the file is new', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['o-r', 'notes.txt'], NO_FLAGS);

    // `is_new` decides whether a later `rm` deletes the row or leaves a
    // tombstone. A chmod that stamped it would rewrite that history for a file
    // it did not create.
    expect(writeOptions(writeFn)?.isNew).toBeUndefined();
  });
});

describe('chmod — it composes against the machine, not against its own memory', () => {
  it('writes the content the machine holds now, not the content it was shown', async () => {
    const stale = boxWithAnOpenFile();
    const edited = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('the combination changed to 03-11-27\n', {
              owner: 'alice',
              perms: {
                read: ['root', 'user', 'guest'],
                write: ['root', 'user', 'guest'],
                execute: ['root', 'user', 'guest'],
              },
            }),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const { env, writeFn } = chmodEnv({
      tree: stale,
      reloadTo: edited,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['go-r', 'notes.txt'], NO_FLAGS);

    // `env.fs` is a point-in-time snapshot of this box. On a machine somebody
    // else can also write — a fellow occupant reaching a daemon — a whole-file
    // write composed from the stale copy does not merely miss their edit, it
    // reverts it. So the content and the base both come from the re-read.
    const [, written, options] = writeFn.mock.calls[0] as Parameters<PatchApi['write']>;
    expect(written).toBe('the combination changed to 03-11-27\n');
    expect(options?.baseContent).toBe('the combination changed to 03-11-27\n');
  });

  it('applies the mode to the permissions the machine holds now', async () => {
    const stale = boxWithAnOpenFile();
    const narrowed = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('the safe combination is 12-24-36\n', {
              owner: 'alice',
              perms: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
            }),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const { env, writeFn } = chmodEnv({
      tree: stale,
      reloadTo: narrowed,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['o+r', 'notes.txt'], NO_FLAGS);

    // A mode is a CHANGE to what is there, so reading "what is there" from the
    // stale tree would hand back the permissions of a minute ago with one bit
    // moved — undoing whatever the other writer did in between.
    expect(writeOptions(writeFn)?.permissions).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root', 'user'],
      execute: ['root'],
    });
  });

  it('finds a file that arrived on the machine after the view was built', async () => {
    const stale = buildDirectory({
      home: buildDirectory({ alice: buildDirectory({}, { owner: 'alice' }) }),
    });
    const { env, writeFn } = chmodEnv({
      tree: stale,
      reloadTo: boxWithAnOpenFile(),
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    const result = await chmod.execute(env, ['o-w', 'notes.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Reporting "No such file or directory" for a file the box is holding would
    // be the snapshot talking, not the machine.
    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });
});

/** A box with one locked room. `/root` is root-only in every list, which is
 *  what makes `chmod o+x /root` a change a guest-tier session can feel. */
const boxWithALockedRoom = (): Directory =>
  buildDirectory({
    root: buildDirectory(
      { 'notes.private': buildFile('the plan\n', { owner: 'root' }) },
      { owner: 'root', perms: { read: ['root'], write: ['root'], execute: ['root'] } },
    ),
  });

describe('chmod — a directory', () => {
  it('opens a locked directory to a tier that could not enter it', async () => {
    const tree = boxWithALockedRoom();
    const { env, setDirPermsFn } = chmodEnv({ tree });

    expect(createFsView(tree, { userType: 'guest' }).list(asAbsPath('/root')).ok).toBe(false);

    const result = await chmod.execute(env, ['o+rx', '/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(errorLines(result)).toEqual([]);

    const [path, permissions, options] = setDirPermsFn.mock.calls[0] as [
      string,
      FilePermissions,
      { readonly owner: string },
    ];
    expect(path).toBe('/root');
    expect(options.owner).toBe('root');

    // Proven the way the file case is: fold the real patch through the real
    // materializer, then ask the walker. A directory patch that never reached
    // the tree is exactly the defect this slice found.
    const opened = applyPatches(tree, [
      { path, content: null, owner: options.owner, nodeType: 'directory', permissions },
    ]);
    expect(createFsView(opened, { userType: 'guest' }).list(asAbsPath('/root'))).toEqual({
      ok: true,
      entries: ['notes.private'],
    });
  });

  it('sends no file write for a directory, because a directory has no content', async () => {
    const { env, writeFn, setDirPermsFn } = chmodEnv({ tree: boxWithALockedRoom() });

    await chmod.execute(env, ['o+x', '/root'], NO_FLAGS);

    // A file-shaped patch for a directory would carry `content: ''`, and an
    // empty string is not null — the journal would hold a file where a
    // directory used to be.
    expect(writeFn).not.toHaveBeenCalled();
    expect(setDirPermsFn).toHaveBeenCalledTimes(1);
  });

  it('resolves u from the directory owner, like any other node', async () => {
    const tree = boxWithALockedRoom();
    const { env, setDirPermsFn } = chmodEnv({ tree });

    await chmod.execute(env, ['u-r', '/root'], NO_FLAGS);

    // `/root` belongs to root, so `u` names the tier the removal guard exempts:
    // the same rule as a file, reached through a different write.
    const [, permissions] = setDirPermsFn.mock.calls[0] as [string, FilePermissions];
    expect(permissions.read).toContain('root');
  });

  it('refuses a directory the session may not write', async () => {
    const tree = boxWithALockedRoom();
    const { env, setDirPermsFn } = chmodEnv({ tree, userType: 'user', username: 'alice' });

    const result = await chmod.execute(env, ['o+x', '/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual([
      "chmod: changing permissions of '/root': Operation not permitted",
    ]);
    expect(setDirPermsFn).not.toHaveBeenCalled();
  });

  it('does not ask a directory for content it cannot have', async () => {
    // A directory read answers `is_directory`, so a command that read before it
    // looked at the kind would refuse every directory as unreadable — the file
    // path's own guard turning into a wall.
    const { env, setDirPermsFn } = chmodEnv({ tree: boxWithALockedRoom() });

    const result = await chmod.execute(env, ['g+w', '/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(setDirPermsFn).toHaveBeenCalledTimes(1);
  });
});

const WITH_R = new Map<string, string | true>([['-R', true]]);
const WITH_LOWER_R = new Map<string, string | true>([['-r', true]]);

describe('chmod — the refusals', () => {
  it.each([
    ['-R', WITH_R],
    ['-r', WITH_LOWER_R],
  ])('refuses %s in words, naming what to use instead', async (_flag, flags) => {
    const tree = boxWithALockedRoom();
    const { env, writeFn, setDirPermsFn } = chmodEnv({ tree });

    const result = await chmod.execute(env, ['o+r', '/root'], flags);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Recursion would copy every descendant's content into the caller's rows —
    // a patch storm of whole-file writes, each carrying the clobber hazard a
    // single chmod avoids by naming its base. A loop in a node script does the
    // same job one file at a time, which is why the flag is refused rather than
    // quietly ignored: silence would look like it worked.
    expect(errorLines(result)).toEqual([
      'chmod: -R is not supported; loop over the paths in a node script instead',
    ]);
    expect(result.exitCode).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
    expect(setDirPermsFn).not.toHaveBeenCalled();
  });

  it('asks for operands when given none', async () => {
    const { env, writeFn } = chmodEnv();

    const result = await chmod.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Not `invalid mode: ''` — the player typed nothing, and being told their
    // empty mode is malformed answers a question they did not ask.
    expect(errorLines(result)).toEqual([
      'chmod: missing operand',
      'chmod: usage: chmod <mode> <path>',
    ]);
    expect(result.exitCode).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('names the mode it is still waiting on a path for', async () => {
    const { env } = chmodEnv();

    const result = await chmod.execute(env, ['o+r'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual([
      "chmod: missing operand after 'o+r'",
      'chmod: usage: chmod <mode> <path>',
    ]);
  });

  it('reports a path that is not there, as typed', async () => {
    const { env, writeFn } = chmodEnv({ cwd: '/etc' });

    const result = await chmod.execute(env, ['o+r', 'shadow.bak'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual([
      "chmod: cannot access 'shadow.bak': No such file or directory",
    ]);
    expect(result.exitCode).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('refuses an unparseable mode before it looks at the path at all', async () => {
    const { env } = chmodEnv();

    const result = await chmod.execute(env, ['644', '/nowhere/at/all'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Two things are wrong and only one is reported. The mode is the one the
    // player can fix without looking anything up.
    expect(errorLines(result)).toEqual(["chmod: invalid mode: '644'"]);
  });
});

describe('chmod — what the mutation gate found missing', () => {
  it('granting a tier that already has it changes nothing', async () => {
    const tree = boxWithAnOpenFile();
    const { env, writeFn } = chmodEnv({
      tree,
      userType: 'user',
      username: 'alice',
      cwd: '/home/alice',
    });

    await chmod.execute(env, ['a+r', 'notes.txt'], NO_FLAGS);

    // Every tier could already read it. A `+` that appended unconditionally
    // would store ['root','user','guest','root','user','guest'] — permitting
    // exactly the same thing, and travelling to the server and back forever
    // after as a list that grows by three every time somebody runs the command.
    expect(writeOptions(writeFn)?.permissions?.read).toEqual(['root', 'user', 'guest']);
  });

  it('says nothing when it changes a directory either', async () => {
    const { env } = chmodEnv({ tree: boxWithALockedRoom() });

    const result = await chmod.execute(env, ['o+x', '/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The file path is proven silent by its own test; the directory path is a
    // separate return that nothing was holding to the same standard.
    expect(result.lines).toEqual([]);
  });
});
