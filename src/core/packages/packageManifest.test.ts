import { describe, expect, it } from 'vitest';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { buildRemoteHostFs, hostServices } from '../generation/remoteHostFs';
import { buildDeepHostFs } from '../generation/deepHostFs';
import {
  buildApGatewayBaseFs,
  buildDeepGatewayBaseFs,
  buildDeepSwitchBaseFs,
  buildInnerGatewayBaseFs,
  buildSwitchBaseFs,
} from '../generation/routerFs';
import { SYSTEM_LIBRARIES } from '../generation/libraries';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { readOpenPorts } from '../services/pidfile';
import { filterTreeForRead, filterTreeToAllowlist } from '../patches/readFilter';
import { buildEntry, DPKG_STATUS_PATH, formatDpkgStatus, parseDpkgVersions } from './dpkgStatus';
import { withPackageManifest } from './packageManifest';
import { displayVersion, PACKAGE_TEMPLATES, startingVersionOf } from './packageVersions';
import type { LanHost } from '../generation/generateHomeLan';
import type { Directory, FileNode } from '../filesystem/types';

/**
 * `/var/lib/dpkg/status` is the single source of truth for what software a box
 * runs and at what version — the fact every CVE in the game is keyed on, and the
 * file `nmap -sV` and `apt upgrade` both read.
 *
 * It follows dpkg's own rule: it lists what is INSTALLED, not what is RUNNING. A
 * box carries a service's package when it carries that service's daemon binary,
 * which is why the player's own workstation lists `openssh-server` before they
 * have ever started sshd — and why the manifest is still right on a deep host,
 * whose sshd is patched on after its tree is built.
 */

const ESSID = 'BEAN-THERE-WIFI';
const SUBNET = '192.168.50';

const host = (octet: number): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname: `host-${octet}`,
  kind: 'machine',
});

const playerBox = (): Directory =>
  buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    username: 'alice',
    rootPasswordHash: 'd41d8cd98f00b204e9800998ecf8427e',
  });

/** The raw text of a generated tree's manifest. */
const manifestTextOf = (fs: Directory): string => {
  let node: FileNode = fs;
  for (const segment of DPKG_STATUS_PATH.split('/').filter((part) => part.length > 0)) {
    if (node.kind !== 'directory') throw new Error(`not a directory before "${segment}"`);
    const next = node.entries.get(segment);
    if (next === undefined) throw new Error(`no ${DPKG_STATUS_PATH} on this box`);
    node = next;
  }
  if (node.kind !== 'file') throw new Error(`${DPKG_STATUS_PATH} is not a file`);
  return node.content;
};

/** The manifest of a generated tree, parsed to package → version. */
const manifestOf = (fs: Directory): ReadonlyMap<string, string> =>
  parseDpkgVersions(manifestTextOf(fs));

/** The firmware rows of a generated tree's manifest. */
const firmwareOf = (fs: Directory): readonly (readonly [string, string])[] =>
  [...manifestOf(fs)].filter(([pkg]) => pkg.endsWith('-firmware'));

/** The octets whose generated host runs at least one catalog service — the boxes
 *  whose manifest has a service package to prove, rather than only the pair every
 *  box ships with. */
const servingOctets = (): readonly number[] =>
  Array.from({ length: 60 }, (_unused, index) => index + 2).filter(
    (octet) => hostServices(ESSID, host(octet)).length > 0,
  );

