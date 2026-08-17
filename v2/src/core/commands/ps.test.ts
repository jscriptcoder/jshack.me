import { describe, expect, it } from 'vitest';
import { asAbsPath, type UserType } from '../types';
import type { CommandResult } from './types';
import type { Directory } from '../filesystem/types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { BINARY_STUB, createBinaryEntries } from '../generation/binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from '../generation/libraries';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { defaultFilePermissions } from '../filesystem/defaultPermissions';
import { createFsView } from '../filesystem/fsView';
import { filterTreeForRead } from '../patches/readFilter';
import { basename } from '../filesystem/path';
import { commandRegistry } from './registry';
import { sshd } from './daemon';
import { systemctl } from './systemctl';
import { ps } from './ps';

/**
 * `ps` is the survey instrument on the box you are standing on: one row per
 * running service, read from the same `/var/run/*.pid` files that decide
 * whether a port is open at all.
 *
 * It answers for the machine the shell is on, which is what makes it recon on
 * a box the player only rooted and defence on their own. And it answers to any
 * tier — the pidfiles are root-owned, so a `cat` of one is refused, but real
 * `ps` asks the kernel rather than reading a file, and here the pidfile IS the
 * kernel.
 */

const NO_FLAGS = new Map<string, string | true>();

/** A `/var/run` holding the given pidfiles, basename → content. Root-owned, as
 *  a real one is — which is exactly why the guest case is worth proving. */
const varRun = (pidfiles: Readonly<Record<string, string>>) =>
  buildDirectory({
    var: buildDirectory({
      run: buildDirectory(
        Object.fromEntries(
          Object.entries(pidfiles).map(([name, content]) => [
            name,
            buildFile(content, { owner: 'root' }),
          ]),
        ),
      ),
    }),
  });

const psEnv = (
  tree: ReturnType<typeof varRun>,
  opts: { readonly userType?: UserType } = {},
) => {
  const userType = opts.userType ?? 'root';
  return mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
  });
};

const linesOf = (result: CommandResult): readonly string[] => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.lines.map((line) => line.content);
};

const runPs = async (
  tree: ReturnType<typeof varRun>,
  opts: { readonly userType?: UserType } = {},
): Promise<readonly string[]> => linesOf(await ps.execute(psEnv(tree, opts), [], NO_FLAGS));

const HEADER = 'USER      COMMAND     PORT';

describe('ps', () => {
  it('lists each running service with the account it runs as and the port it holds', async () => {
    const lines = await runPs(
      varRun({ 'sshd.pid': 'sshd:port=22', 'vsftpd.pid': 'vsftpd:port=21' }),
    );

    expect(lines).toEqual([HEADER, 'root      sshd        22', 'root      vsftpd      21']);
  });

  it('reports the port a service was actually started on, not its default', async () => {
    // A defender who moved ftp to 2121 must be able to SEE 2121 — a survey that
    // printed the catalog default would send them looking for a door that is
    // shut and miss the one that is open.
    const lines = await runPs(varRun({ 'vsftpd.pid': 'vsftpd:port=2121' }));

    expect(lines).toEqual([HEADER, 'root      vsftpd      2121']);
  });

  it('prints the header and no rows when nothing is running', async () => {
    // A bare header IS the answer "nothing is running". Printing nothing at all
    // is indistinguishable from a command that failed to run.
    const lines = await runPs(varRun({}));

    expect(lines).toEqual([HEADER]);
  });

  it('skips a /var/run entry that names no service the world knows', async () => {
    // `readOpenPorts` already decides what counts as a service. `ps` must not
    // become a second policy, or a scan and a survey of one box could disagree.
    const lines = await runPs(varRun({ 'sshd.pid': 'sshd:port=22', 'crond.pid': 'crond:port=9' }));

    expect(lines).toEqual([HEADER, 'root      sshd        22']);
  });

  it('does not report a directory wearing a pidfile name as a running service', async () => {
    // `mkdir /var/run/sshd.pid` is something a root player can really do, and
    // reading it as a daemon would let anyone fake a serving box with one
    // command — or, on a box they hold, appear to be serving what they are not.
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'sshd.pid': buildDirectory({}) }) }),
    });

    expect(await runPs(tree)).toEqual([HEADER]);
  });

  it('falls back to the service default port when the pidfile is malformed', async () => {
    // The file's PRESENCE is what means "up"; its content only says where. A
    // daemon whose line got garbled is still running, and hiding it would tell
    // a defender a door is shut when it is open.
    const lines = await runPs(varRun({ 'sshd.pid': 'garbled' }));

    expect(lines).toEqual([HEADER, 'root      sshd        22']);
  });

  it('answers a guest with the same rows it gives root', async () => {
    // The pidfiles are root-owned and a guest cannot `cat` one, so this only
    // holds if `ps` reads the tree the way a kernel would rather than the way a
    // reader would. A guest seeing what runs is a recon reward that costs the
    // defender nothing they control.
    const running = { 'sshd.pid': 'sshd:port=22', 'vsftpd.pid': 'vsftpd:port=21' };

    expect(await runPs(varRun(running), { userType: 'guest' })).toEqual(
      await runPs(varRun(running), { userType: 'root' }),
    );
  });

  it('surveys the machine the shell is standing on, not the box the player owns', async () => {
    // The whole recon value: `ps` on a box you only rooted tells you about THAT
    // box. `env.fs` already follows the shell, so this holds as long as `ps`
    // asks it and never reaches for the player's own tree.
    const rootedHost = varRun({ 'vsftpd.pid': 'vsftpd:port=2121' });

    expect(await runPs(rootedHost)).toEqual([HEADER, 'root      vsftpd      2121']);
  });
});

