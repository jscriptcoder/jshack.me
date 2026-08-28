import { describe, expect, it } from 'vitest';
import { renderIdentityWalk, renderReadWriteWalk } from './walk';

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

/**
 * What the read-write community buys on top: the device's port table, rendered from the
 * very file the box routes by. One fact, two interfaces — `nano` over a shell, and this
 * without one. Stored twice instead, the door could tell a player a port was open that
 * the box does not forward, which is the failure the single source exists to prevent.
 *
 * A SEPARATE entry point from the read-only render rather than the same one with the
 * table left off. A device that forwards nothing is the ORDINARY state of a fresh
 * router — default-deny means its shipped `rules.v4` parses to nothing at all — so a
 * renderer that inferred the tier from whether the table had rows would tell most
 * players their cracked community had been refused.
 */
describe('a read-write walk', () => {
  it("appends the router's forwards, and says which community tier answered", () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.1',
        community: 'corpnet',
        identity: routerIdentity(),
        portTable: {
          kind: 'nat',
          forwards: [
            { publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 },
            { publicPort: 8080, internalIp: '10.0.0.20', internalPort: 80 },
          ],
        },
      }),
    ).toEqual([
      'Querying 10.0.0.1 with community string "corpnet"...',
      '[READ-WRITE] Community "corpnet" accepted.',
      '',
      'SNMPv2-MIB::sysDescr.0    = STRING:    Linux gw-main',
      'SNMPv2-MIB::sysName.0     = STRING:    gw-main',
      'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
      'IF-MIB::ifDescr.1         = STRING:    eth0',
      'IF-MIB::ifDescr.2         = STRING:    eth1',
      'IF-MIB::ifAddr.1          = IpAddress: 10.0.0.1',
      'IF-MIB::ifAddr.2          = IpAddress: 82.14.203.77',
      'NAT-MIB::natForward.2222  = STRING:    10.0.0.10:22',
      'NAT-MIB::natForward.8080  = STRING:    10.0.0.20:80',
      '',
      '9 OIDs returned. Community "corpnet" is READ-WRITE.',
      'Writable: snmpset <host> <community> natForward.<port>=<ip>:<port>',
    ]);
  });

  it("appends the switch's denied ports, in that platform's own OID", () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.5',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'sw-01', kind: 'switch', addresses: ['10.0.0.5'] }),
        portTable: { kind: 'acl', denies: [22, 8080] },
      }),
    ).toEqual([
      'Querying 10.0.0.5 with community string "corpnet"...',
      '[READ-WRITE] Community "corpnet" accepted.',
      '',
      'SNMPv2-MIB::sysDescr.0    = STRING:    Cisco IOS L3 Switch sw-01',
      'SNMPv2-MIB::sysName.0     = STRING:    sw-01',
      'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
      'IF-MIB::ifDescr.1         = STRING:    GigabitEthernet0/1',
      'IF-MIB::ifAddr.1          = IpAddress: 10.0.0.5',
      'ACL-MIB::aclPort.22       = STRING:    deny',
      'ACL-MIB::aclPort.8080     = STRING:    deny',
      '',
      '7 OIDs returned. Community "corpnet" is READ-WRITE.',
      'Writable: snmpset <host> <community> aclPort.<port>=deny',
    ]);
  });

  it('says so plainly when a device forwards nothing, and still says what to write', () => {
    // The ordinary state of a fresh router, not an edge case: `rules.v4` ships as a
    // header and a commented example, so a player who has just cracked a community
    // usually finds a table with no rows in it. Silence there reads as a broken tool;
    // the empty line names the state and the trailer turns it into the next move.
    expect(
      renderReadWriteWalk({
        target: '10.0.0.1',
        community: 'corpnet',
        identity: routerIdentity(),
        portTable: { kind: 'nat', forwards: [] },
      }),
    ).toEqual([
      'Querying 10.0.0.1 with community string "corpnet"...',
      '[READ-WRITE] Community "corpnet" accepted.',
      '',
      'SNMPv2-MIB::sysDescr.0    = STRING:    Linux gw-main',
      'SNMPv2-MIB::sysName.0     = STRING:    gw-main',
      'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
      'IF-MIB::ifDescr.1         = STRING:    eth0',
      'IF-MIB::ifDescr.2         = STRING:    eth1',
      'IF-MIB::ifAddr.1          = IpAddress: 10.0.0.1',
      'IF-MIB::ifAddr.2          = IpAddress: 82.14.203.77',
      '',
      'This device forwards no ports.',
      '7 OIDs returned. Community "corpnet" is READ-WRITE.',
      'Writable: snmpset <host> <community> natForward.<port>=<ip>:<port>',
    ]);
  });

  it('says the same of a switch that denies nothing, in that platform words', () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.5',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'sw-01', kind: 'switch', addresses: ['10.0.0.5'] }),
        portTable: { kind: 'acl', denies: [] },
      }),
    ).toContain('This device denies no ports.');
  });
});
