import { describe, expect, it, vi } from 'vitest';
import { generateHomeLan } from '../generation/generateHomeLan';
import { addressForTarget, resolveLanName } from './resolveName';

/** A real ESSID from the crackable pool, so every name and address under test is
 *  one a player could actually be standing in front of. */
const ESSID = 'SHINRA-5G';

/** The first ordinary machine on that LAN — not the gateway, which has a naming
 *  rule of its own. */
const someMachine = (essid: string) => {
  const machine = generateHomeLan(essid).hosts.find((host) => host.kind === 'machine');
  if (machine === undefined) throw new Error(`no machine on ${essid}`);
  return machine;
};

describe('resolving a name against the network you are standing on', () => {
  it('answers a bare hostname with that host address, under its full name', () => {
    const machine = someMachine(ESSID);

    expect(resolveLanName(ESSID, machine.hostname)).toEqual({
      fqdn: `${machine.hostname}.shinra-5g.lan`,
      ip: machine.ip,
    });
  });

  it('answers the fully qualified form with the same address as the bare one', () => {
    const machine = someMachine(ESSID);

    expect(resolveLanName(ESSID, `${machine.hostname}.shinra-5g.lan`)).toEqual({
      fqdn: `${machine.hostname}.shinra-5g.lan`,
      ip: machine.ip,
    });
  });

  it('answers nothing for a name this network has never heard of', () => {
    expect(resolveLanName(ESSID, 'nosuchbox')).toBeNull();
  });

  it('resolves the routers too — the boxes worth naming are not special cases', () => {
    // The gateway a player is about to ssh into is the single most useful name on
    // the LAN, and it earns no rule of its own: the access point's `.1`, the inner
    // gateway and the switch all answer because they are hosts like any other.
    const lan = generateHomeLan(ESSID);
    const routers = lan.hosts.filter((host) => host.kind !== 'machine');

    expect(routers.map((router) => resolveLanName(ESSID, router.hostname)?.ip)).toEqual(
      routers.map((router) => router.ip),
    );
    expect(routers.length).toBeGreaterThan(1);
  });

  it('refuses a name qualified with a different network domain', () => {
    // A player resolves the network they are standing on, not the world. The host
    // exists and the name is well formed; it is simply not this network's to answer.
    const machine = someMachine(ESSID);

    expect(resolveLanName(ESSID, `${machine.hostname}.acme-corp.lan`)).toBeNull();
  });
});

describe('turning what the player typed into an address', () => {
  it('hands an address straight back, without asking the network who is here', async () => {
    // An address is already an answer. Asking the server who else is on this LAN
    // before every `ssh`, `curl` and `nmap` typed the ordinary way would spend a
    // round trip per command to learn nothing.
    const resolveOccupants = vi.fn(async () => []);
    const address = `${generateHomeLan(ESSID).subnet}.28`;

    const resolved = await addressForTarget({ essid: ESSID, target: address, resolveOccupants });

    expect(resolved).toBe(address);
    expect(resolveOccupants).not.toHaveBeenCalled();
  });

  it('leaves an octet range alone too, so a sweep costs nothing extra', async () => {
    const resolveOccupants = vi.fn(async () => []);
    const range = `${generateHomeLan(ESSID).subnet}.1-254`;

    const resolved = await addressForTarget({ essid: ESSID, target: range, resolveOccupants });

    expect(resolved).toBe(range);
    expect(resolveOccupants).not.toHaveBeenCalled();
  });

  it('turns a name into the address behind it', async () => {
    const machine = someMachine(ESSID);

    const resolved = await addressForTarget({
      essid: ESSID,
      target: machine.hostname,
      resolveOccupants: async () => [],
    });

    expect(resolved).toBe(machine.ip);
  });

  it('hands back a name nothing answers to exactly as typed', async () => {
    // Unchanged rather than an error: the command that asked then reaches its own
    // unknown-target path, and no new message has to be invented six times over.
    const resolved = await addressForTarget({
      essid: ESSID,
      target: 'nosuchbox',
      resolveOccupants: async () => [],
    });

    expect(resolved).toBe('nosuchbox');
  });
});
