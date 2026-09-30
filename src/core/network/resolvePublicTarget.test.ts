import { describe, expect, it } from 'vitest';
import {
  derivedNetworkByPublicIp,
  resolvePublicTarget,
  type ResolvePublicTargetDeps,
} from './resolvePublicTarget.js';
import { computeApGatewayId } from '../identity/router.js';
import { DECLARED_NETWORKS, publicAddress } from '../generation/world.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanHostIdentity.js';

/**
 * A public address leads to the network that stands at that place in the world, and to
 * its gateway, which answers whether or not anybody has ever joined the network.
 */

describe('derivedNetworkByPublicIp', () => {
  it('leads the address of a network nobody has joined to its gateway', async () => {
    expect(await derivedNetworkByPublicIp(publicAddress('APT-3B-WIFI') ?? '')).toEqual({
      data: { router_machine_id: computeApGatewayId('APT-3B-WIFI'), essid: 'APT-3B-WIFI' },
      error: null,
    });
  });

  it('leads nowhere from an address no network answers at', async () => {
    expect(await derivedNetworkByPublicIp('87.1.0.1')).toEqual({ data: null, error: null });
    expect(await derivedNetworkByPublicIp('203.0.113.7')).toEqual({ data: null, error: null });
  });
});

/** A world nobody has touched: every journal empty, nobody on any network. */
const untouchedWorld: ResolvePublicTargetDeps = {
  findNetworkByPublicIp: derivedNetworkByPublicIp,
  findPatches: async () => ({ data: [], error: null }),
  listOccupantsByEssid: async () => ({ data: [], error: null }),
  listLeasesByEssid: async () => ({ data: [], error: null }),
};

describe('resolvePublicTarget', () => {
  it("reaches, through a port a Millbrook office's gateway forwards, the box behind it rather than the gateway", async () => {
    const office = DECLARED_NETWORKS.find((network) => network.essid === 'WESTBROOK-HAULAGE');
    if (office === undefined) throw new Error('Millbrook declares no Westbrook Haulage');
    const printer = generateHomeLan(office.key).hosts.find(
      (host) => host.hostname === 'printer-57',
    );
    if (printer === undefined) throw new Error('Westbrook Haulage keeps no printer-57');

    const result = await resolvePublicTarget(untouchedWorld, {
      publicIp: publicAddress(office.key) ?? '',
      port: 2222,
    });

    expect(result.ok && { ...result.target, fs: undefined }).toMatchObject({
      machineId: machineIdForLanHost(printer, office.key),
      hostname: 'printer-57',
      essid: office.key,
      reachedPort: 22,
    });
  });
});
