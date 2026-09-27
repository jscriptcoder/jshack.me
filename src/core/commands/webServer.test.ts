import { describe, expect, it } from 'vitest';
import { asAbsPath, type UserType } from '../types';
import type { Command, CommandResult, PatchResult, TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { PIDFILE_PERMISSIONS, readOpenPorts } from '../services/pidfile';
import { commandRegistry } from './registry';
import { apache2, nginx } from './daemon';

/**
 * `nginx` and `apache2` bring up THE web server on the current machine. They are
 * two names for one capability: both write `/var/run/nginx.pid`, so whichever
 * starts first owns port 80 and the other is refused — you cannot bind a port
 * twice, and the player learns that by being told a web server is already up
 * rather than being told a lie about which program it was.
 *
 * Root-only, unconditionally. The "ports below 1024 need root" rule is
 * deliberately absent: the root gate fires before the port is ever parsed, so a
 * non-root caller can never reach a port check at all. A high port is refused
 * for the same reason as a low one — you are not root.
 *
 * The pidfile IS the open port: these tests assert through `readOpenPorts` where
 * the claim is "the port is now open", so what a daemon writes and what a scan
 * later shows cannot drift apart.
 */

const NO_FLAGS = new Map<string, string | true>();

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?: { readonly isNew?: boolean } | undefined;
};

type WebServerEnvOpts = {
  readonly userType?: UserType;
  /** Existing `/var/run/nginx.pid` content (omit ⇒ no web server running). */
  readonly pidfile?: string;
  readonly writeResult?: PatchResult;
};

/** An env whose `/var/run` optionally already holds the web server's pidfile and
 *  whose `patches.write` is a spy. Defaults: root, nothing running, writes
 *  succeed. */
