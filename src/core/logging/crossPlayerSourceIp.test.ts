import { describe, expect, it } from 'vitest';
import { derivedPublicIpByEssid, resolveVantageSourceIp } from './crossPlayerSourceIp.js';
import { publicAddress } from '../generation/world.js';

/**
 * The address a cross-player trace names its actor by is the public address of the
 * network they stand on — derived from that network's place in the world, so a trace
 * can never name an address nobody answers at.
 */

describe('derivedPublicIpByEssid', () => {
  it("answers a landmark's own address, whether or not anybody has joined it", async () => {
    expect(await derivedPublicIpByEssid('APT-3B-WIFI')).toEqual({
      data: { public_ip: publicAddress('APT-3B-WIFI') },
      error: null,
    });
  });

  it('answers no address for a network the world does not declare', async () => {
    expect(await derivedPublicIpByEssid('LEASE-TEST-NET')).toEqual({ data: null, error: null });
  });

  it('lets a trace name an actor standing on a lab network as unknown', async () => {
    const sourceIp = await resolveVantageSourceIp(
      {
        findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
        findPublicIpByEssid: derivedPublicIpByEssid,
      },
      { actorKey: 'actor', standingEssid: 'LEASE-TEST-NET' },
    );
    expect(sourceIp).toBe('unknown');
  });
});
