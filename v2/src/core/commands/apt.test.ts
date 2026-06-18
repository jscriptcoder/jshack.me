import { describe, expect, it } from 'vitest';
import { BINARY_STUB } from '../generation/binaries';
import type { SystemLibrary } from '../generation/libraries';
import type { FilePermissions } from '../filesystem/types';
import { asAbsPath, type UserType } from '../types';
import type { CommandResult, PatchResult } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkView,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { apt, installPackageLibraries } from './apt';
import { APT_PACKAGES } from './aptPackages';

/**
 * `apt install` is the reachability mechanism: as root + online, it writes a
 * package's binary stub(s) into `/usr/bin` so a previously not-found command
 * becomes runnable. The tests capture every `patches.write` so the "refused ⇒
 * nothing written" invariants (offline, non-root, unknown package) are provable,
 * and assert the install stamps WORLD-EXECUTABLE perms so the user-tier player —
 * not just root — can run the tool afterwards.
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
};

/** An env whose `patches.write` is a spy: it records each call and returns a
 *  configurable result, so installs are observable and a rejected write is
 *  exercisable. Defaults: root + online + writes succeed. */
const aptEnv = (opts: AptEnvOpts = {}) => {
  const writes: WriteCall[] = [];
  const env = mockCommandEnv({
    session: mockSession({ userType: opts.userType ?? 'root' }),
    network: mockNetworkView({ isOnline: () => opts.online ?? true }),
    patches: {
      ...mockPatchApi(),
      write: async (path, content, options) => {
        writes.push({ path, content, options });
        return opts.writeResult ?? { ok: true };
      },
    },
  });
  return { env, writes };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('apt', () => {
  describe('install', () => {
    it('installs a package binary into /usr/bin, world-executable, marked new', async () => {
      const { env, writes } = aptEnv();

      const { text, exitCode } = syncResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

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

      await apt.execute(env, ['install', 'nmap'], NO_FLAGS);

      expect(writes[0].content).not.toContain('\u0000');
    });

    it('installs every binary a multi-binary package ships, in catalog order', async () => {
      const { env, writes } = aptEnv();

      await apt.execute(env, ['install', 'aircrack'], NO_FLAGS);

      expect(writes.map((write) => write.path)).toEqual([
        '/usr/bin/airmon',
        '/usr/bin/airdump',
        '/usr/bin/aircrack',
      ]);
    });

    it('installs a package whose binary name differs from the package name', async () => {
      const { env, writes } = aptEnv();

      await apt.execute(env, ['install', 'netcat'], NO_FLAGS);

      expect(writes.map((write) => write.path)).toEqual(['/usr/bin/nc']);
    });

    it('refuses to install as a non-root user and writes nothing', async () => {
      const { env, writes } = aptEnv({ userType: 'user' });

      const { text, exitCode } = syncResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      expect(text).toContain('Permission denied');
      expect(text).toContain('are you root?');
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

    it('reports an unknown package and writes nothing', async () => {
      const { env, writes } = aptEnv();

      const { text, exitCode } = syncResult(
        await apt.execute(env, ['install', 'boguspkg'], NO_FLAGS),
      );

      expect(text).toContain('Unable to locate package boguspkg');
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

    it('reports failure when a write is rejected', async () => {
      const { env } = aptEnv({ writeResult: { ok: false, error: 'permission_denied' } });

      const { text, exitCode } = syncResult(await apt.execute(env, ['install', 'nmap'], NO_FLAGS));

      expect(text).toContain('Failed to install nmap');
      expect(exitCode).toBe(100);
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

  it('writes no libraries for a real apt package (none map to a library today)', async () => {
    // Drives the REAL libraryDeps via apt.execute: installing nmap writes its
    // binary but no /lib/*.so — locking the wiring as a present-day no-op that
    // goes live once lib-bearing tools + lib-incomplete machines land.
    const { env, writes } = aptEnv();

    await apt.execute(env, ['install', 'nmap'], NO_FLAGS);

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

    const { text, exitCode } = syncResult(await apt.execute(env, ['list'], NO_FLAGS));

    expect(exitCode).toBe(0);
    for (const pkg of APT_PACKAGES) expect(text).toContain(pkg.name);
    expect(text).toContain('nmap [installed]');
    expect(text).not.toContain('john [installed]');
  });

  it('with --installed, shows only the installed packages', async () => {
    const { env } = listEnv({ installed: ['nmap'] });

    const { text, exitCode } = syncResult(await apt.execute(env, ['list'], installedFlags));

    expect(exitCode).toBe(0);
    expect(text).toContain('nmap');
    expect(text).not.toContain('john'); // not installed → excluded
  });

  it('treats -i as an alias for --installed', async () => {
    const { env } = listEnv({ installed: ['nmap'] });

    const { text } = syncResult(await apt.execute(env, ['list'], iFlag));

    expect(text).toContain('nmap');
    expect(text).not.toContain('john');
  });

  it('reflects filesystem state: with nothing installed, --installed lists no packages', async () => {
    const { env } = listEnv({ installed: [] });

    const { text, exitCode } = syncResult(await apt.execute(env, ['list'], installedFlags));

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