const webServerEnv = (opts: WebServerEnvOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const writes: WriteCall[] = [];
  const run =
    opts.pidfile === undefined
      ? buildDirectory({})
      : buildDirectory({ 'nginx.pid': buildFile(opts.pidfile, { owner: 'root' }) });
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

/** Both server programs, so every gate is proven for each name rather than for
 *  `nginx` with `apache2` assumed to follow. */
const BOTH_SERVERS: readonly (readonly [string, Command])[] = [
  ['nginx', nginx],
  ['apache2', apache2],
];

describe('the web server daemon', () => {
  it.each(BOTH_SERVERS)('%s opens port 80 as a running http service', async (_name, server) => {
    const { env, writes } = webServerEnv();

    const { exitCode } = await streamResult(await server.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    // The claim is "the port is open", so it is asserted the way a scan will
    // later ask: through the pidfile reader, not the written bytes.
    const started = buildDirectory({
      var: buildDirectory({
        run: buildDirectory({ 'nginx.pid': buildFile(writes[0].content, { owner: 'root' }) }),
      }),
    });
    expect(readOpenPorts(started)).toEqual([{ port: 80, service: 'http' }]);
  });

  it.each(BOTH_SERVERS)(
    '%s writes the shared web pidfile as a new file',
    async (_name, server) => {
      const { env, writes } = webServerEnv();

      await streamResult(await server.execute(env, [], NO_FLAGS));

      // BOTH programs write the same path: one web identity, two names for it.
      expect(writes).toEqual([
        {
          path: '/var/run/nginx.pid',
          content: 'nginx:port=80',
          options: { isNew: true, permissions: PIDFILE_PERMISSIONS },
        },
      ]);
    },
  );

  it.each(BOTH_SERVERS)('%s announces the start before the port opens', async (_name, server) => {
    const { env, writes } = webServerEnv();

    const first = await firstStreamedLine(await server.execute(env, [], NO_FLAGS));

    expect(first?.kind).toBe('text');
    expect(first?.content).toContain('Starting');
    // Nothing is written yet: the player sees it coming up WHILE it comes up.
    expect(writes).toEqual([]);
  });

  it('names the program it is starting, so the player sees which one they ran', async () => {
    const nginxEnv = webServerEnv();
    const apacheEnv = webServerEnv();

    const started = await streamResult(await nginx.execute(nginxEnv.env, [], NO_FLAGS));
    const startedApache = await streamResult(await apache2.execute(apacheEnv.env, [], NO_FLAGS));

    expect(started.lines).toEqual([
      { kind: 'text', content: 'Starting nginx...' },
      { kind: 'text', content: 'Server listening on 0.0.0.0 port 80.' },
    ]);
    expect(startedApache.lines).toEqual([
      { kind: 'text', content: 'Starting Apache httpd...' },
      { kind: 'text', content: 'Server listening on 0.0.0.0 port 80.' },
    ]);
  });

  it.each(BOTH_SERVERS)('%s starts on a given port, writing that port', async (_name, server) => {
    const { env, writes } = webServerEnv();

    const { text, exitCode } = await streamResult(await server.execute(env, ['8080'], NO_FLAGS));

    expect(writes[0].content).toBe('nginx:port=8080');
    expect(text).toContain('port 8080');
    expect(exitCode).toBe(0);
  });

  it.each(BOTH_SERVERS)('%s refuses a non-root caller and writes nothing', async (name, server) => {
    const { env, writes } = webServerEnv({ userType: 'user' });

    const result = await server.execute(env, [], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: `${name}: must be run as root` }],
      exitCode: 1,
    });
    expect(writes).toEqual([]);
  });

  it.each(BOTH_SERVERS)('%s refuses a guest too', async (_name, server) => {
    const { env, writes } = webServerEnv({ userType: 'guest' });

    const { exitCode } = syncResult(await server.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each(BOTH_SERVERS)(
    '%s refuses a non-root caller even on a port above 1024 — root or nothing',
    async (_name, server) => {
      // The Unix "low ports need root" rule is NOT modelled: there is no port a
      // non-root caller may bind, so no test may imply otherwise.
      const { env, writes } = webServerEnv({ userType: 'user' });

      const { text, exitCode } = syncResult(await server.execute(env, ['8080'], NO_FLAGS));

      expect(text).toContain('must be run as root');
      expect(exitCode).toBe(1);
      expect(writes).toEqual([]);
    },
  );

  it('refuses apache2 when nginx already holds the port, naming the conflict', async () => {
    // The keystone of the one-web-identity decision: the player is told A WEB
    // SERVER is up, not that "apache2 is already running" — which would be false.
    const { env, writes } = webServerEnv({ pidfile: 'nginx:port=80' });

    const { text, exitCode } = syncResult(await apache2.execute(env, [], NO_FLAGS));

    expect(text).toBe('apache2: web server already running on port 80');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each(BOTH_SERVERS)(
    '%s refuses to start twice, reporting the running port and writing nothing',
    async (name, server) => {
      const { env, writes } = webServerEnv({ pidfile: 'nginx:port=80' });

      const { text, exitCode } = syncResult(await server.execute(env, [], NO_FLAGS));

      expect(text).toBe(`${name}: web server already running on port 80`);
      expect(exitCode).toBe(1);
      expect(writes).toEqual([]);
    },
  );

  it('reports the actual running port when the web server is up on a custom one', async () => {
    const { env } = webServerEnv({ pidfile: 'nginx:port=8080' });

    const { text } = syncResult(await nginx.execute(env, [], NO_FLAGS));

    expect(text).toContain('8080');
  });

  it.each(BOTH_SERVERS)('%s rejects a non-numeric port and writes nothing', async (name, server) => {
    const { env, writes } = webServerEnv();

    const { text, exitCode } = syncResult(await server.execute(env, ['http'], NO_FLAGS));

    expect(text).toBe(`${name}: invalid port: http`);
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each(BOTH_SERVERS)('%s rejects out-of-range ports (0 and 65536)', async (_name, server) => {
    const low = webServerEnv();
    const high = webServerEnv();

    const lowResult = syncResult(await server.execute(low.env, ['0'], NO_FLAGS));
    const highResult = syncResult(await server.execute(high.env, ['65536'], NO_FLAGS));

    expect(lowResult.exitCode).toBe(1);
    expect(highResult.exitCode).toBe(1);
    expect(low.writes).toEqual([]);
    expect(high.writes).toEqual([]);
  });

  it.each(BOTH_SERVERS)('%s accepts the boundary ports 1 and 65535', async (_name, server) => {
    const lowEnv = webServerEnv();
    const highEnv = webServerEnv();

    await streamResult(await server.execute(lowEnv.env, ['1'], NO_FLAGS));
    await streamResult(await server.execute(highEnv.env, ['65535'], NO_FLAGS));

    expect(lowEnv.writes[0].content).toBe('nginx:port=1');
    expect(highEnv.writes[0].content).toBe('nginx:port=65535');
  });

  it.each(BOTH_SERVERS)(
    '%s reports a write failure after the announcement, surfacing the reason',
    async (name, server) => {
      const { env } = webServerEnv({ writeResult: { ok: false, error: 'network_error' } });

      const { lines, exitCode } = await streamResult(await server.execute(env, [], NO_FLAGS));

      // The announcement is already out when the start fails, so the failure
      // follows it rather than replacing it — and it renders red.
      expect(lines[lines.length - 1]).toEqual({
        kind: 'error',
        content: `${name}: I/O error`,
      });
      expect(exitCode).toBe(1);
    },
  );

  it('treats a non-file at the pidfile path as nothing running, and starts', async () => {
    // Defensive: if `/var/run/nginx.pid` is unexpectedly a directory (no content
    // to parse), the daemon must not crash — it proceeds as if nothing is up.
    const writes: WriteCall[] = [];
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'nginx.pid': buildDirectory({}) }) }),
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

    const { exitCode } = await streamResult(await nginx.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(writes).toEqual([
      {
        path: '/var/run/nginx.pid',
        content: 'nginx:port=80',
        options: { isNew: true, permissions: PIDFILE_PERMISSIONS },
      },
    ]);
  });

  it.each(BOTH_SERVERS)(
    '%s is registered, so a box without the binary hints at the install (registry gate)',
    async (name) => {
      // Registration is what turns the bare `bash: <name>: command not found` an
      // UNKNOWN command gets into the apt hint — proving the command reached the
      // registry, not just that the module exports it.
      const gated = commandRegistry.get(name);
      if (gated === undefined) throw new Error(`${name} not registered`);

      const result = await gated.execute(mockCommandEnv(), [], NO_FLAGS);

      expect(result.kind === 'sync' && result.exitCode).toBe(127);
      expect(result.kind === 'sync' && result.lines[0]?.content).toBe(
        `bash: ${name}: command not found. Install with: apt install ${name}`,
      );
    },
  );

});
