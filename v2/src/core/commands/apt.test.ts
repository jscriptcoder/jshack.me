import { describe, expect, it } from 'vitest';
import { BINARY_STUB } from '../generation/binaries';
import type { SystemLibrary } from '../generation/libraries';
import type { Directory, FilePermissions } from '../filesystem/types';
import { asAbsPath, asPlayerKeyHex, type UserType } from '../types';
import type { CommandResult, PatchResult, TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { applyPatches } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { DATADIR_FILE, PASSWD_FILE } from '../generation/baseFs';
import { md5 } from '../generation/md5';
import { DATADIR_OWNER, DATADIR_PATH } from '../mysql/datadir';
import { parseMysqlDatabase } from '../mysql/types';
import { accountIn, accountsIn } from '../sessions/passwdAccount';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { apt, installExtraFiles, installPackageLibraries } from './apt';
import { APT_PACKAGES } from './aptPackages';
import {
  DEFAULT_WORDLIST,
  formatWordlist,
  WORDLIST_PERMISSIONS as WORDLIST_PERMS,
} from '../wordlist/defaultWordlist';
import {
  DEFAULT_DIRLIST,
  formatDirlist,
  DIRLIST_PERMISSIONS as DIRLIST_PERMS,
} from '../network/defaultDirlist';

/**
 * `apt install` is the reachability mechanism: as root + online, it writes a
 * package's binary stub(s) into `/usr/bin` so a previously not-found command
 * becomes runnable. The tests capture every `patches.write` so the "refused ⇒
 * nothing written" invariants (offline, non-root, unknown package) are provable,
 * and assert the install stamps WORLD-EXECUTABLE perms so the user-tier player —
 * not just root — can run the tool afterwards.
 *
 * Reaching the repo STREAMS, so the tests drain rather than read a collected
 * line set. The gates split on whether the repo was reached: non-root and
 * offline refuse before it and stay sync, while an unknown package is only
 * discoverable after the package lists are read — so it reports under the
 * preamble the player has already seen.
 */

const NO_FLAGS = new Map<string, string | true>();

/** What `apt` must stamp on an installed binary: readable + executable by every
 *  tier, writable only by root — matching the system-binary perm shape. Without
 *  this, a root-installed file would be root-only-executable and the user could
 *  never run it. */
const WORLD_EXECUTABLE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

/** What `apt` must stamp on an installed library: world-readable, root-writable,
 *  and NOT executable (a library is linked, never run) — distinct from a binary's
 *  world-executable shape. */
const LIBRARY_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?:
    | { readonly isNew?: boolean; readonly permissions?: FilePermissions }
    | undefined;
};

type AptEnvOpts = {
  readonly online?: boolean;
  readonly userType?: UserType;
  readonly writeResult?: PatchResult;
  /** Fails ONLY the writes whose path matches, leaving the rest to succeed — so a
   *  failure partway through a multi-step install is exercisable. */
  readonly failWritesTo?: string;
  readonly mkdirResult?: PatchResult;
  /** Content already sitting at the wordlist path — the state of a box whose
   *  owner has grown their list by hand. */
  readonly curatedWordlist?: string;
  /** Binaries already in `/usr/bin`, so a reinstall of an installed package is
   *  exercisable. */
  readonly installedBinaries?: readonly string[];
};

/** One filesystem operation apt performed, in the order it performed them.
 *  Directory creation and file writes share this list because their ORDER is the
 *  contract: a write into a directory that does not exist yet is refused. */
type Operation =
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'write'; readonly path: string };

/** An env whose `patches` mutations are spies: each call is recorded and returns
 *  a configurable result, so installs are observable and a rejected write is
 *  exercisable. Defaults: root + online + everything succeeds. */
/** The directories a real workstation already has where apt writes. `/usr/bin`
 *  exists on every box; `/usr/share` does NOT (asserted in `workstationFs.test`,
 *  where `/usr` holds exactly `bin` and `sbin`), which is why a data file's
 *  ancestors have to be created and a binary's do not. */
const installedBoxTree = (opts: AptEnvOpts = {}): Directory =>
  buildDirectory({
    usr: buildDirectory({
      bin: buildDirectory(
        Object.fromEntries((opts.installedBinaries ?? []).map((name) => [name, buildFile('#!bin')])),
      ),
      sbin: buildDirectory({}),
      ...(opts.curatedWordlist === undefined
        ? {}
        : {
            share: buildDirectory({
              wordlists: buildDirectory({
                'passwords.txt': buildFile(opts.curatedWordlist),
              }),
            }),
          }),
    }),
    lib: buildDirectory({}),
  });

const aptEnv = (opts: AptEnvOpts = {}) => {
  const writes: WriteCall[] = [];
  const operations: Operation[] = [];
  const env = mockCommandEnv({
    session: mockSession({ userType: opts.userType ?? 'root' }),
    fs: mockFsViewFromTree(installedBoxTree(opts)),
    network: mockNetworkView({ isOnline: () => opts.online ?? true }),
    patches: {
      ...mockPatchApi(),
      write: async (path, content, options) => {
        writes.push({ path, content, options });
        operations.push({ kind: 'write', path });
        if (opts.failWritesTo !== undefined) {
          return opts.failWritesTo === path ? { ok: false, error: 'permission_denied' } : { ok: true };
        }
        return opts.writeResult ?? { ok: true };
      },
      mkdir: async (path) => {
        operations.push({ kind: 'mkdir', path });
        return opts.mkdirResult ?? { ok: true };
      },
    },
  });
  return { env, writes, operations };
};

