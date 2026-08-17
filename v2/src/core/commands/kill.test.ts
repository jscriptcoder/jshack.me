import { describe, expect, it } from 'vitest';
import { kill } from './kill';
import { commandRegistry } from './registry';
import { ps } from './ps';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { createBinaryEntries } from '../generation/binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from '../generation/libraries';
import { basename } from '../filesystem/path';
import { listenerPid, readOpenPorts } from '../services/pidfile';
import { asAbsPath, asMachineId, type UserType } from '../types';
import type { CommandResult, PatchResult } from './types';

/**
 * `kill <pid>` — the defender's answer to a backdoor.
 *
 * A service is a UNIT the box manages: it is addressed by name, through
 * `systemctl`, and `ps` gives it no PID at all. A listener is a PROCESS somebody
 * left behind, addressed by the number `ps` prints beside it — so `kill` is the
 * one verb here that acts on evidence rather than on configuration.
 *
 * The number is DERIVED from the box and the port rather than stored, which is
 * what makes it the same between the look and the shot. `kill` therefore
 * resolves a pid by matching that derivation over what is running, never by
 * reading a field a planter's client could have authored.
 */

const NO_FLAGS = new Map<string, string | true>();
const BOX = 'ws-alice';
const PLANTED = 'nc:port=4444,user=mallory,userType=root';

/** A `/var/run` holding the given pidfiles, basename → content. Root-owned, as a
 *  real one is. */
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

type KillOpts = {
  readonly userType?: UserType;
  readonly machineId?: string;
  readonly running?: Readonly<Record<string, string>>;
  readonly remove?: () => Promise<PatchResult>;
};

/** A box with the given things running on it, and a recording `remove`. */
const killEnv = (opts: KillOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const removes: string[] = [];
  const env = mockCommandEnv({
    session: mockSession({
      userType,
      username: 'alice',
      machineId: asMachineId(opts.machineId ?? BOX),
    }),
    fs: mockFsViewFromTree(varRun(opts.running ?? { 'nc-4444.pid': PLANTED }), {
      userType,
      cwd: () => asAbsPath('/'),
    }),
    patches: {
      ...mockPatchApi(),
      remove: async (path) => {
        removes.push(path);
        return opts.remove === undefined ? { ok: true } : opts.remove();
      },
    },
  });
  return { env, removes };
};

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return {
    // The LINES themselves, not only their text: a command that emitted a line
    // carrying no content would join to the empty string and read as silence.
    lines: result.lines,
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
  };
};

/** The number `ps` prints beside a listener on `machineId` — the handle a
 *  defender reads off the survey and types into `kill`. */
const pidOf = (port: number, machineId: string = BOX): number =>
  listenerPid(asMachineId(machineId), port);

