/**
 * Stamping `/var/lib/dpkg/status` onto a generated box.
 *
 * The manifest follows dpkg's own rule: it lists what is INSTALLED, not what is
 * RUNNING. A box carries a service's package when it carries that service's daemon
 * binary in `/usr/sbin` — which is exactly what the world generator puts there for
 * the services a box runs, and what every box carries for the two daemons
 * (`sshd`, `vsftpd`) that ship everywhere.
 *
 * Reading the tree rather than taking a service list is what makes the two boxes
 * that do NOT match "what it is running" come out right. The player's own box runs
 * nothing until they start it, and must still be able to `apt upgrade` the sshd it
 * has; a deep host has `sshd` patched onto its tree AFTER the tree is built, and a
 * manifest derived from a list handed in earlier could not see it.
 *
 * `applyPatches` scaffolds `/var/lib` and `/var/lib/dpkg` world-traversable when
 * they are absent, which is the same shape both directories have where a datadir
 * already creates them.
 */

import { applyPatches } from '../filesystem/applyPatches';
import { SYSTEM_LIBRARIES } from '../generation/libraries';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { daemonName } from '../services/pidfile';
import {
  buildEntry,
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  formatDpkgStatus,
} from './dpkgStatus';
import {
  FIRMWARE_PACKAGE,
  startingFirmwareVersionOf,
  startingVersionOf,
  type FirmwareVendor,
} from './packageVersions';
import type { Directory } from '../filesystem/types';

/** Where a box keeps the daemons it can run. */
const SBIN_SEGMENTS = ['usr', 'sbin'] as const;

const binaryNamesAt = (fs: Directory, segments: readonly string[]): ReadonlySet<string> => {
  const found = segments.reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, fs);
  return new Set(found === undefined ? [] : found.entries.keys());
};

/** The packages a box has installed, in the order the manifest records them:
 *  services first (what a scan can see), then the libraries every box carries,
 *  then firmware where there is a device to have any. */
const installedPackages = (
  fs: Directory,
  firmwareVendor: FirmwareVendor | undefined,
): readonly (readonly [string, string])[] => {
  const daemons = binaryNamesAt(fs, SBIN_SEGMENTS);
  const services = Object.values(SERVICE_CATALOG)
    .filter((spec) => daemons.has(daemonName(spec)))
    .map((spec) => spec.package);
  const versioned = [...new Set([...services, ...SYSTEM_LIBRARIES])].flatMap((pkg) => {
    const version = startingVersionOf(pkg);
    return version === undefined ? [] : [[pkg, version] as const];
  });
  return firmwareVendor === undefined
    ? versioned
    : [...versioned, [FIRMWARE_PACKAGE, startingFirmwareVersionOf(firmwareVendor)] as const];
};

/**
 * The box's tree with its package manifest stamped on. Pure — the input tree is
 * never mutated.
 *
 * `firmwareVendor` is supplied only by the router-class generators; a workstation
 * or an NPC host has no firmware to name, and a `firmware` entry on one would
 * advertise an upgrade target that does not exist.
 */
export const withPackageManifest = (
  fs: Directory,
  options: { readonly firmwareVendor?: FirmwareVendor } = {},
): Directory =>
  applyPatches(fs, [
    {
      path: DPKG_STATUS_PATH,
      content: formatDpkgStatus(
        installedPackages(fs, options.firmwareVendor).map(([pkg, version]) =>
          buildEntry(pkg, version),
        ),
      ),
      owner: DPKG_STATUS_OWNER,
      permissions: DPKG_STATUS_PERMISSIONS,
    },
  ]);
