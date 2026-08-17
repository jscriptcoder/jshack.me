import { describe, expect, it } from 'vitest';
import { asAbsPath, asMachineId, type UserType } from '../types';
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
import { nc } from './nc';
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

type PsOpts = { readonly userType?: UserType; readonly machineId?: string };

const psEnv = (tree: ReturnType<typeof varRun>, opts: PsOpts = {}) => {
  const userType = opts.userType ?? 'root';
  return mockCommandEnv({
    session: mockSession({ userType, machineId: asMachineId(opts.machineId ?? 'ws-alice') }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
  });
};

const linesOf = (result: CommandResult): readonly string[] => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.lines.map((line) => line.content);
};

const runPs = async (
  tree: ReturnType<typeof varRun>,
  opts: PsOpts = {},
): Promise<readonly string[]> => linesOf(await ps.execute(psEnv(tree, opts), [], NO_FLAGS));

const HEADER = 'PID     USER      COMMAND     PORT';

/** A service has no PID of its own: it is a unit the box manages, addressed by
 *  name through `systemctl`, so the column is filled with the same dash a real
 *  survey uses for "not applicable". */
const NO_PID = '-       ';

describe('ps', () => {
  it('lists each running service with the account it runs as and the port it holds', async () => {
    const lines = await runPs(
      varRun({ 'sshd.pid': 'sshd:port=22', 'vsftpd.pid': 'vsftpd:port=21' }),
    );

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22', NO_PID + 'root      vsftpd      21']);
  });

  it('reports the port a service was actually started on, not its default', async () => {
    // A defender who moved ftp to 2121 must be able to SEE 2121 — a survey that
    // printed the catalog default would send them looking for a door that is
    // shut and miss the one that is open.
    const lines = await runPs(varRun({ 'vsftpd.pid': 'vsftpd:port=2121' }));

    expect(lines).toEqual([HEADER, NO_PID + 'root      vsftpd      2121']);
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

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22']);
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

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22']);
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

    expect(await runPs(rootedHost)).toEqual([HEADER, NO_PID + 'root      vsftpd      2121']);
  });
});

/**
 * A listener is the row a defender is meant to notice.
 *
 * Everything else `ps` lists was started on purpose by whoever owns the box. A
 * `nc` row was not — it names an account, a port nobody assigned, and a PID that
 * is the handle for taking it away. It is the only row on the survey that is
 * evidence.
 */
