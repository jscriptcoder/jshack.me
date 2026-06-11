import { describe, expect, it } from 'vitest';
import { resolveActiveRoot } from './activeRoot';
import { generateHomeLan } from '../core/generation/generateHomeLan';
import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { hostMachineId } from '../core/generation/remoteHostId';
import { computeWorkstationId } from '../core/identity/workstation';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import { buildDirectory } from '../test/factories/filesystem';
import type { Session } from '../core/commands/types';

/**
 * `resolveActiveRoot` picks the filesystem the active session operates on: your
 * own (patched) workstation tree when the session is on your box, or the
 * deterministically-generated tree of the remote host you've ssh'd into. The
 * remote host is recovered from its coordinate `machine_id` by regenerating the
 * current LAN — so a session that only carries a `machine_id` still resolves to
 * the right tree on the live path AND on a refresh rebuild.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);
const ownRoot = buildDirectory({});

const session = (machineId: string, kind: Session['kind'] = 'su'): Session => ({
  id: 'sess-1',
  playerKey: asPlayerKeyHex(PUBKEY),
  machineId: asMachineId(machineId),
  username: 'root',
  userType: 'root',
  kind,
  createdAt: asEpochMs(0),
});

const args = (over: Partial<Parameters<typeof resolveActiveRoot>[0]>) => ({
  session: session(OWN_ID),
  ownWorkstationId: OWN_ID,
  publicKeyHex: PUBKEY,
  essid: ESSID as string | null,
  ownRoot,
  ...over,
});

describe('resolveActiveRoot', () => {
  it('returns the own workstation tree for a session on your own box', () => {
    expect(resolveActiveRoot(args({ session: session(OWN_ID) }))).toBe(ownRoot);
  });

  it('returns the remote host tree for an ssh session, recovered from its machine_id', () => {
    const host = generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!;
    const machineId = hostMachineId(host, ESSID);

    const root = resolveActiveRoot(args({ session: session(machineId, 'ssh') }));

    expect(root).toEqual(buildRemoteHostFs(PUBKEY, ESSID, host));
    expect(root).not.toBe(ownRoot);
  });

  it('falls back to the own tree when there is no network to resolve a remote against', () => {
    const machineId = hostMachineId(generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!, ESSID);
    expect(resolveActiveRoot(args({ session: session(machineId, 'ssh'), essid: null }))).toBe(ownRoot);
  });

  it('falls back to the own tree when the machine_id matches no host on the current LAN', () => {
    expect(resolveActiveRoot(args({ session: session('ghost-00000000', 'ssh') }))).toBe(ownRoot);
  });
});
