import { describe, expect, it } from 'vitest';
import { asAbsPath, type UserType } from '../types';
import type { CommandResult, PatchResult, TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { vsftpd } from './daemon';

/**
 * `vsftpd` brings up the FTP daemon on the current machine by writing
 * `/var/run/vsftpd.pid` — the literal source of truth a later `nmap`/`ftp` reads to
 * see port 21 open. It mirrors `sshd`'s gates exactly (root-only, refuses when
 * already running, validates the optional port), because a second door that behaved
 * differently from the first would be a second set of rules to learn.
 *
 * This is what lets a player OPEN the door on their own box — the defender's half of
 * D3, and what `systemctl` will later stop.
 */

const NO_FLAGS = new Map<string, string | true>();

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?: { readonly isNew?: boolean } | undefined;
};

type VsftpdEnvOpts = {
  readonly userType?: UserType;
  /** Existing `/var/run/vsftpd.pid` content (omit ⇒ not running). */
  readonly pidfile?: string;
  readonly writeResult?: PatchResult;
};

/** An env whose `/var/run` optionally holds a pidfile and whose `patches.write`
 *  is a spy. Defaults: root, not running, writes succeed. */
const vsftpdEnv = (opts: VsftpdEnvOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const writes: WriteCall[] = [];
  const run =
    opts.pidfile === undefined
      ? buildDirectory({})
      : buildDirectory({ 'vsftpd.pid': buildFile(opts.pidfile, { owner: 'root' }) });
  const tree = buildDirectory({ var: buildDirectory({ run }) });
  const env = mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
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

/** The FIRST streamed line, pulled without draining the rest — leaving the command
 *  suspended mid-flight so the world it hasn't touched yet is inspectable. */
const firstStreamedLine = async (result: CommandResult): Promise<TerminalLine | undefined> => {
  if (result.kind !== 'async') throw new Error('async expected');
  for await (const line of result.lines) return line;
  return undefined;
};

describe('vsftpd', () => {
  it('announces the daemon start before the pidfile is written', async () => {
    const { env, writes } = vsftpdEnv();

    const first = await firstStreamedLine(await vsftpd.execute(env, [], NO_FLAGS));

    expect(first).toEqual({ kind: 'text', content: 'Starting FTP server...' });
    expect(writes).toEqual([]);
  });

  it('starts on port 21, writing /var/run/vsftpd.pid as a new file', async () => {
    const { env, writes } = vsftpdEnv();

    const { lines, exitCode } = await streamResult(await vsftpd.execute(env, [], NO_FLAGS));

    // The pidfile's daemon name is `vsftpd` while the service `nmap` labels is `ftp`
    // — the program and the protocol are not the same word, and both readers depend
    // on getting their own.
    expect(writes).toEqual([
      { path: '/var/run/vsftpd.pid', content: 'vsftpd:port=21', options: { isNew: true } },
    ]);
    expect(lines).toEqual([
      { kind: 'text', content: 'Starting FTP server...' },
      { kind: 'text', content: 'Server listening on 0.0.0.0 port 21.' },
    ]);
    expect(exitCode).toBe(0);
  });

  it('starts on a given port, writing that port into the pidfile', async () => {
    const { env, writes } = vsftpdEnv();

    const { text, exitCode } = await streamResult(await vsftpd.execute(env, ['2121'], NO_FLAGS));

    expect(writes[0].content).toBe('vsftpd:port=2121');
    expect(text).toContain('port 2121');
    expect(exitCode).toBe(0);
  });

  it('refuses to start as a non-root user and writes nothing', async () => {
    const { env, writes } = vsftpdEnv({ userType: 'user' });

    const result = await vsftpd.execute(env, [], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'vsftpd: must be run as root' }],
      exitCode: 1,
    });
    expect(writes).toEqual([]);
  });

  it('refuses to start for a guest too', async () => {
    const { env, writes } = vsftpdEnv({ userType: 'guest' });

    const { exitCode } = syncResult(await vsftpd.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('refuses to start when already running, reporting the running port, writing nothing', async () => {
    const { env, writes } = vsftpdEnv({ pidfile: 'vsftpd:port=21' });

    const { text, exitCode } = syncResult(await vsftpd.execute(env, [], NO_FLAGS));

    expect(text).toContain('already running');
    expect(text).toContain('21');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('reports the actual running port when already running on a custom port', async () => {
    const { env } = vsftpdEnv({ pidfile: 'vsftpd:port=2121' });

    const { text } = syncResult(await vsftpd.execute(env, [], NO_FLAGS));

    expect(text).toContain('2121');
  });

  it('rejects a non-numeric port and writes nothing', async () => {
    const { env, writes } = vsftpdEnv();

    const { text, exitCode } = syncResult(await vsftpd.execute(env, ['abc'], NO_FLAGS));

    expect(text).toContain('invalid port');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('rejects an out-of-range port (0 and 65536) and writes nothing', async () => {
    const low = vsftpdEnv();
    const high = vsftpdEnv();

    const lowResult = syncResult(await vsftpd.execute(low.env, ['0'], NO_FLAGS));
    const highResult = syncResult(await vsftpd.execute(high.env, ['65536'], NO_FLAGS));

    expect(lowResult.exitCode).toBe(1);
    expect(highResult.exitCode).toBe(1);
    expect(low.writes).toEqual([]);
    expect(high.writes).toEqual([]);
  });

  it('accepts the extreme valid ports, 1 and 65535', async () => {
    // The other side of the range check: rejecting 0 and 65536 proves nothing about
    // where the boundary sits unless the first and last legal ports are let through.
    const low = vsftpdEnv();
    const high = vsftpdEnv();

    const lowResult = await streamResult(await vsftpd.execute(low.env, ['1'], NO_FLAGS));
    const highResult = await streamResult(await vsftpd.execute(high.env, ['65535'], NO_FLAGS));

    expect(lowResult.exitCode).toBe(0);
    expect(low.writes[0].content).toBe('vsftpd:port=1');
    expect(highResult.exitCode).toBe(0);
    expect(high.writes[0].content).toBe('vsftpd:port=65535');
  });

  it('treats a directory at the pidfile path as not running, and starts', async () => {
    // `mkdir /var/run/vsftpd.pid` is something a root player can really do. A pidfile
    // is a FILE; a directory wearing its name is not a running daemon, and reading it
    // as one would let anybody bar the door with one command.
    const writes: WriteCall[] = [];
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'vsftpd.pid': buildDirectory({}) }) }),
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

    const { exitCode } = await streamResult(await vsftpd.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(writes[0].content).toBe('vsftpd:port=21');
  });

  it('reports a refused write as a daemon failure rather than opening the port', async () => {
    const { env } = vsftpdEnv({ writeResult: { ok: false, error: 'permission_denied' } });

    const { text, exitCode } = await streamResult(await vsftpd.execute(env, [], NO_FLAGS));

    expect(text).toContain('vsftpd: Permission denied');
    expect(exitCode).toBe(1);
  });
});
