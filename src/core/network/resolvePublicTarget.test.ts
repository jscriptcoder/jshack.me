import { describe, expect, it } from 'vitest';
import { derivedNetworkByPublicIp } from './resolvePublicTarget.js';
import { computeApGatewayId } from '../identity/router.js';
import { publicAddress } from '../generation/world.js';

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
