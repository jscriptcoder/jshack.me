import { describe, expect, it } from 'vitest';
import { renderIdentityWalk } from './walk';

/**
 * What a device says about ITSELF when asked with the read-only community.
 *
 * This is the whole of what `public` buys: you learn what the box IS, and nothing about
 * what it DOES. The port table is the read-write community's answer, so a walk that
 * ended here has told an attacker there is something worth cracking without telling them
 * one port it forwards.
 *
 * Real MIB prefixes and real types, over only the OIDs the game actually models. The
 * full net-snmp walk was rejected deliberately: `sysObjectID`, `Timeticks` and
 * `ifPhysAddress` are facts the world cannot hold and a player cannot act on, and they
 * bury the lines that matter in noise. Every line here maps 1:1 onto something true.
 *
 * `IpAddress:` rather than `STRING:` for an address is the one place real SNMP typing
 * carries information, so it is kept.
 */

const routerIdentity = (overrides: Partial<Parameters<typeof renderIdentityWalk>[0]['identity']> = {}) => ({
  hostname: 'gw-main',
  kind: 'router' as const,
  sysContact: 'netops@corp.local',
  addresses: ['10.0.0.1', '82.14.203.77'],
  ...overrides,
});

describe('a read-only walk', () => {
  it('names the device, its contact and every address it holds', () => {
    expect(
      renderIdentityWalk({
        target: '10.0.0.1',
        community: 'public',
        identity: routerIdentity(),
      }),
    ).toEqual([
      'Querying 10.0.0.1 with community string "public"...',
      '[READ-ONLY] Community "public" accepted.',
      '',
      'SNMPv2-MIB::sysDescr.0    = STRING:    Linux gw-main',
      'SNMPv2-MIB::sysName.0     = STRING:    gw-main',
      'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
      'IF-MIB::ifDescr.1         = STRING:    eth0',
      'IF-MIB::ifDescr.2         = STRING:    eth1',
      'IF-MIB::ifAddr.1          = IpAddress: 10.0.0.1',
      'IF-MIB::ifAddr.2          = IpAddress: 82.14.203.77',
      '',
      '7 OIDs returned. Community "public" is READ-ONLY.',
      "Retry with a read-write community to see this device's port table.",
    ]);
  });

  it('names a switch by its platform, with the interfaces that platform has', () => {
    // A switch reading like a router would make the two indistinguishable in the only
    // tool that ever inspects one closely — and the kind is exactly what a player is
    // walking the device to learn.
    expect(
      renderIdentityWalk({
        target: '10.0.0.5',
        community: 'public',
        identity: routerIdentity({
          hostname: 'sw-01',
          kind: 'switch',
          addresses: ['10.0.0.5'],
        }),
      }),
    ).toEqual([
      'Querying 10.0.0.5 with community string "public"...',
      '[READ-ONLY] Community "public" accepted.',
      '',
      'SNMPv2-MIB::sysDescr.0    = STRING:    Cisco IOS L3 Switch sw-01',
      'SNMPv2-MIB::sysName.0     = STRING:    sw-01',
      'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
      'IF-MIB::ifDescr.1         = STRING:    GigabitEthernet0/1',
      'IF-MIB::ifAddr.1          = IpAddress: 10.0.0.5',
      '',
      '5 OIDs returned. Community "public" is READ-ONLY.',
      "Retry with a read-write community to see this device's port table.",
    ]);
  });
});