describe('kill, taking a listener away', () => {
  it('removes the pidfile that IS the open port, and says nothing about it', async () => {
    // Real `kill` is silent when it works, and so was legacy's. The observable is
    // that the process is gone, which is what `ps` is for — a line here would be
    // the only place the game narrates a Unix verb that never speaks.
    const { env, removes } = killEnv();

    const { lines, exitCode } = sync(await kill.execute(env, [String(pidOf(4444))], NO_FLAGS));

    expect(removes).toEqual(['/var/run/nc-4444.pid']);
    expect(lines).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it('closes the port for everyone, leaving the services that were there alone', async () => {
    // The pidfile is the source of truth for what is open, so removing it shuts
    // the port to the owner's scan, a neighbour's and a stranger's at once —
    // the same journal path `systemctl stop` already travels. Derived from what
    // the kill actually asked to remove: a kill that removed something else
    // would leave this tree intact and the port still open.
    const running = { 'sshd.pid': 'sshd:port=22', 'nc-4444.pid': PLANTED };
    const { env, removes } = killEnv({ running });
    expect(readOpenPorts(varRun(running)).map((entry) => entry.port)).toEqual([22, 4444]);

    await kill.execute(env, [String(pidOf(4444))], NO_FLAGS);

    const gone = removes.map((path) => basename(asAbsPath(path)));
    const after = varRun(
      Object.fromEntries(Object.entries(running).filter(([name]) => !gone.includes(name))),
    );
    expect(readOpenPorts(after)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('takes away the listener the number names and leaves the other one standing', async () => {
    // Two backdoors on one box are two processes. A defender who kills the one
    // they can see must not lose the evidence of the one they cannot.
    const { env, removes } = killEnv({
      running: {
        'nc-4444.pid': PLANTED,
        'nc-5555.pid': 'nc:port=5555,user=mallory,userType=root',
      },
    });

    await kill.execute(env, [String(pidOf(5555))], NO_FLAGS);

    expect(removes).toEqual(['/var/run/nc-5555.pid']);
  });

  it('still answers to the same number after a reboot rebuilt the box', async () => {
    // A reboot replays the journal onto a freshly generated tree, so every node
    // is a new object. A defender who wrote the number down yesterday must be
    // able to use it today — which holds only because the pid is derived from
    // the box and the port rather than assigned while walking a directory.
    const { env, removes } = killEnv();

    await kill.execute(env, [String(pidOf(4444))], NO_FLAGS);

    expect(removes).toEqual(['/var/run/nc-4444.pid']);
  });

  it('acts on the box the shell is standing on, not on the one that shares its port', async () => {
    // An intruder who plants 4444 across six machines must not hand every
    // defender one number that clears all of it. The pid names a process on a
    // box, so a number read off one box resolves to nothing on another.
    const { env, removes } = killEnv({ machineId: 'ws-bob' });

    const { text, exitCode } = sync(await kill.execute(env, [String(pidOf(4444))], NO_FLAGS));

    expect(text).toBe(`kill: (${pidOf(4444)}): No such process`);
    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
  });
});

describe('kill, refusing', () => {
  it('shows usage when told to kill nothing', async () => {
    const { env, removes } = killEnv();

    const { text, exitCode } = sync(await kill.execute(env, [], NO_FLAGS));

    expect(text).toBe('kill: usage: kill <pid>');
    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
  });

  it('refuses anything that is not a process ID', async () => {
    // Legacy's words, kept: a PID is a positive whole number, and everything
    // else — a word, a fraction, a zero — is the same mistake.
    for (const raw of ['abc', '0', '4444.5', '']) {
      const { env, removes } = killEnv();

      const { text, exitCode } = sync(await kill.execute(env, [raw], NO_FLAGS));

      expect(text).toBe(`kill: ${raw}: arguments must be process IDs`);
      expect(exitCode).toBe(1);
      expect(removes).toEqual([]);
    }
  });

  it('treats 1 as a number a process could answer to, and 0 as no number at all', async () => {
    // The boundary between "that is not a PID" and "no process here has it".
    // Real systems hand 1 to init, so it is a number a defender could plausibly
    // type; nothing in this world answers to it, which is a different fact from
    // it being unusable, and sends them to a different next move.
    const { env, removes } = killEnv();

    expect(sync(await kill.execute(env, ['1'], NO_FLAGS)).text).toBe('kill: (1): No such process');
    expect(sync(await kill.execute(env, ['0'], NO_FLAGS)).text).toBe(
      'kill: 0: arguments must be process IDs',
    );
    expect(removes).toEqual([]);
  });

  it('reports a number that names no process here', async () => {
    const { env, removes } = killEnv();

    const { text, exitCode } = sync(await kill.execute(env, ['999'], NO_FLAGS));

    expect(text).toBe('kill: (999): No such process');
    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
  });

  it('leaves the listener standing when the caller is not root', async () => {
    // Removing the pidfile goes through the walker and `/var/run` is
    // root-writable, so a non-root kill would be refused there anyway. Refusing
    // up front says WHY, in the words the other doors on the box already use.
    for (const userType of ['user', 'guest'] as const) {
      const { env, removes } = killEnv({ userType });

      const { text, exitCode } = sync(await kill.execute(env, [String(pidOf(4444))], NO_FLAGS));

      expect(text).toBe('kill: must be run as root');
      expect(exitCode).toBe(1);
      expect(removes).toEqual([]);
    }
  });

  it('reports a refused removal rather than claiming a door it never shut', async () => {
    // Each failure sends a defender somewhere different: a refusal means come
    // back as somebody else, a round-trip that never completed means come back
    // at all. Claiming success on either would leave a backdoor the survey no
    // longer shows.
    const reasons = [
      { error: 'permission_denied', expected: 'kill: Permission denied' },
      { error: 'no_session', expected: 'kill: Permission denied' },
      { error: 'network_error', expected: 'kill: I/O error' },
      { error: 'modified_since_open', expected: 'kill: File changed on disk' },
    ] as const;

    for (const { error, expected } of reasons) {
      const { env } = killEnv({ remove: async (): Promise<PatchResult> => ({ ok: false, error }) });

      const { text, exitCode } = sync(await kill.execute(env, [String(pidOf(4444))], NO_FLAGS));

      expect(text).toBe(expected);
      expect(exitCode).toBe(1);
    }
  });
});

/**
 * A player who tries to kill a SERVICE has typed the only thing they could.
 *
 * `ps` prints a dash where a service's PID would be, so there is no number to
 * aim at — the name is all they have. Answering "that is not a process ID"
 * would be true and useless. The pointer is name-only, deliberately: whether
 * the program is installed on THIS box is `systemctl`'s question, and answering
 * it here would answer it in the wrong command's voice.
 */
describe('kill, aimed at a service', () => {
  it('points at the verb that can stop one, for every name that resolves to a unit', async () => {
    for (const unit of ['sshd', 'vsftpd', 'nginx', 'apache2']) {
      const { env, removes } = killEnv();

      const { text, exitCode } = sync(await kill.execute(env, [unit], NO_FLAGS));

      expect(text).toBe(`kill: ${unit}: use "systemctl stop ${unit}"`);
      expect(exitCode).toBe(1);
      expect(removes).toEqual([]);
    }
  });

  it('takes nothing away when a number happens to land on a service’s port', async () => {
    // The derivation is defined for any port, so `listenerPid(box, 22)` is a real
    // number even on a box where 22 is sshd's. A kill that matched it would
    // report success and remove a `/var/run/nc-22.pid` that never existed —
    // telling a defender they closed a door that is still open, and doing it in
    // the one place a service and a backdoor are told apart.
    const { env, removes } = killEnv({ running: { 'sshd.pid': 'sshd:port=22' } });

    const { text, exitCode } = sync(await kill.execute(env, [String(pidOf(22))], NO_FLAGS));

    expect(text).toBe(`kill: (${pidOf(22)}): No such process`);
    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
  });

  it('names the unit the player typed, not the one it shares an identity with', async () => {
    // `apache2` and `nginx` are two names for one unit, and `systemctl stop
    // apache2` really works — so echoing back what they typed gives a player a
    // line they can copy, where translating it would hand them a program they
    // never mentioned.
    const { env } = killEnv();

    expect(sync(await kill.execute(env, ['apache2'], NO_FLAGS)).text).toContain(
      'systemctl stop apache2',
    );
  });

  it('answers for a guest with the pointer, not with the root refusal', async () => {
    // Argument shape before privilege, the order this box's other doors already
    // answer in. Telling a guest to elevate would be advice that does not work:
    // `kill sshd` fails as root too.
    const { env } = killEnv({ userType: 'guest' });

    expect(sync(await kill.execute(env, ['sshd'], NO_FLAGS)).text).toBe(
      'kill: sshd: use "systemctl stop sshd"',
    );
  });

  it('treats a word every object answers to as the mistake it is', async () => {
    // The unit table is an object, so a membership test that walks the prototype
    // chain would call `toString` a service and send the player to `systemctl
    // stop toString`.
    const { env } = killEnv();

    expect(sync(await kill.execute(env, ['toString'], NO_FLAGS)).text).toBe(
      'kill: toString: arguments must be process IDs',
    );
  });
});

describe('kill as a player reaches it', () => {
  it('runs under the name they type, off what the generator plants', async () => {
    // The slice rests on a player being able to TYPE `kill`: the registry
    // resolves the command by its own name, the binary gate resolves
    // `/bin/kill`, and the linker gate resolves the libraries it links (kill
    // links libsystemd, inherited from legacy). Built through the generator's
    // own stamping rather than hand-written stubs, so a box whose /lib was
    // raided would fail at the linker instead.
    const tree = buildDirectory({
      bin: buildDirectory(createBinaryEntries(['kill', 'ps'])),
      lib: buildDirectory(createLibraryEntries(SYSTEM_LIBRARIES)),
      var: buildDirectory({
        run: buildDirectory({ 'nc-4444.pid': buildFile(PLANTED, { owner: 'root' }) }),
      }),
    });
    const removes: string[] = [];
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root', machineId: asMachineId(BOX) }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        remove: async (path) => {
          removes.push(path);
          return { ok: true };
        },
      },
    });
    const command = commandRegistry.get('kill');
    if (command === undefined) throw new Error('kill is not registered');

    // The number a defender would really have: read off the survey, then typed.
    const surveyed = await ps.execute(env, [], NO_FLAGS);
    if (surveyed.kind !== 'sync') throw new Error('sync expected');
    const listenerRow = surveyed.lines[1];
    if (listenerRow === undefined) throw new Error('ps listed no listener');
    const pid = listenerRow.content.split(/ +/)[0];

    const { exitCode } = sync(await command.execute(env, [pid], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(removes).toEqual(['/var/run/nc-4444.pid']);
  });
});
