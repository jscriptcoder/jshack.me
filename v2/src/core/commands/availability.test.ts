import { describe, expect, it } from 'vitest';
import { wrapWithBinaryCheck } from './availability';
import { commandRegistry } from './registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

/**
 * Slice 1 of the binary/availability model: a command only runs when its
 * `/bin/<name>` binary exists on the CURRENT machine and the session tier may
 * execute it — otherwise the canonical bash error. The wrapper reads `env.fs`
 * at execution time (per-machine, mutable), so removing/restoring a binary
 * flips the command between not-found and working.
 *
 * These tests prove the wrapper's behaviour (presence + execute-perm gating)
 * and the registry wiring (gated commands are wrapped; always-available
 * builtins/game commands are not) — the integration seam.
 */

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: CommandResult): readonly string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === 'text').map((line) => line.content)
    : [];

const errorLines = (result: CommandResult): readonly string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === 'error').map((line) => line.content)
    : [];

/** A fake gated command that echoes its positional args, so a test can prove
 *  the wrapper delegated through to it (and passed args untouched). */
const echoArgsCommand = (name: string): Command => ({
  name,
  description: 'fake echo-args command',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  execute: async (_env: CommandEnv, args: readonly string[]): Promise<CommandResult> => ({
    kind: 'sync',
    lines: [{ kind: 'text', content: args.join(',') } satisfies TerminalLine],
    exitCode: 0,
  }),
});

/** Build a tree whose `/bin` holds one stub binary at the given execute perms. */
const treeWithBinary = (name: string, execute: readonly ('root' | 'user' | 'guest')[]) =>
  buildDirectory({
    bin: buildDirectory({
      [name]: buildFile('', { owner: 'root', perms: { execute } }),
    }),
  });

describe('wrapWithBinaryCheck', () => {
  it('delegates to the wrapped command when /bin/<name> exists and the tier may execute it', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('ls', ['root', 'user', 'guest']), {
        userType: 'user',
      }),
    });

    const result = await wrapped.execute(env, ['a', 'b'], NO_FLAGS);

    // Proves delegation AND that args passed through untouched.
    expect(textLines(result)).toEqual(['a,b']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('returns command-not-found (exit 127) when the /bin binary is absent', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      // No /bin at all.
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('returns Permission denied (exit 126) when the binary excludes the session tier', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('reboot', ['root']), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: reboot: Permission denied']);
    expect(result.kind === 'sync' && result.exitCode).toBe(126);
  });

  it('lets root bypass the execute-perm check — runs even a non-executable binary', async () => {
    // A binary with execute: [] is the kill vector for the `userType === 'root'`
    // bypass mutant: only the root short-circuit (not the array membership)
    // lets root through.
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const rootEnv = mockCommandEnv({
      session: { ...mockCommandEnv().session, userType: 'root' },
      fs: mockFsViewFromTree(treeWithBinary('reboot', []), { userType: 'root' }),
    });

    const result = await wrapped.execute(rootEnv, ['now'], NO_FLAGS);

    expect(textLines(result)).toEqual(['now']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('denies a non-executable binary to a non-root tier', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('reboot', []), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: reboot: Permission denied']);
  });

  it('treats a directory named like the binary as not-found (only a file is executable)', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      // /bin/ls exists, but as a directory — not a runnable binary.
      fs: mockFsViewFromTree(buildDirectory({ bin: buildDirectory({ ls: buildDirectory({}) }) }), {
        userType: 'user',
      }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('preserves the wrapped command metadata (name, category, tier, manual)', () => {
    const original = echoArgsCommand('ls');
    const wrapped = wrapWithBinaryCheck(original);
    expect(wrapped.name).toBe('ls');
    expect(wrapped.category).toBe(original.category);
    expect(wrapped.tier).toBe(original.tier);
  });
});

describe('commandRegistry gating (registry wiring)', () => {
  it('runs an always-available builtin with no /bin entry present', async () => {
    const echo = commandRegistry.get('echo');
    if (echo === undefined) throw new Error('echo not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await echo.execute(env, ['hello'], NO_FLAGS);

    expect(textLines(result)).toEqual(['hello']);
  });

  it('runs an always-available game command (identity) with no /bin entry present', async () => {
    const identity = commandRegistry.get('identity');
    if (identity === undefined) throw new Error('identity not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await identity.execute(env, [], NO_FLAGS);

    // identity prints the player's public key; the point is it is NOT gated.
    expect(errorLines(result)).not.toContain('bash: identity: command not found');
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('gates ls behind /bin/ls — command-not-found when the binary is absent', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ tmp: buildDirectory({}) }), {
        userType: 'user',
        cwd: asAbsPath('/tmp'),
      }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('runs ls normally when /bin/ls is present', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const tree = buildDirectory({
      bin: buildDirectory({
        ls: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
      tmp: buildDirectory({ 'note.txt': buildFile('x', { owner: 'alice' }) }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(textLines(result)).toEqual(['note.txt']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });
});
