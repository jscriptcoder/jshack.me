/**
 * What version a package STARTS at, and what a version scan calls it.
 *
 * One table over all three CVE axes — service packages, system libraries and
 * router firmware — because `/var/lib/dpkg/status` is itself one flat namespace
 * keyed by package name, in which a daemon, a shared object and a router's
 * firmware are indistinguishable. Splitting this into three tables would
 * re-introduce a distinction the manifest does not make, and the timeline walker
 * that later advances these versions would have to learn all three.
 *
 * The version a manifest records is the bare tuple (`9.7.0`). `displayPrefix` is
 * presentation only — the product name `nmap -sV` prints in front of it
 * (`OpenSSH 9.7.0`), and the reason the service catalog's `banner` stays
 * version-free: the daemon announcing its own build would be a second authority
 * over the fact CVEs are keyed on.
 *
 * Tuples are ported from legacy's three template pools
 * (`pools/{serviceTemplates,systemLibraryTemplates,routerFirmware}.ts`) and chosen
 * to read as currently-shipping software. `net-snmp` is the one row with no legacy
 * counterpart — legacy had no SNMP door.
 */

import type { SystemLibrary } from '../generation/libraries';

export type VersionTemplate = {
  /** This package's permanent number in the CVE serial, hand-assigned and never
   *  reused. It must NEVER be derived from this file's order or from a sort: a CVE
   *  id lands in players' log files and is the only route back from a password
   *  reset, so renumbering one when the catalog grows would silently rewrite ids
   *  already written down. Adding a package means picking the next unused number,
   *  and the field being required is what stops one being added without a number. */
  readonly cveNumber: number;
  /** What a version scan prints in front of the tuple. Trailing space or slash is
   *  part of the name as the product writes it (`nginx/1.26.0`, `OpenSSH 9.7.0`). */
  readonly displayPrefix: string;
  readonly startTuple: readonly number[];
};

/** The vendors a router-class box's firmware can come from. */
export type FirmwareVendor = 'cisco' | 'mikrotik' | 'ddwrt' | 'openwrt' | 'pfsense' | 'ubiquiti';

/** The package name every router-class box records its firmware under. Synthetic:
 *  a router is not apt-managed by the player, so this is the one package name in
 *  the manifest that the apt catalog does not own. */
export const FIRMWARE_PACKAGE = 'firmware';

export const FIRMWARE_TEMPLATES: Readonly<Record<FirmwareVendor, VersionTemplate>> = {
  cisco: { cveNumber: 16, displayPrefix: 'Cisco IOS ', startTuple: [15, 9, 3] },
  mikrotik: { cveNumber: 17, displayPrefix: 'MikroTik RouterOS ', startTuple: [7, 14, 2] },
  ddwrt: { cveNumber: 18, displayPrefix: 'DD-WRT v', startTuple: [24, 0, 1] },
  openwrt: { cveNumber: 19, displayPrefix: 'OpenWRT ', startTuple: [23, 5, 0] },
  pfsense: { cveNumber: 20, displayPrefix: 'pfSense ', startTuple: [2, 7, 2] },
  ubiquiti: { cveNumber: 21, displayPrefix: 'EdgeOS ', startTuple: [2, 0, 9] },
};

export const FIRMWARE_VENDORS: readonly FirmwareVendor[] = Object.keys(
  FIRMWARE_TEMPLATES,
) as readonly FirmwareVendor[];

const LIBRARY_TEMPLATES: Readonly<Record<SystemLibrary, VersionTemplate>> = {
  libpam: { cveNumber: 8, displayPrefix: 'libpam ', startTuple: [1, 5, 3] },
  libcrypt: { cveNumber: 9, displayPrefix: 'libcrypt ', startTuple: [4, 4, 36] },
  libsystemd: { cveNumber: 10, displayPrefix: 'libsystemd ', startTuple: [255, 4, 0] },
  libreadline: { cveNumber: 11, displayPrefix: 'libreadline ', startTuple: [8, 2, 10] },
  libssl: { cveNumber: 12, displayPrefix: 'OpenSSL ', startTuple: [3, 2, 1] },
  libz: { cveNumber: 13, displayPrefix: 'zlib ', startTuple: [1, 3, 1] },
  libxml2: { cveNumber: 14, displayPrefix: 'libxml2 ', startTuple: [2, 12, 5] },
  libpcre: { cveNumber: 15, displayPrefix: 'PCRE2 ', startTuple: [10, 43, 0] },
};

/** Keyed by APT package name — the same name `/var/lib/dpkg/status` records and
 *  `apt upgrade` takes, never the service label a scan prints. */
const SERVICE_PACKAGE_TEMPLATES: Readonly<Record<string, VersionTemplate>> = {
  'openssh-server': { cveNumber: 1, displayPrefix: 'OpenSSH ', startTuple: [9, 7, 0] },
  nginx: { cveNumber: 2, displayPrefix: 'nginx/', startTuple: [1, 26, 0] },
  vsftpd: { cveNumber: 3, displayPrefix: 'vsftpd ', startTuple: [3, 0, 6] },
  mysql: { cveNumber: 4, displayPrefix: 'MySQL ', startTuple: [8, 0, 36] },
  redis: { cveNumber: 5, displayPrefix: 'Redis ', startTuple: [7, 2, 5] },
  bind9: { cveNumber: 6, displayPrefix: 'BIND ', startTuple: [9, 18, 22] },
  snmp: { cveNumber: 7, displayPrefix: 'net-snmp ', startTuple: [5, 9, 4] },
};

/** Every package that carries a version, across all three axes. Firmware is keyed
 *  by VENDOR rather than by package name, because the six vendors share one
 *  package name and only the box knows which of them it runs. */
export const PACKAGE_TEMPLATES: Readonly<Record<string, VersionTemplate>> = {
  ...SERVICE_PACKAGE_TEMPLATES,
  ...LIBRARY_TEMPLATES,
};

export const formatVersion = (tuple: readonly number[]): string => tuple.join('.');

/** The version a freshly generated box records for `pkg`, or undefined for a
 *  package with no timeline. Nothing in the world moves off this until `apt
 *  upgrade` and the CVE timeline land. */
export const startingVersionOf = (pkg: string): string | undefined => {
  const template = PACKAGE_TEMPLATES[pkg];
  return template === undefined ? undefined : formatVersion(template.startTuple);
};

export const startingFirmwareVersionOf = (vendor: FirmwareVendor): string =>
  formatVersion(FIRMWARE_TEMPLATES[vendor].startTuple);

/** What a version scan shows for a package at a version: the product's own name in
 *  front of the tuple the manifest holds. A package with no template shows the bare
 *  version rather than inventing a name for it. */
export const displayVersion = (pkg: string, version: string): string => {
  const template = PACKAGE_TEMPLATES[pkg];
  return template === undefined ? version : `${template.displayPrefix}${version}`;
};
