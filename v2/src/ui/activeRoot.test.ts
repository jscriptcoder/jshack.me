import { describe, expect, it } from 'vitest';
import { isCrossPlayerHop, resolveActiveRoot } from './activeRoot';
import { generateHomeLan } from '../core/generation/generateHomeLan';
import { generateDeepLayer } from '../core/generation/generateDeepLayer';
import { buildDeepHostFs } from '../core/generation/deepHostFs';
import { resolveDeepGatewayIdentity } from '../core/generation/lanHostIdentity';
import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { hostMachineId } from '../core/generation/remoteHostId';
import {
  buildApGatewayBaseFs,
  buildInnerGatewayBaseFs,
  buildSwitchBaseFs,
} from '../core/generation/routerFs';
import { computeWorkstationId } from '../core/identity/workstation';
import { computeInnerGatewayId, computeApGatewayId } from '../core/identity/router';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import { buildDirectory } from '../test/factories/filesystem';
import type { Patch } from '../core/filesystem/applyPatches';
import type { Directory, FileEntry, FileNode } from '../core/filesystem/types';
import type { Session } from '../core/commands/types';

/**
 * `resolveActiveRoot` picks the filesystem the active session operates on — your
 * own workstation tree when the session is on your box, or the
 * deterministically-generated tree of the remote host you've ssh'd into — and
 * replays the active machine's patch journal over whichever base it picks, so a
 * write (own OR remote) materializes. The remote host is recovered from its
 * coordinate `machine_id` by regenerating the current LAN, so a session that
 * only carries a `machine_id` still resolves on the live path AND on a refresh.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);
const ownBaseFs = buildDirectory({});

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
  ownBaseFs,
  patches: [] as readonly Patch[],
  ...over,
});

const fileAt = (root: Directory, segments: readonly string[]): FileEntry | undefined => {
  let current: FileNode | undefined = root;
  for (const segment of segments) {
    if (current === undefined || current.kind !== 'directory') return undefined;
    current = current.entries.get(segment);
  }
  return current !== undefined && current.kind === 'file' ? current : undefined;
};

const writePatch = (path: string, content: string): Patch => ({
  path,
  content,
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root', 'user', 'guest'] },
});

describe('resolveActiveRoot', () => {
  it('returns the own workstation base for a session on your own box (no patches)', () => {
    expect(resolveActiveRoot(args({ session: session(OWN_ID) }))).toBe(ownBaseFs);
  });

  it('replays the active journal over the own base for a session on your own box', () => {
    const root = resolveActiveRoot(
      args({ session: session(OWN_ID), patches: [writePatch('/home/note.txt', 'mine')] }),
    );

    expect(fileAt(root, ['home', 'note.txt'])?.content).toBe('mine');
  });

  it('returns the remote host tree for an ssh session, recovered from its machine_id', () => {
    const host = generateHomeLan(ESSID).hosts.at(-1)!;
    const machineId = hostMachineId(host, ESSID);

    const root = resolveActiveRoot(args({ session: session(machineId, 'ssh') }));

    expect(root).toEqual(buildRemoteHostFs(ESSID, host));
    expect(root).not.toBe(ownBaseFs);
  });

  it('replays the active journal over the REMOTE base for an ssh session (write observability)', () => {
    const host = generateHomeLan(ESSID).hosts.at(-1)!;
    const machineId = hostMachineId(host, ESSID);

    const root = resolveActiveRoot(
      args({ session: session(machineId, 'ssh'), patches: [writePatch('/tmp/pwned', 'owned')] }),
    );

    // The remote write is visible — and it landed on the REMOTE tree, not the own one.
    expect(fileAt(root, ['tmp', 'pwned'])?.content).toBe('owned');
    expect(fileAt(ownBaseFs, ['tmp', 'pwned'])).toBeUndefined();
  });

  it('falls back to the own base when there is no network to resolve a remote against', () => {
    const machineId = hostMachineId(generateHomeLan(ESSID).hosts.at(-1)!, ESSID);
    expect(resolveActiveRoot(args({ session: session(machineId, 'ssh'), essid: null }))).toBe(
      ownBaseFs,
    );
  });

  it('falls back to the own base when the machine_id matches no host on the current LAN', () => {
    expect(resolveActiveRoot(args({ session: session('ghost-00000000', 'ssh') }))).toBe(ownBaseFs);
  });

  it('does NOT rebuild the AP gateway locally — it is a cross-player hop', () => {
    // `ssh root@<subnet>.1` lands a session on the gateway, but the gateway belongs
    // to the access point rather than the caller, so the client must NOT rebuild it
    // from its own seed. Its tree is fetched server-side like any other foreign box —
    // which is what lets one occupant see another's edits to `rules.v4`.
    expect(isCrossPlayerHop(session(computeApGatewayId(ESSID), 'ssh'), ESSID, PUBKEY)).toBe(true);

    // The most faithful local rebuild there is — the very function every other path
    // uses for this box — so the inequality below is about WHERE the tree comes from
    // and not about having assembled it slightly wrong here.
    const locallyRebuilt = buildApGatewayBaseFs(ESSID);
    expect(resolveActiveRoot(args({ session: session(computeApGatewayId(ESSID), 'ssh') }))).not.toEqual(
      locallyRebuilt,
    );
  });

  // The inner gateway is a SECOND own-LAN router, journal-backed exactly like the
  // AP gateway at `.1` — but this one IS the player's own device, so a session on its
  // id must rebuild ITS seeded tree so a `nano rules.v4` edit is visible after refresh.
  const innerGatewayOctet = (): number => {
    const inner = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) throw new Error('no inner gateway on LAN');
    return Number(inner.ip.split('.')[3]);
  };

  it('falls back to the own base for an AP-gateway session when offline (no essid to resolve the LAN)', () => {
    // Offline (essid null) there is no LAN to resolve any remote against — the AP
    // gateway included — so every remote session uniformly shows the own base, rather
    // than the gateway tree it can no longer reach.
    expect(
      resolveActiveRoot(args({ session: session(computeApGatewayId(ESSID), 'ssh'), essid: null })),
    ).toBe(ownBaseFs);
  });

  it('returns the INNER GATEWAY tree for a session on its id, not the own base', () => {
    const octet = innerGatewayOctet();
    const root = resolveActiveRoot(
      args({ session: session(computeInnerGatewayId(ESSID, octet), 'ssh') }),
    );

    expect(root).toEqual(buildInnerGatewayBaseFs(ESSID, octet));
    expect(root).not.toBe(ownBaseFs);
  });

  it('replays the active journal over the INNER GATEWAY base (rules.v4 edit survives a refresh)', () => {
    const octet = innerGatewayOctet();
    const root = resolveActiveRoot(
      args({
        session: session(computeInnerGatewayId(ESSID, octet), 'ssh'),
        patches: [writePatch('/etc/iptables/rules.v4', 'forward 2222 to 10.0.0.5:22\n')],
      }),
    );

    expect(fileAt(root, ['etc', 'iptables', 'rules.v4'])?.content).toBe(
      'forward 2222 to 10.0.0.5:22\n',
    );
    // Landed on the inner gateway base, not own/empty: its root passwd survives.
    expect(fileAt(root, ['etc', 'passwd'])).toBeDefined();
  });

  // The switch is the second inner-gateway device type, journal-backed on its own id
  // exactly like the inner router — a session on its id must rebuild ITS seeded tree
  // (an `acl.conf` box) so a `nano acl.conf` edit is visible and survives a refresh.
  const switchOctet = (): number => {
    const device = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'switch');
    if (device === undefined) throw new Error('no switch on LAN');
    return Number(device.ip.split('.')[3]);
  };

  it('returns the SWITCH tree for a session on its id, not the own base', () => {
    const octet = switchOctet();
    const root = resolveActiveRoot(
      args({ session: session(computeInnerGatewayId(ESSID, octet), 'ssh') }),
    );

    expect(root).toEqual(buildSwitchBaseFs(ESSID, octet));
    expect(root).not.toBe(ownBaseFs);
  });

  it('replays the active journal over the SWITCH base (acl.conf edit survives a refresh)', () => {
    const octet = switchOctet();
    const root = resolveActiveRoot(
      args({
        session: session(computeInnerGatewayId(ESSID, octet), 'ssh'),
        patches: [writePatch('/etc/switch/acl.conf', '# default policy: ALLOW\n')],
      }),
    );

    expect(fileAt(root, ['etc', 'switch', 'acl.conf'])?.content).toBe('# default policy: ALLOW\n');
    // Landed on the switch base, not own/empty: its root passwd survives.
    expect(fileAt(root, ['etc', 'passwd'])).toBeDefined();
  });

  // A deep CHILD GATEWAY (a chain door behind the inner gateway) and the deep NPCs on
  // each layer are the player's OWN private generated machines — reached by ssh through a
  // forward — so a session on one must rebuild ITS seeded tree (with its toolchain) rather
  // than fall back to the own workstation base, or the deep loop has no filesystem to stand on.
  const deepChainDoor = () => {
    const innerId = computeInnerGatewayId(ESSID, innerGatewayOctet());
    const child = generateDeepLayer(ESSID, { machineId: innerId, kind: 'router' }).childGateway;
    if (child === null) throw new Error('fixture chain has no deep gateway');
    return resolveDeepGatewayIdentity(innerId, child.ip, child.kind);
  };

  const deepNpcHost = () => {
    const innerId = computeInnerGatewayId(ESSID, innerGatewayOctet());
    return generateDeepLayer(ESSID, { machineId: innerId, kind: 'router' }).host;
  };

  it('returns the DEEP GATEWAY tree for a session on a chain door, not the own base', () => {
    const door = deepChainDoor();
    const root = resolveActiveRoot(args({ session: session(door.machineId, 'ssh') }));

    expect(root).toEqual(door.baseFs);
    expect(root).not.toBe(ownBaseFs);
  });

  it('returns the DEEP NPC tree for a session on a host reached through a forward, not the own base', () => {
    const host = deepNpcHost();
    const root = resolveActiveRoot(args({ session: session(hostMachineId(host, ESSID), 'ssh') }));

    expect(root).toEqual(buildDeepHostFs(ESSID, host));
    expect(root).not.toBe(ownBaseFs);
  });

  it('replays the active journal over the DEEP NPC base (auth.log trace survives a refresh)', () => {
    const host = deepNpcHost();
    const root = resolveActiveRoot(
      args({
        session: session(hostMachineId(host, ESSID), 'ssh'),
        patches: [writePatch('/var/log/auth.log', 'Accepted password for operator from 10.75.133.1\n')],
      }),
    );

    expect(fileAt(root, ['var', 'log', 'auth.log'])?.content).toContain('Accepted password');
    // Landed on the deep NPC base, not own/empty: its seeded passwd survives.
    expect(fileAt(root, ['etc', 'passwd'])).toBeDefined();
  });
});

describe('isCrossPlayerHop', () => {
  // A foreign workstation id (another identity's box) — never a host on B's own LAN.
  const FOREIGN_ID = computeWorkstationId('skylab', 'b'.repeat(64));

  it('is true for an ssh session on a machine that is not on your LAN', () => {
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'ssh'), ESSID, PUBKEY)).toBe(true);
  });

  it('is false for an ssh session on a host that IS on your own LAN', () => {
    const host = generateHomeLan(ESSID).hosts.at(-1)!;
    const lanHopId = hostMachineId(host, ESSID);
    expect(isCrossPlayerHop(session(lanHopId, 'ssh'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false for an ssh session on your own workstation', () => {
    expect(isCrossPlayerHop(session(OWN_ID, 'ssh'), ESSID, PUBKEY)).toBe(false);
  });

  it('is true for a su session on a foreign machine (an elevation keeps the box you ssh’d into)', () => {
    // su-elevating on a cross-player box leaves you ON that box — its served tree
    // (now at the root tier) must stay, or reads/`reboot` would wrongly fall back
    // to your own box. The earlier ssh-only rule predated cross-player `su`.
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'su'), ESSID, PUBKEY)).toBe(true);
  });

  it('is false for a su session on your own workstation (still local)', () => {
    expect(isCrossPlayerHop(session(OWN_ID, 'su'), ESSID, PUBKEY)).toBe(false);
  });

  it('is true for an nc session on a foreign machine (a backdoor lands you in a shell)', () => {
    // A backdoor opens a real shell on the target, so it reads that box's tree like
    // every other hop. While it was excluded, an intruder stood in a shell looking at
    // their OWN filesystem while their writes landed on the target's journal.
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'nc'), ESSID, PUBKEY)).toBe(true);
  });

  it('is false for an nc session on a host that IS on your own LAN', () => {
    // The own-LAN backdoor was never broken: the target is generated from the essid,
    // so it rebuilds locally. Serving it would buy a round trip per read and nothing else.
    const host = generateHomeLan(ESSID).hosts.at(-1)!;
    expect(isCrossPlayerHop(session(hostMachineId(host, ESSID), 'nc'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false for an ftp session, which addresses its own tree elsewhere', () => {
    // `ftp` never routes through `activeRoot`: `ftpRoot` builds the tree the sub-shell
    // addresses, deliberately held apart because the shell and the ftp session are two
    // machines at once. Widening this predicate to every kind would claim a served tree
    // for a session that never asks this question.
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'ftp'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false when offline (no essid to resolve a LAN against)', () => {
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'ssh'), null, PUBKEY)).toBe(false);
  });
});