const syncResult = (
  result: CommandResult,
): {
  readonly lines: readonly TerminalLine[];
  readonly text: string;
  readonly exitCode: number;
} => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return {
    lines: result.lines,
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
  };
};

/** Drain a streamed result to its lines + exit code. A streamed command is LAZY:
 *  none of its work runs until something consumes the lines. */
const streamResult = async (
  result: CommandResult,
): Promise<{
  readonly lines: readonly TerminalLine[];
  readonly text: string;
  readonly exitCode: number;
}> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: TerminalLine[] = [];
  for await (const line of result.lines) lines.push(line);
  return {
    lines,
    text: lines.map((line) => line.content).join('\n'),
    exitCode: await result.exitCode(),
  };
};

/** The FIRST streamed line, pulled without draining the rest — leaving the
 *  command suspended mid-flight so the world it hasn't touched yet is
 *  inspectable. */
const firstStreamedLine = async (result: CommandResult): Promise<TerminalLine | undefined> => {
  if (result.kind !== 'async') throw new Error('async expected');
  for await (const line of result.lines) return line;
  return undefined;
};

/** Drain the extra-file installer to its return value. It is a generator: the
 *  writes only happen as the lines are consumed. */
const drainExtraFiles = async (
  installer: AsyncGenerator<TerminalLine, PatchResult>,
): Promise<PatchResult> => {
  for (;;) {
    const step = await installer.next();
    if (step.done === true) return step.value;
  }
};

