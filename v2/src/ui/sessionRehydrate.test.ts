import { describe, expect, it } from 'vitest';
import { rehydrateSessionStack } from './sessionRehydrate';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import type { Session } from '../core/commands/types';

const MACHINE = asMachineId('skylab-deadbeef');
const KEY = asPlayerKeyHex('a'.repeat(64));

const session = (over: Partial<Session> = {}): Session => ({
  id: 'seed-session',
  playerKey: KEY,
  machineId: MACHINE,
  username: 'alice',
  userType: 'user',
  kind: 'su',
  createdAt: asEpochMs(0),
  ...over,
});

const seed = session();

describe('rehydrateSessionStack', () => {
  it('returns just the base session and no return-cwd when there are no active rows', () => {
    expect(rehydrateSessionStack(seed, [])).toEqual({
      sessionStack: [seed],
      returnCwdStack: [],
      activeCwd: '/home/alice',
    });
  });

  it('lands the active cwd in the top session’s home (root → /root)', () => {
    const root = session({ id: 'su-root-1', username: 'root', userType: 'root', createdAt: asEpochMs(10) });

    expect(rehydrateSessionStack(seed, [root]).activeCwd).toBe('/root');
  });

  it('stacks a single su-root row on the base, restoring to the base user’s home on exit', () => {
    const root = session({ id: 'su-root-1', username: 'root', userType: 'root', createdAt: asEpochMs(10) });

    const result = rehydrateSessionStack(seed, [root]);

    expect(result.sessionStack).toEqual([seed, root]);
    // exit from root returns to where alice was — her home (lossy: not exact cwd).
    expect(result.returnCwdStack).toEqual(['/home/alice']);
  });

  it('orders rows by createdAt and restores each pop to the home of the session beneath it', () => {
    const root = session({ id: 'su-root-1', username: 'root', userType: 'root', createdAt: asEpochMs(10) });
    const bob = session({ id: 'su-bob-1', username: 'bob', userType: 'user', createdAt: asEpochMs(20) });

    // Rows arrive newest-first to prove the rebuild sorts by createdAt ascending.
    const result = rehydrateSessionStack(seed, [bob, root]);

    expect(result.sessionStack).toEqual([seed, root, bob]);
    // root pops back to alice's home; bob pops back to root's home (/root).
    expect(result.returnCwdStack).toEqual(['/home/alice', '/root']);
  });

  it('restores to /home/guest when the session beneath is the guest account', () => {
    const guest = session({ id: 'su-guest-1', username: 'guest', userType: 'guest', createdAt: asEpochMs(5) });
    const root = session({ id: 'su-root-1', username: 'root', userType: 'root', createdAt: asEpochMs(15) });

    const result = rehydrateSessionStack(session({ username: 'alice', userType: 'user' }), [guest, root]);

    // guest pops to alice's home; root pops to guest's home.
    expect(result.returnCwdStack).toEqual(['/home/alice', '/home/guest']);
  });
});
