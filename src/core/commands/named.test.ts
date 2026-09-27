import { describe, expect, it } from 'vitest';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { named } from './daemon';

/**
 * The name server's own announcements.
 *
 * Everything a daemon SHARES — the root gate, the pidfile write, port validation, the
 * streaming — is one function every daemon runs through, and it is proven end to end in
 * `sshd.test.ts`; repeating it here would test that function six times over. What
 * belongs to `named` alone is what it SAYS, and a wrong line is what a player meets on
 * the box they have just rooted.
 */

const NO_FLAGS = new Map<string, string | true>();

/** An env whose `/var/run` holds the name server's pidfile, or nothing when it is not
 *  running. Root, because a daemon is refused to anyone else before it says a word. */
const namedEnv = (pidfile?: string) => {
  const run =
    pidfile === undefined
      ? buildDirectory({})
      : buildDirectory({ 'named.pid': buildFile(pidfile, { owner: 'root' }) });
  const tree = buildDirectory({ var: buildDirectory({ run }) });
  return mockCommandEnv({
    session: mockSession({ userType: 'root' }),
    fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
    patches: { ...mockPatchApi(), write: async () => ({ ok: true }) },
  });
};

describe('named', () => {
  it('announces itself as a name server while it starts', async () => {
    const result = await named.execute(namedEnv(), [], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('async expected');

    const lines: TerminalLine[] = [];
    for await (const line of result.lines) lines.push(line);

    // Not "bind9" and not "named": the player is starting a name server, and the word
    // that tells them what they have just opened is the one on the line.
    expect(lines[0]).toEqual({ kind: 'text', content: 'Starting name server...' });
  });

  it('refuses a second start, naming the port the first one is holding', async () => {
    const result = await named.execute(namedEnv('named:port=53'), [], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');

    // The refusal names the CONFLICT rather than simply declining. A player who has
    // forgotten they left it running gets the port back out of the error, which is the
    // one thing they would otherwise have to go looking for.
    expect(result.lines.map((line) => line.content)).toEqual([
      'named: already running on port 53',
    ]);
    expect(result.exitCode).toBe(1);
  });
});
