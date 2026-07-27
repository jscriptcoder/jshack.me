import { describe, expect, it } from 'vitest';
import { lanAddressesByOwner, lanSubnetPrefix, leasedAddress } from './lanAddress';

/**
 * Turning a DHCP lease into the address an occupant is reachable at. The `/24`
 * belongs to the access point and is still derived from the ESSID; the host octet is
 * the leased half, so an occupant holding no lease has no address on the network.
 *
 * That absent case is the point: the derivation this replaced could always produce a
 * plausible-looking address for an identity that held nothing, which is exactly how a
 * player ended up "reachable" at an address belonging to somebody else.
 */

const ESSID = 'BREW-AND-CODE';
const OTHER_ESSID = 'NAKATOMI-PLAZA';

describe('leasedAddress', () => {
  it('is the leased octet on the ESSID’s own /24', () => {
    expect(leasedAddress(ESSID, 42)).toBe(`${lanSubnetPrefix(ESSID)}.42`);
  });

  it('is nothing at all when the occupant holds no lease', () => {
    // No lease is no address. A caller must fall through to "reaches no host" rather
    // than form an address for an occupant that was never issued one.
    expect(leasedAddress(ESSID, null)).toBeNull();
  });
});

describe('lanSubnetPrefix', () => {
  it('puts every occupant of one network on one /24', () => {
    expect(lanSubnetPrefix(ESSID)).toBe(lanSubnetPrefix(ESSID));
    expect(lanSubnetPrefix(ESSID)).toMatch(/^192\.168\.\d{1,3}$/);
  });

  it('separates one access point’s /24 from another’s', () => {
    expect(lanSubnetPrefix(ESSID)).not.toBe(lanSubnetPrefix(OTHER_ESSID));
  });
});

describe('lanAddressesByOwner', () => {
  it('resolves each occupant’s lease to its address on the shared subnet', () => {
    const addresses = lanAddressesByOwner(ESSID, [
      { owner_key: 'alice', octet: 12 },
      { owner_key: 'bob', octet: 200 },
    ]);

    expect(addresses.get('alice')).toBe(`${lanSubnetPrefix(ESSID)}.12`);
    expect(addresses.get('bob')).toBe(`${lanSubnetPrefix(ESSID)}.200`);
  });

  it('holds no entry for an occupant with no lease', () => {
    expect(lanAddressesByOwner(ESSID, []).get('alice')).toBeUndefined();
  });
});
