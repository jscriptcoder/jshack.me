import { describe, it, expect } from 'vitest';
import { getReservedLanOctets } from './getReservedLanOctets';
import { generateHomeNetwork } from '../generation/generateHomeNetwork';

describe('getReservedLanOctets', () => {
  it('returns the last-octet of every NPC machine on the LAN subnet', async () => {
    // Regenerate the same network independently and check the helper's
    // result matches the actual NPC IPs the generator produced.
    const seed = 'home-203.0.113.42';
    const publicIp = '203.0.113.42';
    const network = await generateHomeNetwork({
      seed,
      essid: 'reservation-lookup-only',
      routerPublicIp: publicIp,
    });
    const lanSubnet = network.layers[0]!.subnet;
    const expectedOctets = new Set<number>();
    for (const m of network.machines) {
      if (m.ip.startsWith(`${lanSubnet}.`)) {
        expectedOctets.add(Number(m.ip.split('.').pop()));
      }
    }
    expectedOctets.add(1); // gateway is reserved by convention

    const reserved = await getReservedLanOctets({ seed, publicIp });

    for (const octet of expectedOctets) {
      expect(reserved.has(octet)).toBe(true);
    }
  });

  it('always includes the gateway octet (.1)', async () => {
    // Pinned: even though .1 is outside [10, 250] anyway, including it
    // documents the intent and protects against any future range expansion.
    const reserved = await getReservedLanOctets({
      seed: 'home-198.51.100.10',
      publicIp: '198.51.100.10',
    });
    expect(reserved.has(1)).toBe(true);
  });

  it('returns deterministic output for the same (seed, publicIp)', async () => {
    // Memoization safety: the helper is pure-deterministic, so callers
    // can cache its result indefinitely per (seed, publicIp).
    const a = await getReservedLanOctets({
      seed: 'home-203.0.113.50',
      publicIp: '203.0.113.50',
    });
    const b = await getReservedLanOctets({
      seed: 'home-203.0.113.50',
      publicIp: '203.0.113.50',
    });
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('returns different sets for different seeds (NPC topology varies)', async () => {
    const a = await getReservedLanOctets({
      seed: 'home-203.0.113.51',
      publicIp: '203.0.113.51',
    });
    const b = await getReservedLanOctets({
      seed: 'home-203.0.113.52',
      publicIp: '203.0.113.52',
    });
    // Both will share .1 (gateway), but the rest should diverge.
    const aWithoutGateway = new Set([...a].filter((x) => x !== 1));
    const bWithoutGateway = new Set([...b].filter((x) => x !== 1));
    // At least one octet differs — not a strict equality check because
    // there's a tiny chance the random topology produces the same octets.
    const hasDifference =
      aWithoutGateway.size !== bWithoutGateway.size ||
      [...aWithoutGateway].some((x) => !bWithoutGateway.has(x));
    expect(hasDifference).toBe(true);
  });

  it('only includes octets on the LAN subnet (not inner-layer machines)', async () => {
    // For multi-layer networks (medium/hard difficulty), inner-layer
    // machines have IPs on a different subnet. The slot allocator only
    // cares about the LAN subnet (where occupants live).
    const seed = 'home-multi-layer-test';
    const publicIp = '203.0.113.99';
    const network = await generateHomeNetwork({
      seed,
      essid: 'reservation-lookup-only',
      routerPublicIp: publicIp,
    });
    const lanSubnet = network.layers[0]!.subnet;

    const reserved = await getReservedLanOctets({ seed, publicIp });

    // Every octet returned must correspond to a machine on the LAN
    // subnet (or be the gateway .1).
    for (const octet of reserved) {
      if (octet === 1) continue;
      const lanIp = `${lanSubnet}.${octet}`;
      const machineOnLan = network.machines.find((m) => m.ip === lanIp);
      expect(machineOnLan, `octet ${octet} should be a LAN-subnet machine IP`).toBeDefined();
    }
  });
});