describe('ps as a player reaches it', () => {
  it('runs for a guest under the name they type, off what the generator plants', async () => {
    // The slice rests on a player being able to TYPE `ps`: the registry resolves
    // a command by its own `name`, the binary gate resolves `/bin/<name>` and
    // reads that binary's own execute perms, and the linker gate resolves the
    // libraries it links (`ps` links libpcre, inherited from legacy). A survey
    // nobody can reach is no survey. Built through the generator's own stamping
    // rather than hand-written stubs, so what is proved here is what a real box
    // ships — and a box whose /lib was raided would fail at the linker instead.
    const tree = buildDirectory({
      bin: buildDirectory(createBinaryEntries(['ps'])),
      lib: buildDirectory(createLibraryEntries(SYSTEM_LIBRARIES)),
      var: buildDirectory({
        run: buildDirectory({ 'sshd.pid': buildFile('sshd:port=22', { owner: 'root' }) }),
      }),
    });
    const command = commandRegistry.get('ps');
    if (command === undefined) throw new Error('ps is not registered');

    const lines = linesOf(await command.execute(psEnv(tree, { userType: 'guest' }), [], NO_FLAGS));

    expect(lines).toEqual([HEADER, 'root      sshd        22']);
  });
});

describe('ps after a service is stopped', () => {
  it('no longer lists a service systemctl closed the door on', async () => {
    // The slice-1 loop seen from inside: the file `systemctl stop` removes is
    // the file `ps` reads. Derived from the path the stop actually asked to
    // remove — a stop that removed something else would leave this tree intact
    // and the row still standing.
    const running = { 'sshd.pid': 'sshd:port=22', 'vsftpd.pid': 'vsftpd:port=21' };
    const before = varRun(running);
    expect(await runPs(before)).toEqual([
      HEADER,
      'root      sshd        22',
      'root      vsftpd      21',
    ]);

    const removes: string[] = [];
    const stopping = mockCommandEnv({
      session: mockSession({ userType: 'root' }),
      fs: mockFsViewFromTree(
        buildDirectory({
          ...Object.fromEntries(before.entries),
          usr: buildDirectory({ sbin: buildDirectory({ sshd: buildFile(BINARY_STUB) }) }),
        }),
        { userType: 'root', cwd: () => asAbsPath('/') },
      ),
      patches: {
        ...mockPatchApi(),
        remove: async (path) => {
          removes.push(path);
          return { ok: true };
        },
      },
    });
    const stopped = await systemctl.execute(stopping, ['stop', 'sshd'], NO_FLAGS);
    if (stopped.kind !== 'async') throw new Error('async expected');
    for await (const _line of stopped.lines) void _line;

    const removed = removes.map((path) => basename(asAbsPath(path)));
    const after = varRun(
      Object.fromEntries(Object.entries(running).filter(([name]) => !removed.includes(name))),
    );

    expect(await runPs(after)).toEqual([HEADER, 'root      vsftpd      21']);
  });
});

