/**
 * `/var/lib/snmp/snmpd.conf` — the community that buys port control, and the only
 * secret this door has.
 *
 * A separate file from the world-readable `/etc/snmp/snmpd.conf` beside it, at separate
 * permissions, holding a separate string. That split is the door's whole economy: the
 * read-only community is public knowledge and says what a device IS, while this one
 * says what a device DOES and has to be earned. Kept in one file, either the public
 * half would become a secret the protocol says it is not, or the secret half would be
 * readable by anyone standing on the box.
 *
 * ROOT-ONLY, and for the reason `/var/lib/mysql/data.json` is: it holds what a sweep of
 * this door must work for. Every tier a walk hands out is below root, so a rung that
 * could read this would be handed the answer key to the door it just opened — and the
 * community would stop being a second, independent way into a device and become a
 * slower name for owning it already.
 *
 * HASHED, never in the clear, exactly as an account's password is. A community a player
 * could read once they held root would make this door a reward for a crack they had
 * already finished, rather than a door somebody else's wordlist has to open.
 *
 * `/var/lib/snmp` is net-snmp's real persistent-state directory, so the location is the
 * tool's own rather than one invented here.
 */

import type { Directory, FilePermissions } from '../filesystem/types';
import { asAbsPath, type AbsPath } from '../types';

/** One name for the path, so the reader below and every writer of this file agree on
 *  where it is. Shares a FILENAME with the world-readable config and nothing else —
 *  the directory is the whole difference, which is why naming both is worth doing. */
export const SNMPD_STATE_PATH: AbsPath = asAbsPath('/var/lib/snmp/snmpd.conf');

/** Root reads it, root writes it, nobody else does either. Not an executable: it is
 *  state. */
export const SNMPD_STATE_PERMISSIONS: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: [],
};

/** The directive real net-snmp writes into its persistent state. Anchored at BOTH ends
 *  for the reason the read-only parser is: a trailing source restriction is a real
 *  net-snmp form this world does not model, and reading the community while dropping
 *  the restriction would leave a device answering everyone while its own file says
 *  otherwise. */
const RW_COMMUNITY_RE = /^rwcommunity\s+(\S+)$/;

/** What a device carrying the agent ships with — the header says what the file is for,
 *  and the one directive carries the hash. The header matters more here than in the
 *  world-readable conf: root CAN edit this, and a file whose only line is a bare hash
 *  invites its owner to replace it with a string they can remember. */
export const formatSnmpdState = (communityHash: string): string =>
  [
    '# /var/lib/snmp/snmpd.conf — SNMP agent persistent state',
    '# The read-write community, hashed. The read-only one is public and lives in',
    '# /etc/snmp/snmpd.conf; this string is what a walk needs to see the port table.',
    `rwcommunity ${communityHash}`,
    '',
  ].join('\n');

/** The device's `/var/lib/snmp/snmpd.conf` content, or `''` when absent — a missing
 *  `/var`, no `lib`, no `snmp` directory, or no file. Walks the tree the way the port
 *  and NAT readers do; this layer has no path resolver. */
export const readSnmpdState = (hostFs: Directory): string => {
  const varDir = hostFs.entries.get('var');
  if (varDir?.kind !== 'directory') return '';
  const lib = varDir.entries.get('lib');
  if (lib?.kind !== 'directory') return '';
  const snmp = lib.entries.get('snmp');
  if (snmp?.kind !== 'directory') return '';
  const state = snmp.entries.get('snmpd.conf');
  return state?.kind === 'file' ? state.content : '';
};

/** The hash of the community this device answers a read-write walk to, or `undefined`
 *  when its state file names none.
 *
 *  `undefined` is a real state and not an error: root can edit this file, so a device
 *  whose owner blanked it answers no read-write community at all. The sweep reports
 *  that as a lock that was never shut rather than as one that held, which is the
 *  distinction `secretOn` exists to carry. */
export const readRwCommunityHash = (hostFs: Directory): string | undefined => {
  const matched = readSnmpdState(hostFs)
    .split('\n')
    .map((line) => RW_COMMUNITY_RE.exec(line.trim())?.[1])
    .find((value) => value !== undefined);
  return matched;
};
