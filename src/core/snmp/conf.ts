/**
 * `/etc/snmp/snmpd.conf` — what a device says about itself that nothing else knows.
 *
 * Two directives, and deliberately no more. A walk returns the device's name, platform
 * and addresses too, but every one of those is DERIVED from a fact the world already
 * holds: the hostname is the box's own, the platform follows from the port-authority
 * file it carries, and the addresses are the ones it was leased. Written in here as
 * well, each would become a second authority that the owner's own `nano` could put out
 * of step with the box it describes — the same trap the NAT table's single source
 * exists to avoid.
 *
 * WORLD-READABLE on purpose. The read-only community being `public` is the actual joke
 * of real SNMP: that string is not a secret and never was, so hiding it would model the
 * protocol wrongly to protect nothing. The community that IS a secret lives in a
 * root-only file and is never named here.
 *
 * Parsing is LENIENT, in the shape `rules.v4` established — comments, blank lines and
 * directives the game does not model are skipped rather than failing the whole file.
 * The owner can edit this with `nano`, so a config somebody broke has to degrade into a
 * device that answers less rather than into an error nobody can act on.
 */

import type { Directory } from '../filesystem/types';
import type { FilePermissions } from '../filesystem/types';
import { asAbsPath, type AbsPath } from '../types';

/** One name for the path, so the reader below and every writer of this file agree on
 *  where it is. net-snmp's own location, not one invented here. */
export const SNMPD_CONF_PATH: AbsPath = asAbsPath('/etc/snmp/snmpd.conf');

/** World-READABLE, root-only WRITE. Anyone on the box may read what the agent answers
 *  to, because the read-only community is public knowledge by design; changing what it
 *  answers to is an administrative act, so a visitor cannot quietly repoint the device
 *  at a string of their own. */
export const SNMPD_CONF_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** The `/etc/snmp/snmpd.conf` every device carrying the agent ships with — a documented
 *  header and the two directives the walk reads. `agentaddress` and the rest of a real
 *  net-snmp config are omitted: a line the game cannot act on is a line a player can
 *  edit to no effect, which teaches them the file does not matter. */
export const SNMPD_CONF_SEED = [
  '# /etc/snmp/snmpd.conf — SNMP agent configuration',
  '# The read-only community is public knowledge; the read-write one is not kept here.',
  'rocommunity public',
  'syscontact netops@corp.local',
  '',
].join('\n');

export type SnmpdConf = {
  /** The string the agent answers a read-only walk to, or `null` when the file names
   *  none — an agent nobody can query, which is what blanking this file does. */
  readonly roCommunity: string | null;
  /** Free text on a real agent, so kept whole rather than tokenised. Empty when the
   *  device states no contact, exactly as a real agent answers. */
  readonly sysContact: string;
};

/** The device's `/etc/snmp/snmpd.conf` content, or `''` when absent — a missing `/etc`,
 *  no `snmp` directory, or no file. Walks the tree the way the port and NAT readers do;
 *  this layer has no path resolver. */
export const readSnmpdConf = (hostFs: Directory): string => {
  const etc = hostFs.entries.get('etc');
  if (etc?.kind !== 'directory') return '';
  const snmp = etc.entries.get('snmp');
  if (snmp?.kind !== 'directory') return '';
  const conf = snmp.entries.get('snmpd.conf');
  return conf?.kind === 'file' ? conf.content : '';
};

/** Anchored at BOTH ends. Real net-snmp allows a source restriction after the community
 *  — `rocommunity public 10.0.0.0/8` — which this world does not model; reading the
 *  community and dropping the restriction would leave the device answering everyone
 *  while its config claims otherwise. Whole line or nothing, so the device falls silent
 *  and its owner has something visible to fix. */
const RO_COMMUNITY_RE = /^rocommunity\s+(\S+)$/;
const SYS_CONTACT_RE = /^syscontact\s+(.+)$/;

const directiveValue = (lines: readonly string[], pattern: RegExp): string | null => {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match !== null) return match[1]!;
  }
  return null;
};

export const parseSnmpdConf = (content: string): SnmpdConf => {
  // Trimmed but NOT filtered: both directives are anchored to the start of a line, so a
  // comment or a blank cannot match one. A second pass that dropped them would be a
  // defence with nothing left to defend, and every mutant of it would be unkillable.
  const lines = content.split('\n').map((line) => line.trim());

  return {
    roCommunity: directiveValue(lines, RO_COMMUNITY_RE),
    sysContact: directiveValue(lines, SYS_CONTACT_RE) ?? '',
  };
};
