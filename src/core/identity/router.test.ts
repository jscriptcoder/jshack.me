import { describe, expect, it } from 'vitest';
import { computeApGatewayId, computeDeepGatewayId, computeInnerGatewayId } from './router';
import { computeWorkstationId, isOwnWorkstation, parseWorkstationId } from './workstation';
import { hostMachineId } from '../generation/remoteHostId';
import type { LanHost } from '../generation/generateHomeLan';

// A representative Ed25519 pubkey hex (64 chars). Any fixed value works — the
// contract is determinism + DISTINCTNESS, not a specific key.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const ESSID = 'BREW-AND-CODE';
const OTHER_ESSID = 'NAKATOMI-PLAZA';

describe('computeApGatewayId', () => {
  it('returns an `ap-gw-<8 hex>` id', () => {
    expect(computeApGatewayId(ESSID)).toMatch(/^ap-gw-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same ESSID', () => {
    expect(computeApGatewayId(ESSID)).toBe(computeApGatewayId(ESSID));
  });

  it('differs for different ESSIDs', () => {
    expect(computeApGatewayId(ESSID)).not.toBe(computeApGatewayId(OTHER_ESSID));
  });

  // The gateway belongs to the access point, so no player key enters its derivation:
  // every occupant of the ESSID must land on the same box behind the same public IP.
  it('does not vary with the caller', () => {
    expect(computeApGatewayId(ESSID)).toBe(computeApGatewayId(ESSID));
    expect(isOwnWorkstation(computeApGatewayId(ESSID), KEY)).toBe(false);
    expect(isOwnWorkstation(computeApGatewayId(ESSID), OTHER_KEY)).toBe(false);
  });

  it('uses a DISTINCT namespace from a workstation id', () => {
    // The suffix-only `isOwnWorkstation` check would wrongly claim the gateway as a
    // player's own box if the two namespaces ever produced the same suffix.
    const gatewaySuffix = parseWorkstationId(computeApGatewayId(ESSID))?.suffix;
    const workstationSuffix = parseWorkstationId(computeWorkstationId('box', KEY))?.suffix;
    expect(gatewaySuffix).toBeDefined();
    expect(gatewaySuffix).not.toBe(workstationSuffix);
  });
});

describe('computeInnerGatewayId', () => {
  // A deeper-layer gateway on an access point's LAN. It belongs to the NETWORK, like
  // the edge gateway it must never alias — so it lives in its own essid+octet
  // namespace. The octet is load-bearing: two inner gateways at different octets must
  // never collide. Keying it per player would give each occupant a private copy of a
  // box they can all reach at one address.
  it('returns an `inner-gw-<8 hex>` id', () => {
    expect(computeInnerGatewayId(ESSID, 37)).toMatch(/^inner-gw-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same ESSID + octet', () => {
    expect(computeInnerGatewayId(ESSID, 37)).toBe(computeInnerGatewayId(ESSID, 37));
  });

  it('differs from the AP gateway id (never aliases the edge)', () => {
    expect(computeInnerGatewayId(ESSID, 37)).not.toBe(computeApGatewayId(ESSID));
  });

  it('differs per octet, so two inner gateways never alias', () => {
    expect(computeInnerGatewayId(ESSID, 37)).not.toBe(computeInnerGatewayId(ESSID, 38));
  });

  it('differs per network at the same octet, so two APs never share an inner gateway', () => {
    expect(computeInnerGatewayId(ESSID, 37)).not.toBe(computeInnerGatewayId(OTHER_ESSID, 37));
  });

  it('is distinct from a coordinate-seeded NPC sibling id', () => {
    // An NPC sibling lives in the `host:<essid>:<ip>` coordinate namespace; the
    // inner gateway lives in the `inner-gw:<essid>:<octet>` namespace — they can
    // never collide even when an NPC happens to share the gateway's octet.
    const sibling: LanHost = { ip: '192.168.29.37', hostname: 'desktop-37', kind: 'machine' };
    expect(computeInnerGatewayId(ESSID, 37)).not.toBe(hostMachineId(sibling, 'BEAN-THERE-WIFI'));
  });

  it("is never recognised as the owner's own workstation", () => {
    expect(isOwnWorkstation(computeInnerGatewayId(ESSID, 37), KEY)).toBe(false);
  });
});

describe('computeDeepGatewayId', () => {
  // A gateway hanging off a DEEPER layer (behind an inner gateway). It belongs to the
  // NETWORK, like every gateway above it, but it must be unique across layers and
  // branches — so it is keyed by its PARENT gateway's machine_id AND its octet on the
  // deep /24. Two deep gateways at the same octet behind DIFFERENT parents must never
  // collide: that is what lets a chain (and later, branches) stay distinct.
  const PARENT = computeInnerGatewayId(ESSID, 37);
  const OTHER_PARENT = computeInnerGatewayId(ESSID, 38);

  it('returns a `deep-gw-<8 hex>` id', () => {
    expect(computeDeepGatewayId(PARENT, 50)).toMatch(/^deep-gw-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same parent + octet', () => {
    expect(computeDeepGatewayId(PARENT, 50)).toBe(computeDeepGatewayId(PARENT, 50));
  });

  it('differs per octet behind the same parent', () => {
    expect(computeDeepGatewayId(PARENT, 50)).not.toBe(computeDeepGatewayId(PARENT, 51));
  });

  it('differs per PARENT at the same octet — distinct across layers/branches', () => {
    expect(computeDeepGatewayId(PARENT, 50)).not.toBe(computeDeepGatewayId(OTHER_PARENT, 50));
  });

  it('separates one access point’s chain from another’s, through the parent', () => {
    // Nothing in the deep id names an ESSID directly — it inherits one, because the chain
    // descends from an inner gateway that is ESSID-keyed. Two networks therefore cannot
    // share a deep box even at the same octet and the same depth.
    expect(computeDeepGatewayId(computeInnerGatewayId(ESSID, 37), 50)).not.toBe(
      computeDeepGatewayId(computeInnerGatewayId('OTHER-WIFI', 37), 50),
    );
  });

  it('never aliases an inner gateway, the edge router, or the parent itself', () => {
    const deep = computeDeepGatewayId(PARENT, 50);
    expect(deep).not.toBe(computeInnerGatewayId(ESSID, 50));
    expect(deep).not.toBe(computeApGatewayId(ESSID));
    expect(deep).not.toBe(PARENT);
  });

  it('is never recognised as any player’s own workstation', () => {
    expect(isOwnWorkstation(computeDeepGatewayId(PARENT, 50), KEY)).toBe(false);
    expect(isOwnWorkstation(computeDeepGatewayId(PARENT, 50), OTHER_KEY)).toBe(false);
  });
});
