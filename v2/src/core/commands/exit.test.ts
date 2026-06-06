import { describe, expect, it } from 'vitest';
import { mockCommandEnv, mockSession } from '../../test/factories/commandEnv';
import type { CommandResult, Session } from './types';
import { exit } from './exit';

/**
 * `exit` is the inverse of `su`: it drops the active (elevated/hopped) session,
 * returning to the one beneath it. The decision lives in core — `env.hopChain`
 * is the stack of sessions BELOW the active one, so a non-empty chain means
 * "we hopped and can return," an empty chain means "this is the base login
 * shell, do nothing" (exit never closes the game). The tests spy `popSession`
 * so the "only pop when there's somewhere to return to" invariant is provable.
 */

const NO_FLAGS = new Map<string, string | true>();

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

/** An env whose `hopChain` is the given return stack and whose `popSession` is
 *  a spy, so a pop (or its absence) is observable. */
const exitEnv = (hopChain: readonly Session[]) => {
  const pops: 'pop'[] = [];
  const env = mockCommandEnv({ hopChain, popSession: () => pops.push('pop') });
  return { env, pops };
};

const aSessionBelow = (): Session => mockSession({ userType: 'user', username: 'alice' });

describe('exit', () => {
  it('drops the active session when there is one to return to', async () => {
    const { env, pops } = exitEnv([aSessionBelow()]);

    const { text, exitCode } = syncResult(await exit.execute(env, [], NO_FLAGS));

    expect(pops).toEqual(['pop']);
    expect(exitCode).toBe(0);
    // exit is silent — the restored prompt is the only feedback.
    expect(text).toBe('');
  });

  it('is a harmless no-op at the base session (nothing to return to)', async () => {
    const { env, pops } = exitEnv([]);

    const { text, exitCode } = syncResult(await exit.execute(env, [], NO_FLAGS));

    expect(pops).toEqual([]);
    expect(exitCode).toBe(0);
    expect(text).toBe('');
  });
});
