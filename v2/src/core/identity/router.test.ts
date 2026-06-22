import { describe, expect, it } from 'vitest';
import { computeInnerGatewayId, computeRouterId, isOwnRouter } from './router';
import { computeWorkstationId, isOwnWorkstation, parseWorkstationId } from './workstation';
import { hostMachineId } from '../generation/remoteHostId';
import type { LanHost } from '../generation/generateHomeLan';

// A representative Ed25519 pubkey hex (64 chars). Any fixed value works — the
// contract is determinism + DISTINCTNESS, not a specific key.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('computeRouterId', () => {
  it('returns a `router-<8 hex>` id', () => {
    expect(computeRouterId(KEY)).toMatch(/^router-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same key', () => {
    expect(computeRouterId(KEY)).toBe(computeRouterId(KEY));
  });

  it('differs for different keys', () => {
    expect(computeRouterId(KEY)).not.toBe(computeRouterId(OTHER_KEY));
  });

  it('uses a DISTINCT namespace from the workstation id for the same key', () => {
    // Same owner key, but the router suffix must NOT equal the workstation
    // suffix — otherwise the router would alias the player's own box and the
    // suffix-only `isOwnWorkstation` check would wrongly claim it.
    const routerSuffix = parseWorkstationId(computeRouterId(KEY))?.suffix;
    const workstationSuffix = parseWorkstationId(computeWorkstationId('box', KEY))?.suffix;
    expect(routerSuffix).toBeDefined();
    expect(routerSuffix).not.toBe(workstationSuffix);
  });

  it("is never recognised as the owner's own workstation", () => {
    expect(isOwnWorkstation(computeRouterId(KEY), KEY)).toBe(false);
  });
});

describe('isOwnRouter', () => {
  it("recognises the caller's own router id", () => {
    expect(isOwnRouter(computeRouterId(KEY), KEY)).toBe(true);
  });

  it("rejects another owner's router id", () => {
    // B scanning/standing on A's router must NOT see it as their own — A's
    // router id is derived from A's key, not B's.
    expect(isOwnRouter(computeRouterId(KEY), OTHER_KEY)).toBe(false);
  });

  it("rejects the caller's own workstation id (the router is a distinct machine)", () => {
    expect(isOwnRouter(computeWorkstationId('box', KEY), KEY)).toBe(false);
  });

  it('rejects an unrelated machine id', () => {
    expect(isOwnRouter('203.0.113.7', KEY)).toBe(false);
  });
});

describe('computeInnerGatewayId', () => {
  // A deeper-layer gateway hanging off the player's own LAN. It is the player's
  // OWN device, but it must NOT alias the edge router (`computeRouterId`) — so it
  // lives in its own key+octet namespace. The octet is load-bearing: two inner
  // gateways at different octets must never collide.
  it('returns an `inner-gw-<8 hex>` id', () => {
    expect(computeInnerGatewayId(KEY, 37)).toMatch(/^inner-gw-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same key + octet', () => {
    expect(computeInnerGatewayId(KEY, 37)).toBe(computeInnerGatewayId(KEY, 37));
  });

  it('differs from the edge router id for the same key (never aliases the edge)', () => {
    expect(computeInnerGatewayId(KEY, 37)).not.toBe(computeRouterId(KEY));
  });

  it('differs per octet, so two inner gateways never alias', () => {
    expect(computeInnerGatewayId(KEY, 37)).not.toBe(computeInnerGatewayId(KEY, 38));
  });

  it('differs for different keys at the same octet', () => {
    expect(computeInnerGatewayId(KEY, 37)).not.toBe(computeInnerGatewayId(OTHER_KEY, 37));
  });

  it('is distinct from a coordinate-seeded NPC sibling id', () => {
    // An NPC sibling lives in the `host:<essid>:<ip>` coordinate namespace; the
    // inner gateway lives in the `ed25519-inner-gw:` key namespace — they can
    // never collide even when an NPC happens to share the gateway's octet.
    const sibling: LanHost = { ip: '192.168.29.37', hostname: 'desktop-37', kind: 'machine' };
    expect(computeInnerGatewayId(KEY, 37)).not.toBe(hostMachineId(sibling, 'BEAN-THERE-WIFI'));
  });

  it("is never recognised as the owner's own workstation", () => {
    expect(isOwnWorkstation(computeInnerGatewayId(KEY, 37), KEY)).toBe(false);
  });
});
