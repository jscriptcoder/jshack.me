import { describe, expect, it } from 'vitest';
import { isCrossPlayerWorkstation } from './crossPlayerHop';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { hostMachineId } from '../generation/remoteHostId';
import { machineIdForLanHost, resolveDeepGatewayIdentity } from '../generation/lanHostIdentity';
import { computeWorkstationId } from '../identity/workstation';
import { computeRouterId } from '../identity/router';

/**
 * `isCrossPlayerWorkstation` is the machine-level "am I standing on ANOTHER
 * player's registered box?" check — the shared core of `ui/activeRoot`'s
 * `isCrossPlayerHop` (which adds the ssh-kind requirement for served-tree
 * dispatch) AND `su`'s routing decision (which doesn't care about the kind, only
 * the machine). A box is cross-player when it is neither your own workstation nor
 * a host on the LAN you're connected to — the only way to be there is a public-IP
 * login into another identity's box.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);
// A different identity's workstation — never a host on B's own LAN.
const FOREIGN_ID = computeWorkstationId('skylab', 'b'.repeat(64));

describe('isCrossPlayerWorkstation', () => {
  it('is true for a foreign workstation that is not a host on your LAN', () => {
    expect(
      isCrossPlayerWorkstation({ machineId: FOREIGN_ID, publicKeyHex: PUBKEY, essid: ESSID }),
    ).toBe(true);
  });

  it('is false for a host that IS on your own LAN (an NPC ssh hop)', () => {
    const lanHopId = hostMachineId(generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!, ESSID);
    expect(
      isCrossPlayerWorkstation({ machineId: lanHopId, publicKeyHex: PUBKEY, essid: ESSID }),
    ).toBe(false);
  });

  it('is false for your own workstation', () => {
    expect(
      isCrossPlayerWorkstation({ machineId: OWN_ID, publicKeyHex: PUBKEY, essid: ESSID }),
    ).toBe(false);
  });

  it('is false when offline (no essid to resolve a LAN against)', () => {
    expect(
      isCrossPlayerWorkstation({ machineId: FOREIGN_ID, publicKeyHex: PUBKEY, essid: null }),
    ).toBe(false);
  });

  it('is false for your OWN router (a journal-backed machine on your LAN, not a foreign box)', () => {
    // The router has a distinct id namespace, so it is neither your workstation
    // nor a host `hostForMachineId` resolves — without the own-router exclusion it
    // would be misread as cross-player and fetch a server-served (tier-filtered)
    // tree instead of your own journal-replayed router tree.
    expect(
      isCrossPlayerWorkstation({
        machineId: computeRouterId(PUBKEY),
        publicKeyHex: PUBKEY,
        essid: ESSID,
      }),
    ).toBe(false);
  });

  // The inner gateway, switch, and the deep boxes behind them are the player's OWN
  // private generated machines (distinct id namespaces, never NPC-coordinate ids), so
  // `hostForMachineId` alone misses them — they must still be own-LAN, or the UI serves
  // an empty cross-player tree instead of their real journal-replayed filesystem.
  const innerGatewayId = (): string => {
    const inner = generateHomeLan(PUBKEY, ESSID).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) throw new Error('no inner gateway on fixture LAN');
    return machineIdForLanHost(inner, PUBKEY, ESSID);
  };

  it('is false for your OWN inner gateway (a second journal-backed router on your LAN)', () => {
    expect(
      isCrossPlayerWorkstation({ machineId: innerGatewayId(), publicKeyHex: PUBKEY, essid: ESSID }),
    ).toBe(false);
  });

  it('is false for your OWN switch (the second inner-gateway device kind)', () => {
    const device = generateHomeLan(PUBKEY, ESSID).hosts.find((host) => host.kind === 'switch');
    if (device === undefined) throw new Error('no switch on fixture LAN');
    expect(
      isCrossPlayerWorkstation({
        machineId: machineIdForLanHost(device, PUBKEY, ESSID),
        publicKeyHex: PUBKEY,
        essid: ESSID,
      }),
    ).toBe(false);
  });

  it('is false for a deep child gateway in your OWN chain (a forwarded chain door)', () => {
    const innerId = innerGatewayId();
    const child = generateDeepLayer(PUBKEY, ESSID, { machineId: innerId, kind: 'router' }).childGateway;
    if (child === null) throw new Error('fixture chain has no deep gateway');
    const deepGatewayId = resolveDeepGatewayIdentity(PUBKEY, innerId, child.ip, child.kind).machineId;
    expect(
      isCrossPlayerWorkstation({ machineId: deepGatewayId, publicKeyHex: PUBKEY, essid: ESSID }),
    ).toBe(false);
  });

  it('is false for a deep NPC reachable in your OWN chain (a private per-viewer box)', () => {
    const innerId = innerGatewayId();
    const deepHost: LanHost = generateDeepLayer(PUBKEY, ESSID, {
      machineId: innerId,
      kind: 'router',
    }).host;
    expect(
      isCrossPlayerWorkstation({
        machineId: hostMachineId(deepHost, ESSID),
        publicKeyHex: PUBKEY,
        essid: ESSID,
      }),
    ).toBe(false);
  });
});