describe('apt', () => {
  describe('install', () => {
    it('announces reading the package lists before anything is installed', async () => {
      const { env, writes } = aptEnv();

      const first = await firstStreamedLine(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      // The player watches apt work: the first step is out before the install it
      // precedes. No "Done" — the NEXT line arriving is what reports this one
      // finished, because an appended line can never be taken back.
      expect(first).toEqual({ kind: 'text', content: 'Reading package lists...' });
      expect(writes).toEqual([]);
    });

    it('reports each install step in order, announcing the setup before the write', async () => {
      const { env } = aptEnv();

      const { lines } = await streamResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      expect(lines).toEqual([
        { kind: 'text', content: 'Reading package lists...' },
        { kind: 'text', content: 'Building dependency tree...' },
        { kind: 'text', content: 'The following NEW packages will be installed:' },
        { kind: 'text', content: '  nmap' },
        { kind: 'text', content: 'Setting up nmap ...' },
      ]);
    });

    it('installs a package binary into /usr/bin, world-executable, marked new', async () => {
      const { env, writes } = aptEnv();

      const { text, exitCode } = await streamResult(
        await apt.execute(env, ['install', 'nmap'], NO_FLAGS),
      );

      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({
        path: '/usr/bin/nmap',
        content: BINARY_STUB,
        options: { isNew: true, permissions: WORLD_EXECUTABLE },
      });
      expect(text).toContain('Setting up nmap');
      expect(exitCode).toBe(0);
    });

    it('installs binary content free of NUL bytes (Postgres TEXT cannot store them)', async () => {
      // Regression guard: the patch store is a Postgres TEXT column, which
      // rejects NUL (\u0000). A stub containing NUL fails the real write with a
      // network_error even though unit tests with a mocked write pass.
      const { env, writes } = aptEnv();

      await streamResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      expect(writes[0].content).not.toContain('\u0000');
    });

    it('installs every binary a multi-binary package ships, in catalog order', async () => {
      const { env, writes } = aptEnv();

      await streamResult(await apt.execute(env, ['install', 'aircrack'], NO_FLAGS));

      expect(writes.map((write) => write.path)).toEqual([
        '/usr/bin/airmon',
        '/usr/bin/airdump',
        '/usr/bin/aircrack',
      ]);
    });

    it('installs a package whose binary name differs from the package name', async () => {
      const { env, writes } = aptEnv();

      await streamResult(await apt.execute(env, ['install', 'netcat'], NO_FLAGS));

      expect(writes.map((write) => write.path)).toEqual(['/usr/bin/nc']);
    });

    it('installs a daemon into /usr/sbin, where the admin binaries already live', async () => {
      // A web server is a daemon on any real box, and /usr/sbin is where a daemon
      // belongs — the directory the pre-installed sshd and vsftpd already occupy.
      // Nothing functional turns on it: the binary search spans /bin, /usr/bin and
      // /usr/sbin alike, so this is what the player SEES when they list a
      // directory. It matters because afterwards the rule has no exceptions.
      const nginxInstall = aptEnv();
      const apacheInstall = aptEnv();

      await streamResult(await apt.execute(nginxInstall.env, ['install', 'nginx'], NO_FLAGS));
      await streamResult(await apt.execute(apacheInstall.env, ['install', 'apache2'], NO_FLAGS));

      expect(nginxInstall.writes.map((write) => write.path)).toEqual(['/usr/sbin/nginx']);
      expect(apacheInstall.writes.map((write) => write.path)).toEqual(['/usr/sbin/apache2']);
    });

    it('installs a package that ships both a client and a daemon into both places', async () => {
      // One package, two binaries, two shelves: the mysql CLIENT is a tool any
      // tier runs to open somebody's database, while mysqld is the daemon root
      // runs to become the box somebody opens. Buying one buys the other — a
      // player who installed "mysql" and found no way to serve one would be
      // reading a package list to work out what a second package was called.
      const { env, writes } = aptEnv();

      await streamResult(await apt.execute(env, ['install', 'mysql'], NO_FLAGS));

      // The BINARIES, specifically: this package also ships a database, and where
      // that lands is a separate claim with its own tests below.
      const binaries = writes.filter((write) => write.content === BINARY_STUB);
      expect(binaries.map((write) => write.path)).toEqual(['/usr/bin/mysql', '/usr/sbin/mysqld']);
    });

    it('stamps a daemon world-executable, exactly as it stamps any other binary', async () => {
      // The destination changes; nothing else about the install does. A daemon
      // self-gates root at RUNTIME — the perms are the ones a real /usr/sbin/sshd
      // carries — so narrowing them here would refuse the player before their own
      // daemon could explain why.
      const { env, writes } = aptEnv();

      await streamResult(await apt.execute(env, ['install', 'nginx'], NO_FLAGS));

      expect(writes[0].options).toEqual({ isNew: true, permissions: WORLD_EXECUTABLE });
    });

    it('refuses to install as a non-root user and writes nothing', async () => {
      const { env, writes } = aptEnv({ userType: 'user' });

      const { lines, text, exitCode } = syncResult(
        await apt.execute(env, ['install', 'nmap'], NO_FLAGS),
      );

      expect(text).toContain('Permission denied');
      expect(text).toContain('are you root?');
      // A refusal renders red, and arrives whole — it never reached the repo, so
      // there is nothing to announce and nothing to stream.
      expect(lines.map((line) => line.kind)).toEqual(['error', 'error']);
      expect(exitCode).toBe(100);
      expect(writes).toEqual([]);
    });

    it('refuses to install while offline and writes nothing', async () => {
      const { env, writes } = aptEnv({ online: false });

      const { text, exitCode } = syncResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      expect(text).toContain('Temporary failure resolving');
      expect(exitCode).toBe(100);
      expect(writes).toEqual([]);
    });

    it('reports an unknown package under the preamble, and writes nothing', async () => {
      const { env, writes } = aptEnv();

      const { lines, exitCode } = await streamResult(
        await apt.execute(env, ['install', 'boguspkg'], NO_FLAGS),
      );

      // Unlike the non-root and offline refusals, this one reached the repo:
      // you only learn a package is missing by reading the lists first, so the
      // preamble the player watched stands and the failure lands beneath it.
      expect(lines).toEqual([
        { kind: 'text', content: 'Reading package lists...' },
        { kind: 'text', content: 'Building dependency tree...' },
        { kind: 'error', content: 'E: Unable to locate package boguspkg' },
      ]);
      expect(exitCode).toBe(100);
      expect(writes).toEqual([]);
    });

    it('errors with usage when no package is given', async () => {
      const { env, writes } = aptEnv();

      const { text, exitCode } = syncResult(await apt.execute(env, ['install'], NO_FLAGS));

      // Distinct from the unknown-package path: "no package" must say so, not
      // fall through to "Unable to locate package undefined".
      expect(text).toContain('No package specified');
      expect(text).not.toContain('Unable to locate package');
      expect(exitCode).toBe(100);
      expect(writes).toEqual([]);
    });

    it('reports failure when a write is rejected, after the setup was announced', async () => {
      const { env } = aptEnv({ writeResult: { ok: false, error: 'permission_denied' } });

      const { lines, exitCode } = await streamResult(
        await apt.execute(env, ['install', 'nmap'], NO_FLAGS),
      );

      // The setup announcement is already out when the write fails, so the
      // failure follows it — it cannot retract a line the player has seen.
      expect(lines.map((line) => line.content)).toEqual([
        'Reading package lists...',
        'Building dependency tree...',
        'The following NEW packages will be installed:',
        '  nmap',
        'Setting up nmap ...',
        'E: Failed to install nmap (permission_denied)',
      ]);
      expect(exitCode).toBe(100);
    });

    /**
     * Some packages ship DATA, not just binaries: hydra without a wordlist is a
     * tool with nothing to try. `extraFiles` is that seam — the package names the
     * files it installs alongside its binaries, and apt places them like any other
     * file on the box, so the player can read and edit what they got.
     *
     * The ordering assertions are not fussiness. A write whose containing
     * directory does not exist is REFUSED (`fsView`: a deeper-missing path has no
     * container, so there is nowhere to create the entry), and nothing on a fresh
     * workstation creates `/usr/share`. Directories first, or the install fails.
     */
    describe('extra files', () => {
      it('installs the wordlist hydra ships, world-readable and not executable', async () => {
        const { env, writes } = aptEnv();

        const { exitCode } = await streamResult(
          await apt.execute(env, ['install', 'hydra'], NO_FLAGS),
        );

        const wordlist = writes.find(
          (write) => write.path === '/usr/share/wordlists/passwords.txt',
        );
        expect(wordlist).toEqual({
          path: '/usr/share/wordlists/passwords.txt',
          content: formatWordlist(DEFAULT_WORDLIST),
          // Readable by every tier so a guest-tier hydra can consult it, writable
          // only by root so appending a harvested password is a deliberate act,
          // and NEVER executable — it is data the tools read, not a program.
          options: { isNew: true, permissions: WORDLIST_PERMS },
        });
        expect(exitCode).toBe(0);
      });

      it('installs the path list gobuster ships, world-readable and not executable', async () => {
        const { env, writes } = aptEnv();

        const { exitCode } = await streamResult(
          await apt.execute(env, ['install', 'gobuster'], NO_FLAGS),
        );

        // The same seam, a second consumer: gobuster with no path list has nothing
        // to ask a server, exactly as hydra with no wordlist has nothing to try.
        const dirlist = writes.find((write) => write.path === '/usr/share/wordlists/dirlist.txt');
        expect(dirlist).toEqual({
          path: '/usr/share/wordlists/dirlist.txt',
          content: formatDirlist(DEFAULT_DIRLIST),
          options: { isNew: true, permissions: DIRLIST_PERMS },
        });
        expect(exitCode).toBe(0);
      });

      it('creates the containing directories before writing into them', async () => {
        const { env, operations } = aptEnv();

        await streamResult(await apt.execute(env, ['install', 'hydra'], NO_FLAGS));

        // `/usr` already exists on the box, so it is left alone — every mkdir is
        // a persisted journal row, and one that recreates an existing directory
        // would sit on the player's box forever doing nothing. `/usr/share` and
        // the wordlists directory below it DO have to be made: a write into a
        // missing directory is refused before it ever reaches the journal.
        expect(operations).toEqual([
          { kind: 'write', path: '/usr/bin/hydra' },
          { kind: 'mkdir', path: '/usr/share' },
          { kind: 'mkdir', path: '/usr/share/wordlists' },
          { kind: 'write', path: '/usr/share/wordlists/passwords.txt' },
        ]);
      });

      /**
       * The wordlist is not apt's file once it lands — it is the player's, and
       * growing it by hand IS the progression the whole credential layer rests
       * on. An install that rewrote it would silently destroy every password
       * harvested since, with nothing on screen to say so.
       *
       * Which is why "already installed, do nothing" is the WRONG fix: both
       * `hydra` and `john` tell a player with no wordlist to reinstall hydra to
       * get one back. That recovery has to keep working, so the rule is per-file
       * — present is left alone, absent is written.
       */
      it('leaves a wordlist the player has grown where it is', async () => {
        const { env, writes } = aptEnv({
          curatedWordlist: 'letmein\nharvested-from-the-box-at-192.168.4.31\n',
        });

        const { exitCode } = await streamResult(
          await apt.execute(env, ['install', 'hydra'], NO_FLAGS),
        );

        expect(writes.map((write) => write.path)).toEqual(['/usr/bin/hydra']);
        expect(exitCode).toBe(0);
      });

      it('says the wordlist was kept, rather than leaving the player guessing', async () => {
        const { env } = aptEnv({ curatedWordlist: 'letmein\n' });

        const { lines } = await streamResult(
          await apt.execute(env, ['install', 'hydra'], NO_FLAGS),
        );

        expect(lines.map((line) => line.content)).toContain(
          '/usr/share/wordlists/passwords.txt already exists, keeping your copy',
        );
      });

      it('restores a wordlist the player deleted, even with hydra still installed', async () => {
        // The recovery path both tools point at. The binary is present, so this
        // is a reinstall — but the data file is gone and has to come back.
        const { env, writes } = aptEnv({ installedBinaries: ['hydra'] });

        await streamResult(await apt.execute(env, ['install', 'hydra'], NO_FLAGS));

        // The binary is rewritten with the stub it already held — harmless, and
        // out of scope here; what matters is that the data file comes back.
        expect(writes).toEqual([
          { path: '/usr/bin/hydra', content: BINARY_STUB, options: expect.anything() },
          {
            path: '/usr/share/wordlists/passwords.txt',
            content: formatWordlist(DEFAULT_WORDLIST),
            options: { isNew: true, permissions: WORDLIST_PERMS },
          },
        ]);
      });

      it('writes no extra files for a package that ships none', async () => {
        const { env, writes } = aptEnv();

        await streamResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

        expect(writes.map((write) => write.path)).toEqual(['/usr/bin/nmap']);
      });

      it('announces the extra file, rather than writing it silently', async () => {
        const { env } = aptEnv();

        const { lines } = await streamResult(
          await apt.execute(env, ['install', 'hydra'], NO_FLAGS),
        );

        // The player watches apt work — a file that appears with no line
        // explaining it reads as something the game did behind their back.
        expect(lines.map((line) => line.content)).toContain(
          'Installing /usr/share/wordlists/passwords.txt ...',
        );
      });

      it('installs every extra file a package ships, not just the first', async () => {
        // A successful write must not end the walk. With hydra shipping exactly
        // one data file, a "return after the first" bug is invisible through the
        // real catalog — so the two-file case is driven against a fixture.
        const { env, writes } = aptEnv();
        const extras = [
          { path: asAbsPath('/usr/share/wordlists/a.txt'), content: () => 'alpha', permissions: WORDLIST_PERMS },
          { path: asAbsPath('/usr/share/wordlists/b.txt'), content: () => 'bravo', permissions: WORDLIST_PERMS },
        ];

        const result = await drainExtraFiles(installExtraFiles(env, extras));

        expect(result).toEqual({ ok: true });
        expect(writes.map((write) => write.path)).toEqual([
          '/usr/share/wordlists/a.txt',
          '/usr/share/wordlists/b.txt',
        ]);
      });

      it('stops at a rejected directory creation, without writing into it', async () => {
        // The directory is what makes the write possible at all, so a refused
        // mkdir must abort rather than push on and blame the write that follows.
        const { env, operations } = aptEnv({ mkdirResult: { ok: false, error: 'permission_denied' } });
        const extras = [
          {
            path: asAbsPath('/usr/share/wordlists/passwords.txt'),
            content: () => 'alpha',
            permissions: WORDLIST_PERMS,
          },
        ];

        const result = await drainExtraFiles(installExtraFiles(env, extras));

        expect(result).toEqual({ ok: false, error: 'permission_denied' });
        expect(operations).toEqual([{ kind: 'mkdir', path: '/usr/share' }]);
      });

      it("reports a rejected extra-file write in apt's failure shape", async () => {
        const { env } = aptEnv({ failWritesTo: '/usr/share/wordlists/passwords.txt' });

        const { lines, exitCode } = await streamResult(
          await apt.execute(env, ['install', 'hydra'], NO_FLAGS),
        );

        // The same shape the binary and library writes already use, so a player
        // reads one failure format regardless of which step broke.
        expect(lines.map((line) => line.content)).toContain(
          'E: Failed to install hydra (permission_denied)',
        );
        expect(exitCode).toBe(100);
      });
    });
  });

  it('shows usage for a missing subcommand', async () => {
    const { env } = aptEnv();

    const { text, exitCode } = syncResult(await apt.execute(env, [], NO_FLAGS));

    expect(text).toContain('apt install');
    expect(exitCode).toBe(100);
  });

  it('rejects an unknown operation', async () => {
    const { env } = aptEnv();

    const { text, exitCode } = syncResult(await apt.execute(env, ['frobnicate'], NO_FLAGS));

    expect(text).toContain('Invalid operation frobnicate');
    expect(exitCode).toBe(100);
  });

  it('tells the player both places an install can land a binary', async () => {
    // The manual said every binary goes to /usr/bin, which stopped being true the
    // moment daemons moved. A player who reads the manual and then lists /usr/bin
    // for the web server they just installed must not be sent to the wrong shelf.
    const description = apt.manual?.description ?? '';

    expect(description).toContain('/usr/bin');
    expect(description).toContain('/usr/sbin');
  });

  it('writes no libraries for a real apt package (none map to a library today)', async () => {
    // Drives the REAL libraryDeps via apt.execute: installing nmap writes its
    // binary but no /lib/*.so — locking the wiring as a present-day no-op that
    // goes live once lib-bearing tools + lib-incomplete machines land.
    const { env, writes } = aptEnv();

    await streamResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

    expect(writes.filter((write) => write.path.startsWith('/lib/'))).toEqual([]);
  });
});

/**
 * `installPackageLibraries` is the lib-install mechanism `apt install` composes:
 * it derives the libraries a package's binaries link (`libraryDeps`) and writes
 * any whose `/lib/<lib>.so` is MISSING, leaving present ones untouched. No real
 * apt package maps to a library yet, so the `deps` map is injected as a fixture
 * — the only way to observe the write/skip/perms logic until lib-bearing tools
 * and lib-incomplete remote machines exist.
 */
describe('installPackageLibraries', () => {
  /** An env whose `/lib` already holds `presentLibs` (as `.so` files) and whose
   *  `patches.write` is a spy; session is root, cwd `/`. */
  const libEnv = (presentLibs: readonly string[] = []) => {
    const writes: WriteCall[] = [];
    const tree = buildDirectory({
      lib: buildDirectory(
        Object.fromEntries(
          presentLibs.map((lib) => [`${lib}.so`, buildFile(BINARY_STUB, { owner: 'root' })]),
        ),
      ),
    });
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root' }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          writes.push({ path, content, options });
          return { ok: true };
        },
      },
    });
    return { env, writes };
  };

  const SSL_DEP: Readonly<Record<string, readonly SystemLibrary[]>> = { testtool: ['libssl'] };

  it('writes a missing /lib/<lib>.so with library perms, marked new', async () => {
    const { env, writes } = libEnv([]);

    const result = await installPackageLibraries(env, ['testtool'], SSL_DEP);

    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([
      {
        path: '/lib/libssl.so',
        content: BINARY_STUB,
        options: { isNew: true, permissions: LIBRARY_PERMS },
      },
    ]);
  });

  it('installs library content free of NUL bytes (Postgres TEXT cannot store them)', async () => {
    const { env, writes } = libEnv([]);

    await installPackageLibraries(env, ['testtool'], SSL_DEP);

    expect(writes[0].content).not.toContain('\u0000');
  });

  it('leaves an already-present library untouched', async () => {
    const { env, writes } = libEnv(['libssl']);

    const result = await installPackageLibraries(env, ['testtool'], SSL_DEP);

    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([]);
  });

  it('writes every missing library, not just the first', async () => {
    // A successful write must not end the walk — with only one library ever
    // written, "stop at the first failure" and "stop at the first write" are
    // indistinguishable, and the loop would quietly install one lib of many.
    const { env, writes } = libEnv([]);

    const result = await installPackageLibraries(env, ['testtool'], {
      testtool: ['libssl', 'libz'],
    });

    expect(result).toEqual({ ok: true });
    expect(writes.map((write) => write.path)).toEqual(['/lib/libssl.so', '/lib/libz.so']);
  });

  it('writes only the missing libraries of a multi-binary package, deduped', async () => {
    const { env, writes } = libEnv(['libz']); // libz present, libssl missing

    await installPackageLibraries(env, ['toolA', 'toolB'], {
      toolA: ['libssl'],
      toolB: ['libssl', 'libz'],
    });

    expect(writes.map((write) => write.path)).toEqual(['/lib/libssl.so']);
  });

  it('writes nothing for binaries that link no libraries', async () => {
    const { env, writes } = libEnv([]);

    const result = await installPackageLibraries(env, ['nodep'], { nodep: [] });

    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([]);
  });

  it('propagates a write failure and stops at the first one', async () => {
    const writes: WriteCall[] = [];
    const tree = buildDirectory({ lib: buildDirectory({}) });
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root' }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          writes.push({ path, content, options });
          return { ok: false, error: 'network_error' };
        },
      },
    });

    const result = await installPackageLibraries(env, ['toolA', 'toolB'], {
      toolA: ['libssl'],
      toolB: ['libz'],
    });

    expect(result).toEqual({ ok: false, error: 'network_error' });
    expect(writes).toHaveLength(1);
  });
});