/**
 * What a VISITOR sees — the player standing on a box that is not theirs.
 *
 * A hop onto someone else's machine is server-served: the server replays that
 * box's patch journal over its regenerated baseline, prunes the result to what
 * the visitor's tier may read, and only then does `ps` run over what came back.
 * So the permissions a daemon stamps on its pidfile decide, one hop later,
 * whether the box looks like it is serving anything at all — a root-only pidfile
 * is dropped in transit and `ps` prints a bare header on a box plainly running
 * ssh.
 *
 * These tests walk that whole projection rather than a tree built by hand: the
 * write `sshd` really makes, the patch row it becomes, the replay, the prune,
 * and finally the survey. A hand-built tree cannot fail this way, which is why
 * the defect survived the suite above.
 */
describe('ps on a box whose owner started a service', () => {
  const PIDFILE = asAbsPath('/var/run/sshd.pid');

  /** Bring `sshd` up on a bare box and return the patch row its write becomes.
   *  Permissions follow the adapter's rule: the ones the caller named, or its own
   *  tier's file defaults when it names none — and a daemon is root-only, so that
   *  default is root-readable ONLY. */
  const startSshd = async (): Promise<Patch> => {
    const writes: { path: string; content: string; permissions?: Patch['permissions'] }[] = [];
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root' }),
      fs: mockFsViewFromTree(varRun({}), { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          writes.push({ path, content, permissions: options?.permissions });
          return { ok: true };
        },
      },
    });

    const started = await sshd.execute(env, [], NO_FLAGS);
    if (started.kind !== 'async') throw new Error('async expected');
    for await (const _line of started.lines) void _line;

    const call = writes[0];
    if (call === undefined) throw new Error('sshd wrote no pidfile');
    return {
      path: call.path,
      content: call.content,
      owner: 'root',
      permissions: call.permissions ?? defaultFilePermissions('root'),
    };
  };

  /** The box as the server hands it to a visitor: journal replayed, then pruned
   *  to the tier their session bought. */
  const asHandedToVisitor = (pidfile: Patch, userType: UserType): Directory =>
    filterTreeForRead(applyPatches(varRun({}), [pidfile]), userType);

  it('lists the service to a guest who walked in through its own front door', async () => {
    const pidfile = await startSshd();

    const lines = await runPs(asHandedToVisitor(pidfile, 'guest'), { userType: 'guest' });

    expect(lines).toEqual([HEADER, 'root      sshd        22']);
  });

  it('lists it to a user-tier visitor too', async () => {
    // Both tiers below root are pruned by the same walker, so a fix that reached
    // only guest would be a rule with a hole in it.
    const pidfile = await startSshd();

    const lines = await runPs(asHandedToVisitor(pidfile, 'user'), { userType: 'user' });

    expect(lines).toEqual([HEADER, 'root      sshd        22']);
  });

  it('still lets nobody but root write that pidfile — the read tier widens, the write tier does not', async () => {
    // Seeing what a box runs is recon; being able to edit what it claims to run
    // would let any visitor close a door, or fake one open, without ever
    // elevating. The same walker answers both questions, so widening the wrong
    // one is a single-word mistake.
    const box = applyPatches(varRun({}), [await startSshd()]);

    expect(createFsView(box, { userType: 'guest' }).canWrite(PIDFILE).allowed).toBe(false);
    expect(createFsView(box, { userType: 'user' }).canWrite(PIDFILE).allowed).toBe(false);
    expect(createFsView(box, { userType: 'root' }).canWrite(PIDFILE).allowed).toBe(true);
  });
});
