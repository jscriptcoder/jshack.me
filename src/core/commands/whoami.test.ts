import { describe, expect, it } from 'vitest';
import { whoami } from './whoami';
import { mockCommandEnv, mockSession } from '../../test/factories/commandEnv';
import { asMachineId } from '../types';
import type { Session } from './types';

const NO_FLAGS = new Map<string, string | true>();

/**
 * `whoami` answers for the session the player is STANDING in, which is the whole
 * point of the command: it is how you check that an elevation or a hop actually
 * took. The three cases below are the three shapes a session comes in — the
 * login, an elevation, and a hop onto another box — and each must answer with
 * its own account rather than the one the game started as.
 */
const runWhoami = async (session: Session) => {
  const result = await whoami.execute(mockCommandEnv({ session }), [], NO_FLAGS);
  if (result.kind !== 'sync') throw new Error('whoami answers synchronously');
  return result;
};

describe('whoami command', () => {
  it('names the account the base login session holds', async () => {
    const result = await runWhoami(mockSession({ username: 'alice', userType: 'user' }));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: 'alice' }]);
  });

  it('names root once the session has been elevated', async () => {
    const result = await runWhoami(mockSession({ username: 'root', userType: 'root' }));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: 'root' }]);
  });

  it('names the remote account after a hop onto another machine', async () => {
    const result = await runWhoami(
      mockSession({
        username: 'webmaster',
        userType: 'user',
        kind: 'ssh',
        machineId: asMachineId('web-01'),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: 'webmaster' }]);
  });
});