/**
 * `apt list` shows the installable catalog; `apt list --installed` (or `-i`)
 * filters to packages whose binaries are already present on the machine. A
 * package is "installed" when its first binary resolves in `/bin`/`/usr/bin`
 * (the same resolver the binary-check wrapper uses). Online-gated, per the
 * owner decision — offline it errors, like `apt install`.
 */
describe('apt list', () => {
  /** An env whose `/usr/bin` already holds `installed` binaries; online by
   *  default. Session is a plain user — `apt list` needs no root. */
  const listEnv = (
    opts: { readonly installed?: readonly string[]; readonly online?: boolean } = {},
  ) => {
    const tree = buildDirectory({
      bin: buildDirectory({}),
      usr: buildDirectory({
        bin: buildDirectory(
          Object.fromEntries(
            (opts.installed ?? []).map((bin) => [bin, buildFile(BINARY_STUB, { owner: 'root' })]),
          ),
        ),
      }),
    });
    const env = mockCommandEnv({
      session: mockSession({ userType: 'user' }),
      network: mockNetworkView({ isOnline: () => opts.online ?? true }),
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
    });
    return { env };
  };

  const installedFlags = new Map<string, string | true>([['--installed', true]]);
  const iFlag = new Map<string, string | true>([['-i', true]]);

  it('lists every catalog package, tagging the ones already installed', async () => {
    const { env } = listEnv({ installed: ['nmap'] }); // nmap present, john absent

    const { lines, text, exitCode } = await streamResult(
      await apt.execute(env, ['list'], NO_FLAGS),
    );

    expect(exitCode).toBe(0);
    for (const pkg of APT_PACKAGES) expect(text).toContain(pkg.name);
    // Exact rows, not substrings: an uninstalled package carries NO suffix at
    // all, which "does not contain [installed]" cannot pin down.
    const rows = lines.map((line) => line.content);
    expect(rows).toContain('  nmap [installed]');
    expect(rows).toContain('  john');
  });

  it('with --installed, lists only the installed packages beneath the announcement', async () => {
    const { env } = listEnv({ installed: ['nmap'] });

    const { lines, exitCode } = await streamResult(
      await apt.execute(env, ['list'], installedFlags),
    );

    // The whole output: the announcement, then the one installed package. An
    // excluded package contributes NOTHING — not an empty or placeholder row.
    expect(lines).toEqual([
      { kind: 'text', content: 'Listing...' },
      { kind: 'text', content: '  nmap [installed]' },
    ]);
    expect(exitCode).toBe(0);
  });

  it('treats -i as an alias for --installed', async () => {
    const { env } = listEnv({ installed: ['nmap'] });

    const { text } = await streamResult(await apt.execute(env, ['list'], iFlag));

    expect(text).toContain('nmap');
    expect(text).not.toContain('john');
  });

  it('reflects filesystem state: with nothing installed, --installed lists no packages', async () => {
    const { env } = listEnv({ installed: [] });

    const { text, exitCode } = await streamResult(await apt.execute(env, ['list'], installedFlags));

    expect(exitCode).toBe(0);
    for (const pkg of APT_PACKAGES) expect(text).not.toContain(pkg.name);
  });

  it('errors offline and lists nothing', async () => {
    const { env } = listEnv({ online: false, installed: ['nmap'] });

    const { text, exitCode } = syncResult(await apt.execute(env, ['list'], NO_FLAGS));

    expect(exitCode).toBe(100);
    expect(text).toContain('are you connected to a network');
    expect(text).not.toContain('nmap');
  });
});

