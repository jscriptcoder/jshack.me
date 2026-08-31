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
 * Bare object names over only the facts the game models. The MIB module prefixes are
 * gone on purpose: they named five modules a player never needs, and the walk printed
 * `NAT-MIB::natForward.2222` while `snmpset` accepted only `natForward.2222` — so a
 * player pasting back the device's own line was told the name did not exist. What a walk
 * prints is now exactly what a set takes.
 */

const routerIdentity = (
  overrides: Partial<Parameters<typeof renderIdentityWalk>[0]['identity']> = {},
) => ({
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
      '[READ-ONLY] Community "public" accepted on 10.0.0.1.',
      '',
      'sysDescr    = Linux gw-main',
      'sysName     = gw-main',
      'sysContact  = netops@corp.local',
      'interface.1 = eth0 (10.0.0.1)',
      'interface.2 = eth1 (82.14.203.77)',
      '',
      '5 OIDs returned. Community "public" is READ-ONLY.',
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
      '[READ-ONLY] Community "public" accepted on 10.0.0.5.',
      '',
      'sysDescr    = Cisco IOS L3 Switch sw-01',
      'sysName     = sw-01',
      'sysContact  = netops@corp.local',
      'interface.1 = GigabitEthernet0/1 (10.0.0.5)',
      '',
      '4 OIDs returned. Community "public" is READ-ONLY.',
      "Retry with a read-write community to see this device's port table.",
    ]);
  });

  it('gives one line per interface, carrying its name and its address together', () => {
    // A player reading this is answering "where does this device sit", and a name split
    // from its address across two blocks makes them join the two by index to find out.
    // One line per interface is the same two facts with the join already done.
    const lines = renderIdentityWalk({
      target: '10.0.0.1',
      community: 'public',
      identity: routerIdentity(),
    });

    expect(lines.filter((line) => line.startsWith('interface.'))).toEqual([
      'interface.1 = eth0 (10.0.0.1)',
      'interface.2 = eth1 (82.14.203.77)',
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
  it("appends the router's forwards, under the same verb its own file uses", () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.1',
        community: 'corpnet',
        identity: routerIdentity(),
        portTables: [
          {
            kind: 'nat',
            forwards: [
              { publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 },
              { publicPort: 8080, internalIp: '10.0.0.20', internalPort: 80 },
            ],
          },
        ],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 10.0.0.1.',
      '',
      'sysDescr     = Linux gw-main',
      'sysName      = gw-main',
      'sysContact   = netops@corp.local',
      'interface.1  = eth0 (10.0.0.1)',
      'interface.2  = eth1 (82.14.203.77)',
      'forward.2222 = 10.0.0.10:22',
      'forward.8080 = 10.0.0.20:80',
      '',
      '7 OIDs returned.',
      'Writable: snmpset 10.0.0.1 corpnet forward.<port>=<ip>:<port>',
    ]);
  });

  it("appends the switch's denied ports, in that platform's own object", () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.5',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'sw-01', kind: 'switch', addresses: ['10.0.0.5'] }),
        portTables: [{ kind: 'acl', denies: [22, 8080] }],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 10.0.0.5.',
      '',
      'sysDescr     = Cisco IOS L3 Switch sw-01',
      'sysName      = sw-01',
      'sysContact   = netops@corp.local',
      'interface.1  = GigabitEthernet0/1 (10.0.0.5)',
      'aclPort.22   = deny',
      'aclPort.8080 = deny',
      '',
      '6 OIDs returned.',
      'Writable: snmpset 10.0.0.5 corpnet aclPort.<port>=deny',
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
        portTables: [{ kind: 'nat', forwards: [] }],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 10.0.0.1.',
      '',
      'sysDescr    = Linux gw-main',
      'sysName     = gw-main',
      'sysContact  = netops@corp.local',
      'interface.1 = eth0 (10.0.0.1)',
      'interface.2 = eth1 (82.14.203.77)',
      '',
      'This device forwards no ports.',
      '5 OIDs returned.',
      'Writable: snmpset 10.0.0.1 corpnet forward.<port>=<ip>:<port>',
    ]);
  });

  it('says the same of a switch that denies nothing, in that platform words', () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.5',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'sw-01', kind: 'switch', addresses: ['10.0.0.5'] }),
        portTables: [{ kind: 'acl', denies: [] }],
      }),
    ).toContain('This device denies no ports.');
  });

  it('writes the trailer with the address and community the caller actually used', () => {
    // The player has just typed both, and a placeholder would make them retype what
    // they already know to reach the one part they do not. This line is meant to be
    // pasted back with a port filled in.
    expect(
      renderReadWriteWalk({
        target: '203.0.113.9:1161',
        community: 'hunter2',
        identity: routerIdentity({ hostname: 'edge-01', addresses: ['203.0.113.9'] }),
        portTables: [{ kind: 'nat', forwards: [] }],
      }),
    ).toContain('Writable: snmpset 203.0.113.9:1161 hunter2 forward.<port>=<ip>:<port>');
  });
});

/**
 * A device answers with EVERY table its files hold, rather than with the one table its
 * kind implies.
 *
 * A workstation and a gateway both carry `/etc/iptables/rules.v4` and neither carries an
 * `acl.conf`, so nothing a walk can read tells them apart — and a discriminant guessed
 * from a hostname, a header line or an interface count would be wrong on the first box
 * that broke the pattern. Rendering what the FILE says needs no such guess: a
 * workstation has no forwards and shows only denies, a gateway has no denies and shows
 * only forwards, and a box carrying both shows both. A real `rules.v4` holds both chains
 * too.
 */
