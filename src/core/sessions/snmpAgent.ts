/**
 * What both SNMP doors do before either of them answers: judge the community, tell a
 * router from a switch, and leave the device's own record of the visit.
 *
 * It lives here rather than in each handler because the two doors have to AGREE. A read
 * that accepted a community the write refused would let a player see a port table they
 * cannot touch and never learn why; a device that read as a router to one door and a
 * switch to the other would render a NAT table and then refuse every NAT write. Both
 * are silent failures — the kind that show up as a player believing the game is broken.
 *
 * The reach itself is already shared, one layer down in `serviceHost`. This is the rest
 * of what "talking to an agent" means once the box has been found.
 */

import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { appendMachineLog } from '../patches/appendMachineLog';
import { derivePid } from '../logging/syslog';
import { readAclConf } from '../network/switchAcl';
import { readRwCommunityHash } from '../snmp/rwCommunity';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf';
import { md5 } from '../generation/md5';
import { asGameTime } from '../types';
import type { SnmpDeviceKind } from '../snmp/walk';
import type { Directory } from '../filesystem/types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';

/** What a community buys. The read-only one is public knowledge and names the device;
 *  the read-write one had to be cracked and controls what the device DOES. */
export type SnmpTier = 'read-only' | 'read-write';

/**
 * The tier a community is answered at, or `null` when the device answers it at none.
 *
 * The READ-WRITE community is tried first: it is the strictly greater grant, so a
 * device whose two communities were somehow the same string must answer at the tier
 * that string was earned at.
 *
 * Hashed here and never on the client, exactly as every account password on every other
 * door is. A client that compared hashes would be a client that could be told which
 * hash to compare.
 *
 * A device whose config names no community answers nobody — which is what an owner who
 * blanked their own file asked for, rather than a default nobody set. An ABSENT
 * read-write community needs no guard of its own: `md5` returns a string for every
 * input, so comparing one against `undefined` is already false.
 */
export const communityTier = (hostFs: Directory, community: string): SnmpTier | null => {
  if (md5(community) === readRwCommunityHash(hostFs)) return 'read-write';
  return parseSnmpdConf(readSnmpdConf(hostFs)).roCommunity === community ? 'read-only' : null;
};

/** Which platform the device speaks as. Read off the port-authority file it already
 *  carries — a switch keeps `/etc/switch/acl.conf` where a router keeps its NAT table —
 *  rather than off its hostname, which names no such thing, or off a second copy in the
 *  agent's own config, which the owner's `nano` could put out of step with the box.
 *
 *  A switch is the special case; anything else answers as the Linux box it is, which is
 *  also the right answer for a workstation that installs an agent of its own. */
export const deviceKind = (hostFs: Directory): SnmpDeviceKind =>
  readAclConf(hostFs) === '' ? 'router' : 'switch';

export type SnmpTraceDeps = {
  /** The server's wall clock, epoch-ms (UTC) — stamps the snmpd.log lines. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/snmpd.log`, so a visit appends to the device's
   *  history instead of replacing it. */
  readonly readSnmpdLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

/** A moment on the device's clock, in the shape every snmpd.log line is stamped from. */
export const agentStamp = (deps: SnmpTraceDeps, hostname: string) => {
  const stamp = deps.now();
  return { hostname, time: asGameTime(stamp), pid: derivePid(stamp) };
};

/**
 * Land already-formatted lines on the device's own `/var/log/snmpd.log`.
 *
 * ONE append however many lines, because they are one event to the box and separate
 * appends would be separate read-modify-writes racing over the same file.
 *
 * Best-effort, like every other door's trace: an answer that really happened must not
 * be undone by a write that did not.
 */
export const appendSnmpdLog = async (
  deps: SnmpTraceDeps,
  target: { readonly writerKey: string; readonly machineId: string },
  lines: readonly string[],
): Promise<void> => {
  const { sweepLog } = SERVICE_CATALOG.snmp;
  try {
    await appendMachineLog(
      { readLog: deps.readSnmpdLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
        path: sweepLog.path,
        owner: sweepLog.owner,
        permissions: sweepLog.permissions,
      },
      lines.join('\n'),
    );
  } catch {
    // best-effort: the answer stands regardless of a logging failure.
  }
};

/**
 * The two lines any contact with the agent leaves: that somebody reached it, and what
 * the community they named bought.
 *
 * Two rather than one because they carry different evidence — a run of arrivals with no
 * verdict behind them is somebody scanning, and an arrival followed by a refusal is
 * somebody guessing.
 *
 * No line names an account. A community belongs to the service, so the field the shared
 * attempt shape carries is meaningless at this door.
 */
export const contactLines = (contact: {
  readonly accepted: boolean;
  readonly fromIp: string;
  readonly hostname: string;
  readonly time: ReturnType<typeof asGameTime>;
  readonly pid: number;
}): readonly string[] => {
  const { sweepLog } = SERVICE_CATALOG.snmp;
  const record = {
    outcome: contact.accepted ? ('success' as const) : ('failure' as const),
    user: '',
    fromIp: contact.fromIp,
    hostname: contact.hostname,
    time: contact.time,
    pid: contact.pid,
  };
  return [sweepLog.formatArrival?.(record), sweepLog.formatAttempt(record)].filter(
    (line): line is string => line !== undefined,
  );
};
