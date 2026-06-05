import { describe, expect, it } from 'vitest';
import { BINARY_STUB } from '../generation/binaries';
import type { FilePermissions } from '../filesystem/types';
import type { UserType } from '../types';
import type { CommandResult, PatchResult } from './types';
import {
  mockCommandEnv,
  mockNetworkView,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { apt } from './apt';

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

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?: { readonly isNew?: boolean; readonly permissions?: FilePermissions } | undefined;
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
});
