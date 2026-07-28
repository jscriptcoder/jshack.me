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
import { sshd } from './sshd';

/**
 * `sshd` brings up the OpenSSH daemon on the current machine by writing
 * `/var/run/sshd.pid` — the literal source of truth a later `nmap`/`ssh` reads to
 * see port 22 open. It is root-only (a daemon needs root), refuses to start when
 * already running, and validates the optional port. The tests capture every
 * `patches.write` so "refused ⇒ nothing written" is provable.
 *
 * Starting the daemon STREAMS: the announcement must reach the terminal while
 * the start is still pending, so the tests drain the stream rather than reading
 * a collected line set — and a refusal, which does no work at all, stays sync.
 */

const NO_FLAGS = new Map<string, string | true>();

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?: { readonly isNew?: boolean } | undefined;
};

type SshdEnvOpts = {
  readonly userType?: UserType;
  /** Existing `/var/run/sshd.pid` content (omit ⇒ not running). */
  readonly pidfile?: string;
  readonly writeResult?: PatchResult;
};

/** An env whose `/var/run` optionally holds a pidfile and whose `patches.write`
 *  is a spy. Defaults: root, not running, writes succeed. */
const sshdEnv = (opts: SshdEnvOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const writes: WriteCall[] = [];
  const run =
    opts.pidfile === undefined
      ? buildDirectory({})
      : buildDirectory({ 'sshd.pid': buildFile(opts.pidfile, { owner: 'root' }) });
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

/** The FIRST streamed line, pulled without draining the rest — leaving the
 *  command suspended mid-flight so the world it hasn't touched yet is
 *  inspectable. */
const firstStreamedLine = async (result: CommandResult): Promise<TerminalLine | undefined> => {
  if (result.kind !== 'async') throw new Error('async expected');
  for await (const line of result.lines) return line;
  return undefined;
};

describe('sshd', () => {
  it('announces the daemon start before the pidfile is written', async () => {
    const { env, writes } = sshdEnv();

    const first = await firstStreamedLine(await sshd.execute(env, [], NO_FLAGS));

    // The player must see the daemon starting WHILE it starts, not after: the
    // announcement is out before the write that actually opens the port.
    expect(first).toEqual({ kind: 'text', content: 'Starting OpenSSH server...' });
    expect(writes).toEqual([]);
  });

  it('starts on the default port, writing /var/run/sshd.pid as a new file', async () => {
    const { env, writes } = sshdEnv();

    const { lines, exitCode } = await streamResult(await sshd.execute(env, [], NO_FLAGS));

    expect(writes).toEqual([
      { path: '/var/run/sshd.pid', content: 'sshd:port=22', options: { isNew: true } },
    ]);
    // Exact output: a success renders as plain `text` lines with the daemon banner.
    expect(lines).toEqual([
      { kind: 'text', content: 'Starting OpenSSH server...' },
      { kind: 'text', content: 'Server listening on 0.0.0.0 port 22.' },
    ]);
    expect(exitCode).toBe(0);
  });

  it('starts on a given port, writing that port into the pidfile', async () => {
    const { env, writes } = sshdEnv();

    const { text, exitCode } = await streamResult(await sshd.execute(env, ['2222'], NO_FLAGS));

    expect(writes[0].content).toBe('sshd:port=2222');
    expect(text).toContain('port 2222');
    expect(exitCode).toBe(0);
  });

  it('refuses to start as a non-root user and writes nothing', async () => {
    const { env, writes } = sshdEnv({ userType: 'user' });

    const result = await sshd.execute(env, [], NO_FLAGS);

    // A refusal renders as an `error` line (red), not plain text.
    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'sshd: must be run as root' }],
      exitCode: 1,
    });
    expect(writes).toEqual([]);
  });

  it('refuses to start for a guest too', async () => {
    const { env, writes } = sshdEnv({ userType: 'guest' });

    const { exitCode } = syncResult(await sshd.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('refuses to start when already running, reporting the running port, writing nothing', async () => {
    const { env, writes } = sshdEnv({ pidfile: 'sshd:port=22' });

    const { text, exitCode } = syncResult(await sshd.execute(env, [], NO_FLAGS));

    expect(text).toContain('already running');
    expect(text).toContain('22');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('reports the actual running port when already running on a custom port', async () => {
    const { env } = sshdEnv({ pidfile: 'sshd:port=2222' });

    const { text } = syncResult(await sshd.execute(env, [], NO_FLAGS));

    expect(text).toContain('2222');
  });

  it('rejects a non-numeric port and writes nothing', async () => {
    const { env, writes } = sshdEnv();

    const { text, exitCode } = syncResult(await sshd.execute(env, ['abc'], NO_FLAGS));

    expect(text).toContain('invalid port');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('rejects an out-of-range port (0 and 65536) and writes nothing', async () => {
    const low = sshdEnv();
    const high = sshdEnv();

    const lowResult = syncResult(await sshd.execute(low.env, ['0'], NO_FLAGS));
    const highResult = syncResult(await sshd.execute(high.env, ['65536'], NO_FLAGS));

    expect(lowResult.exitCode).toBe(1);
    expect(highResult.exitCode).toBe(1);
    expect(low.writes).toEqual([]);
    expect(high.writes).toEqual([]);
  });

  it('accepts the boundary ports 1 and 65535', async () => {
    const lowEnv = sshdEnv();
    const highEnv = sshdEnv();

    await streamResult(await sshd.execute(lowEnv.env, ['1'], NO_FLAGS));
    await streamResult(await sshd.execute(highEnv.env, ['65535'], NO_FLAGS));

    expect(lowEnv.writes[0].content).toBe('sshd:port=1');
    expect(highEnv.writes[0].content).toBe('sshd:port=65535');
  });

  it('reports a write failure as an error after the announcement, surfacing the reason', async () => {
    const { env } = sshdEnv({ writeResult: { ok: false, error: 'network_error' } });

    const { lines, exitCode } = await streamResult(await sshd.execute(env, [], NO_FLAGS));

    // The announcement is already out when the start fails, so the failure
    // follows it rather than replacing it — and it renders red.
    expect(lines).toEqual([
      { kind: 'text', content: 'Starting OpenSSH server...' },
      { kind: 'error', content: 'sshd: I/O error' },
    ]);
    expect(exitCode).toBe(1);
  });

  it('treats a non-file at the pidfile path as not running, and starts', async () => {
    // Defensive: if `/var/run/sshd.pid` is unexpectedly a directory (no content
    // to parse), sshd must not crash — it proceeds as if not running.
    const writes: WriteCall[] = [];
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'sshd.pid': buildDirectory({}) }) }),
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

    const { exitCode } = await streamResult(await sshd.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(writes).toEqual([
      { path: '/var/run/sshd.pid', content: 'sshd:port=22', options: { isNew: true } },
    ]);
  });
});
