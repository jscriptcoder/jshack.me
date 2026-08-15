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
      abandoned: [],
    });
  });

  it('lands the active cwd in the top session’s home (root → /root)', () => {
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(10),
    });

    expect(rehydrateSessionStack(seed, [root]).activeCwd).toBe('/root');
  });

  it('stacks a single su-root row on the base, restoring to the base user’s home on exit', () => {
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(10),
    });

    const result = rehydrateSessionStack(seed, [root]);

    expect(result.sessionStack).toEqual([seed, root]);
    // exit from root returns to where alice was — her home (lossy: not exact cwd).
    expect(result.returnCwdStack).toEqual(['/home/alice']);
  });

  it('orders rows by createdAt and restores each pop to the home of the session beneath it', () => {
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(10),
    });
    const bob = session({
      id: 'su-bob-1',
      username: 'bob',
      userType: 'user',
      createdAt: asEpochMs(20),
    });

    // Rows arrive newest-first to prove the rebuild sorts by createdAt ascending.
    const result = rehydrateSessionStack(seed, [bob, root]);

    expect(result.sessionStack).toEqual([seed, root, bob]);
    // root pops back to alice's home; bob pops back to root's home (/root).
    expect(result.returnCwdStack).toEqual(['/home/alice', '/root']);
  });

  it('restores to /home/guest when the session beneath is the guest account', () => {
    const guest = session({
      id: 'su-guest-1',
      username: 'guest',
      userType: 'guest',
      createdAt: asEpochMs(5),
    });
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(15),
    });

    const result = rehydrateSessionStack(session({ username: 'alice', userType: 'user' }), [
      guest,
      root,
    ]);

    // guest pops to alice's home; root pops to guest's home.
    expect(result.returnCwdStack).toEqual(['/home/alice', '/home/guest']);
  });

  it('rebuilds an ssh hop above an su elevation, landing in the remote root home', () => {
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(10),
    });
    // The ssh hop lives on a DIFFERENT machine — the remote host's coordinate id.
    const remote = session({
      id: 'ssh-root-1',
      machineId: asMachineId('darkstar-12345678'),
      username: 'root',
      userType: 'root',
      kind: 'ssh',
      createdAt: asEpochMs(20),
    });

    const result = rehydrateSessionStack(seed, [remote, root]);

    expect(result.sessionStack).toEqual([seed, root, remote]);
    // exit from the remote pops back to root's home ON THE OWN BOX (lossy, like su);
    // exit from root pops back to alice's home.
    expect(result.returnCwdStack).toEqual(['/home/alice', '/root']);
    expect(result.activeCwd).toBe('/root');
  });

  it('rebuilds the stack without an active ftp session, and names it abandoned', () => {
    const remote = session({
      id: 'ssh-admin-1',
      machineId: asMachineId('darkstar-12345678'),
      username: 'admin',
      userType: 'user',
      kind: 'ssh',
      createdAt: asEpochMs(10),
    });
    // An ftp login is a PARALLEL sub-shell, never a hop. It is the NEWEST row here,
    // so a replay that stacked it would land the player on the ftp target's box
    // holding a shell they never had.
    const ftp = session({
      id: 'ftp-guest-1',
      machineId: asMachineId('vault-87654321'),
      username: 'guest',
      userType: 'guest',
      kind: 'ftp',
      createdAt: asEpochMs(20),
    });

    const result = rehydrateSessionStack(seed, [ftp, remote]);

    expect(result.sessionStack).toEqual([seed, remote]);
    expect(result.abandoned).toEqual([ftp]);
    // The dropped row must not shift the cwd either — landing in /home/guest would
    // mean it reached the stack after all.
    expect(result.returnCwdStack).toEqual(['/home/alice']);
    expect(result.activeCwd).toBe('/home/admin');
  });

  it('abandons nothing when every active row is a hop', () => {
    const root = session({
      id: 'su-root-1',
      username: 'root',
      userType: 'root',
      createdAt: asEpochMs(10),
    });
    const remote = session({
      id: 'ssh-admin-1',
      machineId: asMachineId('darkstar-12345678'),
      username: 'admin',
      userType: 'user',
      kind: 'ssh',
      createdAt: asEpochMs(20),
    });

    expect(rehydrateSessionStack(seed, [root, remote]).abandoned).toEqual([]);
  });

  it('lands a non-root ssh hop in /home/<user> on the remote machine', () => {
    const remote = session({
      id: 'ssh-admin-1',
      machineId: asMachineId('darkstar-12345678'),
      username: 'admin',
      userType: 'user',
      kind: 'ssh',
      createdAt: asEpochMs(10),
    });

    const result = rehydrateSessionStack(seed, [remote]);

    expect(result.sessionStack).toEqual([seed, remote]);
    expect(result.returnCwdStack).toEqual(['/home/alice']);
    expect(result.activeCwd).toBe('/home/admin');
  });
});