describe('a device with more than one table', () => {
  it("renders a workstation's filter in the INPUT chain's own object", () => {
    expect(
      renderReadWriteWalk({
        target: '192.168.1.7',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'lab-01', addresses: ['192.168.1.7'] }),
        portTables: [
          { kind: 'nat', forwards: [] },
          { kind: 'filter', denies: [6379, 3306] },
        ],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 192.168.1.7.',
      '',
      'sysDescr       = Linux lab-01',
      'sysName        = lab-01',
      'sysContact     = netops@corp.local',
      'interface.1    = eth0 (192.168.1.7)',
      'inputPort.6379 = deny',
      'inputPort.3306 = deny',
      '',
      '6 OIDs returned.',
      'Writable: snmpset 192.168.1.7 corpnet forward.<port>=<ip>:<port>',
      '          snmpset 192.168.1.7 corpnet inputPort.<port>=deny',
    ]);
  });

  it('renders both chains of one file, forwards first, when a device carries both', () => {
    expect(
      renderReadWriteWalk({
        target: '10.0.0.1',
        community: 'corpnet',
        identity: routerIdentity(),
        portTables: [
          {
            kind: 'nat',
            forwards: [{ publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 }],
          },
          { kind: 'filter', denies: [161] },
        ],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 10.0.0.1.',
      '',
      'sysDescr      = Linux gw-main',
      'sysName       = gw-main',
      'sysContact    = netops@corp.local',
      'interface.1   = eth0 (10.0.0.1)',
      'interface.2   = eth1 (82.14.203.77)',
      'forward.2222  = 10.0.0.10:22',
      'inputPort.161 = deny',
      '',
      '7 OIDs returned.',
      'Writable: snmpset 10.0.0.1 corpnet forward.<port>=<ip>:<port>',
      '          snmpset 10.0.0.1 corpnet inputPort.<port>=deny',
    ]);
  });

  it('says an empty file is empty ONCE, naming both of the facts it holds none of', () => {
    // One file, one sentence. Two lines saying the device forwards nothing and then
    // denies nothing would read as two devices, and the state they describe — a
    // freshly installed box before its owner has written a single rule — is the
    // ordinary one, not an edge case.
    expect(
      renderReadWriteWalk({
        target: '192.168.1.7',
        community: 'corpnet',
        identity: routerIdentity({ hostname: 'lab-01', addresses: ['192.168.1.7'] }),
        portTables: [
          { kind: 'nat', forwards: [] },
          { kind: 'filter', denies: [] },
        ],
      }),
    ).toEqual([
      '[READ-WRITE] Community "corpnet" accepted on 192.168.1.7.',
      '',
      'sysDescr    = Linux lab-01',
      'sysName     = lab-01',
      'sysContact  = netops@corp.local',
      'interface.1 = eth0 (192.168.1.7)',
      '',
      'This device forwards and denies no ports.',
      '4 OIDs returned.',
      'Writable: snmpset 192.168.1.7 corpnet forward.<port>=<ip>:<port>',
      '          snmpset 192.168.1.7 corpnet inputPort.<port>=deny',
    ]);
  });

  it('fits the = column to the widest object in the block it is printing', () => {
    // The column follows the CONTENT rather than sitting at a width no device may
    // exceed. A fixed column had to be as wide as the longest name the door can print,
    // so every walk that printed none of them carried the slack — and the longest name
    // touched the column exactly, leaving one line with no space before its `=`.
    const wide = renderReadWriteWalk({
      target: '192.168.1.7',
      community: 'corpnet',
      identity: routerIdentity({ hostname: 'lab-01', addresses: ['192.168.1.7'] }),
      portTables: [{ kind: 'filter', denies: [65535] }],
    });
    const narrow = renderReadWriteWalk({
      target: '192.168.1.7',
      community: 'corpnet',
      identity: routerIdentity({ hostname: 'lab-01', addresses: ['192.168.1.7'] }),
      portTables: [{ kind: 'filter', denies: [22] }],
    });

    expect(wide).toContain('inputPort.65535 = deny');
    expect(wide).toContain('sysDescr        = Linux lab-01');
    expect(narrow).toContain('inputPort.22 = deny');
    expect(narrow).toContain('sysDescr     = Linux lab-01');
  });

  it('still answers a switch with its own single table and nothing about a filter', () => {
    const lines = renderReadWriteWalk({
      target: '10.0.0.5',
      community: 'corpnet',
      identity: routerIdentity({ hostname: 'sw-01', kind: 'switch', addresses: ['10.0.0.5'] }),
      portTables: [{ kind: 'acl', denies: [22] }],
    });

    expect(lines).toContain('aclPort.22  = deny');
    expect(lines).toContain('Writable: snmpset 10.0.0.5 corpnet aclPort.<port>=deny');
    expect(lines.some((line) => line.includes('inputPort'))).toBe(false);
  });

  it('prints no MIB module prefix anywhere, so every name is one a set accepts', () => {
    // The papercut this format exists to remove: the walk used to print
    // `NAT-MIB::natForward.2222` while `snmpset` took `natForward.2222` only, so the
    // device's own output pasted back was refused as a name that does not exist.
    const lines = renderReadWriteWalk({
      target: '10.0.0.1',
      community: 'corpnet',
      identity: routerIdentity(),
      portTables: [
        {
          kind: 'nat',
          forwards: [{ publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 }],
        },
        { kind: 'filter', denies: [161] },
      ],
    });

    expect(lines.some((line) => line.includes('::'))).toBe(false);
  });
});