/**
 * The database a player BUYS.
 *
 * `apt install mysql` lays a datadir down the way `apt install hydra` lays down a
 * wordlist: announced, created with its containing directories, and left alone on a
 * reinstall because the file belongs to the player the moment it lands. What is new
 * is that the CONTENT is this player's own — drawn from their pubkey, so no two
 * players hold the same database.
 *
 * A constant datadir was the alternative, and it fails on one chain: the first
 * player to crack their own application account would hold a credential valid
 * against every database in the game. A wordlist can be a shared constant because
 * knowing it buys nothing; a password file cannot.
 */
describe('the database a player buys', () => {
  const OWNER_KEY = 'b'.repeat(64);
  const CONFIG = { machineName: 'workstation', username: 'alice', rootPassword: 'hunter2' };

  const buyMysql = async (opts: { readonly ownerKey?: string; readonly onto?: Directory } = {}) => {
    const ownerKey = opts.ownerKey ?? OWNER_KEY;
    const tree = opts.onto ?? buildWorkstationBaseFs(ownerKey, CONFIG);
    const writes: WriteCall[] = [];
    const operations: Operation[] = [];
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(ownerKey) }),
      hostname: CONFIG.machineName,
      session: mockSession({ userType: 'root' }),
      network: mockNetworkView({ isOnline: () => true }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          writes.push({ path, content, options });
          operations.push({ kind: 'write', path });
          return { ok: true };
        },
        mkdir: async (path) => {
          operations.push({ kind: 'mkdir', path });
          return { ok: true };
        },
      },
    });

    const streamed = await streamResult(await apt.execute(env, ['install', 'mysql'], NO_FLAGS));
    const datadir = writes.find((write) => write.path === DATADIR_PATH);
    return {
      writes,
      operations,
      streamed,
      tree,
      datadir,
      database: parseMysqlDatabase(datadir?.content ?? ''),
    };
  };

  /** The box as it stands once the install's datadir write has landed on it — what a
   *  later `cat` reads, rather than the write call on its own. */
  const withDatadir = (tree: Directory, datadir: WriteCall): Directory =>
    applyPatches(tree, [
      {
        path: asAbsPath(datadir.path),
        content: datadir.content,
        owner: DATADIR_OWNER,
        permissions: datadir.options?.permissions ?? DATADIR_FILE,
      },
    ]);

  it('lays the datadir down root-only, announced, and marked new', async () => {
    const { datadir, streamed } = await buyMysql();

    expect(datadir).toEqual({
      path: DATADIR_PATH,
      content: expect.any(String),
      options: { isNew: true, permissions: DATADIR_FILE },
    });
    expect(streamed.text).toContain(`Installing ${DATADIR_PATH} ...`);
    expect(streamed.exitCode).toBe(0);
  });

  it('creates the /var/lib/mysql a workstation does not have, before writing into it', async () => {
    // A fresh box has /var/log, /var/run and /var/www under /var and nothing else, so
    // the datadir's parents have to arrive first — a write into a directory that does
    // not exist is refused outright.
    const { operations } = await buyMysql();

    expect(operations).toEqual([
      { kind: 'write', path: '/usr/bin/mysql' },
      { kind: 'write', path: '/usr/sbin/mysqld' },
      { kind: 'mkdir', path: '/var/lib' },
      { kind: 'mkdir', path: '/var/lib/mysql' },
      { kind: 'write', path: DATADIR_PATH },
    ]);
  });

  it('holds a database drawn for THIS player — two owners never share one', async () => {
    const mine = await buyMysql({ ownerKey: OWNER_KEY });
    const theirs = await buyMysql({ ownerKey: 'c'.repeat(64) });

    expect(mine.database).not.toBeNull();
    expect(theirs.database).not.toBeNull();
    expect(theirs.datadir?.content).not.toBe(mine.datadir?.content);
  });

  it('hands one player the same database however often they buy it', async () => {
    // Deleting a shipped data file and reinstalling is the documented way to get it
    // back. For a database that has to mean the SAME database, or a player could
    // reroll their own accounts until the draw suited them.
    const first = await buyMysql();
    const second = await buyMysql();

    expect(second.datadir?.content).toBe(first.datadir?.content);
  });

  it('answers to the root password the player chose for the box', async () => {
    // Nothing to look up, print, store or delete: the database's root is the password
    // they already typed at their own prompt. Read from the box's own /etc/passwd, so
    // the two cannot say different things about one secret.
    const { database, tree } = await buyMysql();

    const dbRoot = database?.credentials.find((credential) => credential.username === 'root');
    expect(dbRoot?.passwordHash).toBe(md5(CONFIG.rootPassword));
    expect(dbRoot?.passwordHash).toBe(accountIn(tree, 'root')?.hash);
  });

  it('draws its other accounts, so cracking the box is not cracking the database', async () => {
    // The attack surface this leaves standing. Root is effectively uncrackable now — a
    // chosen password is almost never in the wordlist — which is the accepted cost, but
    // the accounts below it are drawn on the world's usual ladder, and they are what a
    // sweep of this door is for.
    const { database, tree } = await buyMysql();

    const others = (database?.credentials ?? []).filter(
      (credential) => credential.username !== 'root',
    );
    const boxHashes = accountsIn(tree).map((account) => account.hash);
    expect(others.length).toBeGreaterThan(0);
    for (const credential of others) expect(boxHashes).not.toContain(credential.passwordHash);
  });

  it('leads its users table with the account whose home a visitor can see', async () => {
    const { database } = await buyMysql();

    const names = (database?.tables.users?.rows ?? []).map((row) => row.username);
    expect(names[0]).toBe(CONFIG.username);
  });

  it('writes the two binaries and the datadir, and nothing else at all', async () => {
    // No /etc/mysql.cnf: nothing in the game reads one, and a static `port=3306` would
    // be contradicted the first time the player runs `mysqld 3307`. No `mysql` line in
    // /etc/passwd either — NPC database boxes carry no such account, so adding one here
    // would make the player's box the odd box rather than the consistent one.
    const { writes } = await buyMysql();

    expect(writes.map((write) => write.path)).toEqual([
      '/usr/bin/mysql',
      '/usr/sbin/mysqld',
      DATADIR_PATH,
    ]);
  });

  it('prints no password and no hash while it does it', async () => {
    const { streamed, database } = await buyMysql();

    expect(streamed.text).not.toContain(CONFIG.rootPassword);
    for (const credential of database?.credentials ?? []) {
      expect(streamed.text).not.toContain(credential.passwordHash);
    }
  });

  it('lets root read the account hashes, and no tier below it', async () => {
    // The only way to read this file directly is to already own the box, which is a
    // different achievement from cracking its database — and the door the database
    // opens grants no filesystem access at all, so the tiers it hands out must not
    // reach the answer key.
    const { tree, datadir } = await buyMysql();
    if (datadir === undefined) throw new Error('no datadir written');
    const box = withDatadir(tree, datadir);

    expect(createFsView(box, { userType: 'root' }).read(DATADIR_PATH)).toEqual({
      ok: true,
      content: datadir.content,
    });
    expect(createFsView(box, { userType: 'user' }).read(DATADIR_PATH)).toEqual({
      ok: false,
      error: 'permission_denied',
    });
    expect(createFsView(box, { userType: 'guest' }).read(DATADIR_PATH)).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('leaves a database the player has been using exactly where it is', async () => {
    // The wordlist rule, and it matters more here: a reinstall that rewrote the datadir
    // would destroy every row the player had inserted, every account they had added and
    // every table they had dropped, with one line on screen to say so.
    const mine = await buyMysql();
    if (mine.datadir === undefined) throw new Error('no datadir written');
    const livedIn = withDatadir(mine.tree, {
      ...mine.datadir,
      content: JSON.stringify({ name: 'mine', tables: {}, credentials: [] }),
    });

    const again = await buyMysql({ onto: livedIn });

    expect(again.writes.map((write) => write.path)).toEqual(['/usr/bin/mysql', '/usr/sbin/mysqld']);
    expect(again.streamed.text).toContain(`${DATADIR_PATH} already exists, keeping your copy`);
  });

  /** The box with the named rows cut out of `/etc/passwd` — something only root can
   *  do, and root is exactly who installs a database. */
  const withoutAccount = (tree: Directory, username: string): Directory => {
    const passwd = createFsView(tree, { userType: 'root' }).read(asAbsPath('/etc/passwd'));
    if (!passwd.ok) throw new Error('no passwd on the box');
    return applyPatches(tree, [
      {
        path: asAbsPath('/etc/passwd'),
        content: passwd.content
          .split('\n')
          .filter((line) => line.length > 0 && line.split(':')[0] !== username)
          .join('\n'),
        owner: 'root',
        permissions: PASSWD_FILE,
      },
    ]);
  };

  it('keeps the drawn root password on a box that declares no root account', async () => {
    // A box with nothing to mirror gets the password the draw gave it. Inventing one
    // instead would put a secret on the box that its own passwd file has never heard
    // of — and the install has to survive a vandalised passwd either way, because a
    // root player editing that file is ordinary play.
    const vandalised = withoutAccount(buildWorkstationBaseFs(OWNER_KEY, CONFIG), 'root');

    const { database } = await buyMysql({ onto: vandalised });
    const intact = await buyMysql();

    const dbRoot = database?.credentials.find((credential) => credential.username === 'root');
    expect(dbRoot?.passwordHash).not.toBe(md5(CONFIG.rootPassword));
    // A real drawn hash, specifically — not whatever hash sits on whichever row came
    // first once root's is gone. The player's own passwd row carries an EMPTY hash
    // (they can always exit() back to their own shell), so mirroring the wrong
    // account would leave the database's root answering to nothing at all.
    expect(dbRoot?.passwordHash).toMatch(/^[0-9a-f]{32}$/);
    // Everything else is the same draw: only the mirroring dropped out.
    expect(database?.name).toBe(intact.database?.name);
  });

  it('leads the users table with guest on a box that declares no ordinary user', async () => {
    // The one account every box keeps, so the table is still led by somebody who is
    // really there rather than by a name invented to fill the row.
    const vandalised = withoutAccount(
      buildWorkstationBaseFs(OWNER_KEY, CONFIG),
      CONFIG.username,
    );

    const { database } = await buyMysql({ onto: vandalised });

    const names = (database?.tables.users?.rows ?? []).map((row) => row.username);
    expect(names[0]).toBe('guest');
  });
});
