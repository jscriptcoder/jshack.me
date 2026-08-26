import { describe, expect, it } from 'vitest';
import { redis, DAEMONS } from './daemon';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { formatPidfileContent, pidfilePath, readOpenPorts, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { applyPatches } from '../filesystem/applyPatches';
import { asAbsPath, type UserType } from '../types';
import type { CommandResult, TerminalLine } from './types';

/**
 * `redis` — the sixth front door, and the second a player has to BUY.
 *
 * It is the same daemon every other one is: the whole of "the store is up" is the
 * pidfile it writes, so `nmap`, `ps`, `systemctl` and `rediscli` all read one file and
 * cannot disagree about whether the port is open.
 *
 * The name has no `d`. A command name becomes a formal PARAMETER of the function a
 * script runs, so `redis-server` would be a syntax error that takes every script in the
 * game down — and the package's name IS the daemon's, exactly as `nginx` and `apache2`
 * already are.
 */

const NO_FLAGS = new Map<string, string | true>();

const boxWith = (opts: { readonly pidfile?: string; readonly installed?: boolean } = {}) => {
  const base = buildDirectory({
    usr: buildDirectory({
      sbin: buildDirectory(
        opts.installed === false ? {} : { redis: buildFile('#!/bin/sh', { owner: 'root' }) },
      ),
    }),
    var: buildDirectory({
      run: buildDirectory(
        opts.pidfile === undefined
          ? {}
          : { 'redis.pid': buildFile(opts.pidfile, { owner: 'root' }) },
      ),
    }),
  });
  return base;
};

const envFor = (tree: ReturnType<typeof boxWith>, userType: UserType = 'root') => {
  const writes: { path: string; content: string }[] = [];
  const env = mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
    patches: {
      write: async (path, content) => {
        writes.push({ path, content });
        return { ok: true };
      },
      mkdir: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
    },
  });
  return { env, writes };
};

const streamResult = async (
  result: CommandResult,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  // Bringing a daemon up STREAMS: the start is announced before the write that opens
  // the port, so the player watches it come up rather than being told afterwards. The
  // gates refuse instantly and never reach the daemon, so those stay sync.
  if (result.kind === 'sync') {
    return {
      text: result.lines.map((line: TerminalLine) => line.content).join('\n'),
      exitCode: result.exitCode,
    };
  }
  if (result.kind !== 'async') throw new Error('a daemon start is never a mode change');
  const lines: TerminalLine[] = [];
  for await (const line of result.lines) lines.push(line);
  return {
    text: lines.map((line) => line.content).join('\n'),
    exitCode: await result.exitCode(),
  };
};

describe('starting the store daemon', () => {
  it('opens the store port by writing the pidfile every other tool reads', async () => {
    const { env, writes } = envFor(boxWith());

    const result = await streamResult(await redis.execute(env, [], NO_FLAGS));

    const written = writes.find((write) => write.path === pidfilePath(SERVICE_CATALOG.redis));
    expect(written?.content).toBe(
      formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
    );
    expect(result.exitCode).toBe(0);
  });

  it('shows the port as open to anything that reads the box own pidfiles', async () => {
    // The pidfile IS the claim, so a daemon that started has to be a daemon `nmap`
    // finds — one file, read by every tool that asks the question.
    const { env, writes } = envFor(boxWith());
    await streamResult(await redis.execute(env, ['6380'], NO_FLAGS));

    const running = applyPatches(boxWith(), [
      {
        path: pidfilePath(SERVICE_CATALOG.redis),
        content: writes[0]?.content ?? '',
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);

    expect(readOpenPorts(running)).toContainEqual({
      port: 6380,
      service: SERVICE_CATALOG.redis.service,
    });
  });

  it('refuses a second start, because a port cannot be bound twice', async () => {
    const { env, writes } = envFor(
      boxWith({ pidfile: formatPidfileContent(SERVICE_CATALOG.redis, 6379) }),
    );

    const result = await streamResult(await redis.execute(env, [], NO_FLAGS));

    expect(result.text).toContain('6379');
    expect(result.exitCode).not.toBe(0);
    expect(writes).toEqual([]);
  });

  it('refuses a caller who is not root, before anything is written', async () => {
    // Binding the port and writing the pidfile need root, modelled as a clean up-front
    // check rather than a half-started daemon.
    const { env, writes } = envFor(boxWith(), 'user');

    const result = await streamResult(await redis.execute(env, [], NO_FLAGS));

    expect(result.exitCode).not.toBe(0);
    expect(writes).toEqual([]);
  });

  it('is the unit systemctl brings up under the name the package installs', async () => {
    // `systemctl start redis` and typing `redis` are one action: the registry is what
    // keeps them from becoming two daemons that disagree about the port.
    expect(DAEMONS['redis']?.spec).toBe(SERVICE_CATALOG.redis);
  });

  it('is not runnable until the package that provides it is installed', async () => {
    expect(redis.availability).toEqual({ kind: 'installed-package', packageName: 'redis' });
  });
});