describe('the package manifest every box carries', () => {
  it('names the daemons a box CARRIES, not the ones it is running', () => {
    // The player's box ships sshd and vsftpd and runs neither: services are opt-in,
    // and `systemctl start sshd` must not open a port with no package behind it.
    const manifest = manifestOf(playerBox());

    expect(readOpenPorts(playerBox())).toEqual([]);
    expect(manifest.has('openssh-server')).toBe(true);
    expect(manifest.has('vsftpd')).toBe(true);
  });

  it('does not name a service package whose daemon the box never carries', () => {
    const manifest = manifestOf(playerBox());

    expect(manifest.has('nginx')).toBe(false);
    expect(manifest.has('bind9')).toBe(false);
    expect(manifest.has('mysql')).toBe(false);
    expect(manifest.has('redis')).toBe(false);
  });

  it('names the package of every service a generated host actually runs', () => {
    const octets = servingOctets();
    expect(octets.length).toBeGreaterThan(0);

    for (const octet of octets) {
      const manifest = manifestOf(buildRemoteHostFs(ESSID, host(octet)));
      for (const { spec } of hostServices(ESSID, host(octet))) {
        expect(manifest.has(spec.package)).toBe(true);
      }
    }
  });

  it('names the forced sshd on a deep host, whose daemon is patched on after the tree is built', () => {
    const manifest = manifestOf(buildDeepHostFs(ESSID, host(7)));

    expect(manifest.get('openssh-server')).toBeDefined();
  });

  it('names all eight system libraries on every box', () => {
    const boxes: readonly Directory[] = [
      playerBox(),
      buildRemoteHostFs(ESSID, host(11)),
      buildDeepHostFs(ESSID, host(12)),
      buildApGatewayBaseFs(ESSID),
      buildSwitchBaseFs(ESSID, 13),
    ];

    for (const box of boxes) {
      const manifest = manifestOf(box);
      for (const library of SYSTEM_LIBRARIES) {
        expect(manifest.has(library)).toBe(true);
      }
    }
  });

  it("names the firmware every network device drew, at that vendor's first release", () => {
    // One exact row per device kind. The vendor is each box's own draw and only the
    // package name carries it: two vendors' histories can reach the same version, so
    // a bare version could not say whose image a box is running.
    expect(firmwareOf(buildApGatewayBaseFs(ESSID))).toEqual([['ddwrt-firmware', '24.0.1']]);
    expect(firmwareOf(buildSwitchBaseFs(ESSID, 13))).toEqual([['pfsense-firmware', '2.7.2']]);
    expect(firmwareOf(buildInnerGatewayBaseFs(ESSID, 14))).toEqual([['mikrotik-firmware', '7.14.2']]);
    expect(firmwareOf(buildDeepGatewayBaseFs(ESSID, 'm-1', 15))).toEqual([['pfsense-firmware', '2.7.2']]);
    expect(firmwareOf(buildDeepSwitchBaseFs(ESSID, 'm-1', 16))).toEqual([['cisco-firmware', '15.9.3']]);
  });

  it('names no firmware on a box that is not a network device', () => {
    // A row here would put an image the box does not have into `apt list -u`.
    expect(firmwareOf(playerBox())).toEqual([]);
    expect(firmwareOf(buildRemoteHostFs(ESSID, host(22)))).toEqual([]);
    expect(firmwareOf(buildDeepHostFs(ESSID, host(12)))).toEqual([]);
  });

  it('records a bare version tuple, never a vendor prefix', () => {
    // `OpenSSH 9.7.0` in this field would make the manifest disagree with real dpkg
    // and give the display name a second home. The prefix belongs to the version
    // template that `nmap -sV` renders.
    const manifest = manifestOf(buildRemoteHostFs(ESSID, host(31)));

    for (const version of manifest.values()) {
      expect(version).toMatch(/^\d+(\.\d+)*$/);
    }
    // Exact values, because a dotted shape alone is satisfied by a version whose
    // separator has gone missing entirely — `970` passes the pattern above.
    expect(manifest.get('openssh-server')).toBe('9.7.0');
    expect(manifest.get('libpcre')).toBe('10.43.0');
  });

  it('is born on a real release of every package it can name, firmware included', () => {
    // A blank here is a manifest row with no version in it — a box that could never be
    // matched against a CVE, and an `apt list -u` row naming nothing.
    for (const pkg of Object.keys(PACKAGE_TEMPLATES)) {
      expect(startingVersionOf(pkg)).toMatch(/^\d+(\.\d+)+$/);
    }
  });

  it('shows a package it has no product name for by its bare version', () => {
    expect(displayVersion('metasploit', '6.4.0')).toBe('6.4.0');
    expect(displayVersion('openssh-server', '9.7.0')).toBe('OpenSSH 9.7.0');
  });

  it('has no version to offer for a package it has never heard of', () => {
    // What keeps an unknown name out of the manifest rather than into it carrying a
    // blank version — the entry a `nmap -sV` column would then render as a lie.
    expect(startingVersionOf('vim')).toBeUndefined();
    expect(startingVersionOf('openssh-server')).toBe('9.7.0');
  });

  it("leaves a network device's port table exactly as it reads without its firmware", () => {
    // A router's image answers to no port, so the row that names it must not reach a
    // version scan: stamping the same tree with no vendor is the box as it read before
    // firmware had a name.
    const gateway = buildApGatewayBaseFs(ESSID);
    const ports = readOpenPorts(gateway, { gameDay: 1000 });

    expect(ports.length).toBeGreaterThan(0);
    expect(ports).toEqual(readOpenPorts(withPackageManifest(gateway), { gameDay: 1000 }));
  });

  it('reads at every tier a session hands out, and to a stranger with none', () => {
    // What software a box runs is the lowest rung of recon and costs no credential:
    // guest reads it once inside, and the tier-3 allowlist publishes it to a scanner
    // who proved nothing at all — which is what makes a version scan possible without
    // first breaking in. Its neighbours under `/var/lib` are not so generous.
    const fs = buildRemoteHostFs(ESSID, host(41));

    for (const tier of ['guest', 'user', 'root'] as const) {
      expect(manifestOf(filterTreeForRead(fs, tier)).size).toBeGreaterThan(0);
    }
    expect(manifestOf(filterTreeToAllowlist(fs)).size).toBeGreaterThan(0);
  });

  it('gives every catalog service a package name of its own', () => {
    // The name server wears three names and each has a job: `dns` is the catalog key,
    // `domain` is what nmap prints in its SERVICE column (as real nmap does for :53),
    // and `bind9` is what apt answers to. Conflating the last two is what would make
    // apt take two names for one thing.
    for (const spec of Object.values(SERVICE_CATALOG)) {
      expect(spec.package.length).toBeGreaterThan(0);
    }
    expect(SERVICE_CATALOG.dns.service).toBe('domain');
    expect(SERVICE_CATALOG.dns.package).toBe('bind9');
    expect(SERVICE_CATALOG.ssh.package).toBe('openssh-server');
  });
});