describe('ps on a box with a listener planted on it', () => {
  const PLANTED = 'nc:port=4444,user=alice,userType=user';

  it('names the account that planted it, the program, and the port it is holding', async () => {
    const lines = await runPs(varRun({ 'nc-4444.pid': PLANTED }));

    expect(lines).toEqual([HEADER, expect.stringMatching(/^\d+ +alice {5}nc {10}4444$/)]);
  });

  it('sits in the same table as the services, so one look covers the whole box', async () => {
    // A defender who has to run two commands to find a backdoor is a defender who
    // finds it late. The daemon they started and the process somebody left behind
    // are both things running on their machine.
    const lines = await runPs(varRun({ 'sshd.pid': 'sshd:port=22', 'nc-4444.pid': PLANTED }));

    expect(lines).toEqual([
      HEADER,
      NO_PID + 'root      sshd        22',
      expect.stringMatching(/^\d+ +alice {5}nc {10}4444$/),
    ]);
  });

  it('answers with the same PID however many times it is asked', async () => {
    // The number is what a defender types into `kill`. Renumbering between the
    // look and the shot — which is what legacy did — means the shot lands on
    // whatever moved into that slot.
    const first = await runPs(varRun({ 'nc-4444.pid': PLANTED }));
    const second = await runPs(varRun({ 'nc-4444.pid': PLANTED }));

    expect(first).toEqual(second);
  });

  it('keeps that PID across a reboot, which rebuilds the box from its journal', async () => {
    // A reboot replays the journal onto a freshly generated tree, so every node
    // here is a new object. A PID derived from the box and the port survives
    // that; one assigned while walking the directory does not.
    const beforeReboot = await runPs(varRun({ 'nc-4444.pid': PLANTED }));

    const rebuilt = varRun({ 'nc-4444.pid': PLANTED });
    expect(await runPs(rebuilt)).toEqual(beforeReboot);
  });

  it('gives two listeners on one box two different PIDs', async () => {
    const lines = await runPs(varRun({
      'nc-4444.pid': PLANTED,
      'nc-5555.pid': 'nc:port=5555,user=alice,userType=user',
    }));
    const pids = lines.slice(1).map((row) => row.split(/ +/)[0]);

    expect(new Set(pids).size).toBe(2);
  });

  it('gives the same port on two different boxes two different PIDs', async () => {
    // An intruder who plants 4444 across six machines must not find one number
    // that kills all of them — the PID names a process on a box, not a port.
    const planted = varRun({ 'nc-4444.pid': PLANTED });
    const onAlices = await runPs(planted, { machineId: 'ws-alice' });
    const onBobs = await runPs(planted, { machineId: 'ws-bob' });

    expect(onAlices).not.toEqual(onBobs);
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

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22']);
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
      NO_PID + 'root      sshd        22',
      NO_PID + 'root      vsftpd      21',
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

    expect(await runPs(after)).toEqual([HEADER, NO_PID + 'root      vsftpd      21']);
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

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22']);
  });

  it('lists it to a user-tier visitor too', async () => {
    // Both tiers below root are pruned by the same walker, so a fix that reached
    // only guest would be a rule with a hole in it.
    const pidfile = await startSshd();

    const lines = await runPs(asHandedToVisitor(pidfile, 'user'), { userType: 'user' });

    expect(lines).toEqual([HEADER, NO_PID + 'root      sshd        22']);
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

/**
 * The same projection, for the pidfile an INTRUDER writes.
 *
 * `nc -l` is the fifth producer of a `/var/run` pidfile, and the first four had
 * to be brought into line before a visitor could see any of them. A producer
 * that names no permissions gets its own tier's defaults — root-only, since
 * planting takes root — and the row would then be pruned on exactly the hop that
 * matters: the owner walking back onto their own box through a door the intruder
 * left, and finding it apparently clean.
 */
describe('ps on a box somebody planted a listener on', () => {
  const LISTENER = asAbsPath('/var/run/nc-4444.pid');

  /** Plant a listener as root and return the patch row its write becomes, taking
   *  the same permissions the adapter would: those the command named, or its
   *  tier's file defaults when it named none. */
  const plantListener = async (): Promise<Patch> => {
    const writes: { path: string; content: string; permissions?: Patch['permissions'] }[] = [];
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root', username: 'mallory' }),
      fs: mockFsViewFromTree(varRun({}), { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          writes.push({ path, content, permissions: options?.permissions });
          return { ok: true };
        },
      },
    });

    await nc.execute(env, ['4444'], new Map([['-l', true]]));

    const call = writes[0];
    if (call === undefined) throw new Error('nc -l wrote no pidfile');
    return {
      path: call.path,
      content: call.content,
      owner: 'root',
      permissions: call.permissions ?? defaultFilePermissions('root'),
    };
  };

  const asHandedToVisitor = (pidfile: Patch, userType: UserType): Directory =>
    filterTreeForRead(applyPatches(varRun({}), [pidfile]), userType);

  it('shows the backdoor to a guest standing on the box', async () => {
    const lines = await runPs(asHandedToVisitor(await plantListener(), 'guest'), {
      userType: 'guest',
    });

    expect(lines).toEqual([HEADER, expect.stringMatching(/^\d+ +mallory {3}nc {10}4444$/)]);
  });

  it('shows it to a user-tier visitor too', async () => {
    const lines = await runPs(asHandedToVisitor(await plantListener(), 'user'), {
      userType: 'user',
    });

    expect(lines).toEqual([HEADER, expect.stringMatching(/^\d+ +mallory {3}nc {10}4444$/)]);
  });

  it('still lets nobody but root touch that pidfile', async () => {
    // Seeing a backdoor is what a defender is owed; removing it is root's, which
    // is what makes `kill` a root verb rather than a courtesy.
    const box = applyPatches(varRun({}), [await plantListener()]);

    expect(createFsView(box, { userType: 'guest' }).canWrite(LISTENER).allowed).toBe(false);
    expect(createFsView(box, { userType: 'user' }).canWrite(LISTENER).allowed).toBe(false);
    expect(createFsView(box, { userType: 'root' }).canWrite(LISTENER).allowed).toBe(true);
  });
});