describe('the dpkg status format a player reads with cat', () => {
  it('writes RFC-822 blocks: three fields each, one blank line between', () => {
    // The shape is the point. A player who cats this file has to recognise it as the
    // real thing, and `apt` and the version scan both parse what is written here.
    const text = manifestTextOf(playerBox());

    expect(text.startsWith('Package: openssh-server\nStatus: install ok installed\nVersion: 9.7.0\n\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\n\n\n');
    for (const block of text.trim().split('\n\n')) {
      expect(block.split('\n')).toHaveLength(3);
    }
  });

  it('reads back exactly what it wrote', () => {
    const entries = [buildEntry('openssh-server', '9.7.0'), buildEntry('libz', '1.3.1')];

    expect([...parseDpkgVersions(formatDpkgStatus(entries))]).toEqual([
      ['openssh-server', '9.7.0'],
      ['libz', '1.3.1'],
    ]);
  });

  it('skips a block that names no package or no version, and keeps its neighbours', () => {
    // A block missing either field cannot answer the one question this file exists to
    // answer. Half-reading it would put a package in the manifest with no version, or
    // a version under no name — either of which a version scan would then render.
    const text = [
      'Package: openssh-server\nStatus: install ok installed\nVersion: 9.7.0',
      'Package: half-a-package\nStatus: install ok installed',
      'Status: install ok installed\nVersion: 2.0.0',
      'Package:\nVersion: 3.0.0',
      'Package: libz\nStatus: install ok installed\nVersion: 1.3.1',
    ].join('\n\n');

    expect([...parseDpkgVersions(text).keys()]).toEqual(['openssh-server', 'libz']);
  });

  it('tolerates the blank-line noise a hand-edited file picks up', () => {
    const text =
      '\n\nPackage: libz\nStatus: install ok installed\nVersion: 1.3.1\n   \n\nPackage: libpam\nStatus: install ok installed\nVersion: 1.5.3\n\n\n';

    expect([...parseDpkgVersions(text).keys()]).toEqual(['libz', 'libpam']);
  });

  it('trims the whitespace around a field value rather than keeping it in the version', () => {
    const text = 'Package:   libz  \nStatus: install ok installed\nVersion:   1.3.1  ';

    expect([...parseDpkgVersions(text)]).toEqual([['libz', '1.3.1']]);
  });

  it('accepts any spacing after the colon, including none and a tab', () => {
    // The file is root-writable and a player who owns the box can `nano` it, so the
    // parser has to read what a person types rather than only what the generator
    // wrote. Real dpkg is equally relaxed about the space after a field's colon.
    expect([...parseDpkgVersions('Package:libz\nVersion:1.3.1')]).toEqual([['libz', '1.3.1']]);
    expect([...parseDpkgVersions('Package:\tlibz\nVersion:\t1.3.1')]).toEqual([
      ['libz', '1.3.1'],
    ]);
  });

  it('reads a field only at the start of its own line', () => {
    // `Package:` inside a value is a value, not a field. Without the line anchor the
    // description of a package could rename the package it describes.
    const text = 'Package: libz\nDescription: not a Package: libpam here\nVersion: 1.3.1';

    expect([...parseDpkgVersions(text)]).toEqual([['libz', '1.3.1']]);
  });

  it('reads the field that OWNS its line, not the first one mentioned anywhere', () => {
    // The line anchor is doing work a leftmost match would appear to do for free: with a
    // well-formed block the real field comes first either way, so only a block that
    // MENTIONS a field before declaring one can tell the two apart. The file is
    // root-writable and a description is free text, so that block is one a player can
    // write — and reading it would let a package rename itself by talking about another.
    // Both fields, because they carry the same anchor and a defence on one of them is
    // not a defence: whichever is left unanchored is the one a crafted block would use.
    const namePreempted =
      'Description: superseded by Package: libpam\nPackage: libz\nVersion: 1.3.1';
    const versionPreempted =
      'Package: libz\nDescription: not Version: 9.9.9\nVersion: 1.3.1';

    expect([...parseDpkgVersions(namePreempted)]).toEqual([['libz', '1.3.1']]);
    expect([...parseDpkgVersions(versionPreempted)]).toEqual([['libz', '1.3.1']]);
  });

  it('keeps a block together when not one of its lines contains a space', () => {
    // Blocks are separated by a BLANK line, which means whitespace and nothing else. A
    // separator that keyed on the line's content instead would cut this block into two
    // halves — one naming a package with no version, the other a version under no name —
    // and drop both. `Package:libz` with no space is already a shape the parser accepts,
    // so this is a file somebody can hand-edit into existence.
    const text = 'Package:libz\nStatus:ok\nVersion:1.3.1';

    expect([...parseDpkgVersions(text)]).toEqual([['libz', '1.3.1']]);
  });

  it('finds nothing in an empty file', () => {
    expect(parseDpkgVersions('').size).toBe(0);
    expect(parseDpkgVersions('\n  \n').size).toBe(0);
  });
});
