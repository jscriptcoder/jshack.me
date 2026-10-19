/**
 * What both SNMP doors do before either of them answers: judge the community, tell a
 * router from a switch, judge a set, and leave the device's own record of the visit.
 *
 * Both VANTAGES use it too: the server for somebody else's device, and the client for
 * the player's own box, which the server's same-LAN vantage cannot reach.
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

import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { appendMachineLogLines } from '../patches/appendMachineLog.js';
import { derivePid } from '../logging/syslog.js';
import {
  parseAclDenies,
  readAclConf,
  withDeny,
  ACL_CONF_OWNER,
  ACL_CONF_PATH,
  ACL_CONF_PERMISSIONS,
} from '../network/switchAcl.js';
import {
  parseForwardRules,
  parseInputDenies,
  readRulesV4,
  withForward,
  withInputDeny,
  RULES_V4_OWNER,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../network/iptablesRules.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { displayVersion, isFirmwarePackage } from '../packages/packageVersions.js';
import { readRwCommunityHash } from '../snmp/rwCommunity.js';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf.js';
import { describeSet, parseSnmpSet, type SnmpSetRefusal, type SnmpSetTarget } from '../snmp/set.js';
import { md5 } from '../generation/md5.js';
import { asGameTime, type AbsPath } from '../types.js';
import type { SnmpDeviceKind, SnmpPortTable } from '../snmp/walk.js';
import type { Directory, FilePermissions } from '../filesystem/types.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';

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

/** What the device calls itself in `sysDescr`: the display form of the firmware its own
 *  manifest names, so a MikroTik switch says MikroTik and a switch running someone else's
 *  image no longer claims to be a Cisco. A box carrying no firmware row — a workstation
 *  that installed an agent of its own — answers `Linux`, the plain machine it is; every
 *  generator-built router-class box carries firmware, so that fallback reaches only it. */
export const platformOf = (hostFs: Directory): string => {
  const versions = parseDpkgVersions(readDpkgStatus(hostFs));
  const firmware = [...versions].find(([key]) => isFirmwarePackage(key));
  return firmware === undefined ? 'Linux' : displayVersion(firmware[0], firmware[1]);
};

/** Every table the device's files hold, read from the files it actually routes by. A
 *  switch keeps ONE — its access list. Anything else keeps `rules.v4`, which carries two
 *  chains: what it forwards INTO a segment behind it, and what it refuses ON itself.
 *
 *  Both of those are reported whichever box this is, because nothing a walk can read
 *  tells a filtering workstation from a forwarding gateway — they carry the same file
 *  and neither carries the switch's. A device with no segment behind it simply has no
 *  forwards to show, and one that has never filtered anything shows no denies.
 *
 *  Rendered from the files on EVERY walk, never cached and never copied: the whole point
 *  of the door is one fact behind two interfaces, and a second copy could tell a player
 *  a port was forwarded that the box does not honour. */
export const portTablesOf = (hostFs: Directory, kind: SnmpDeviceKind): readonly SnmpPortTable[] => {
  if (kind === 'switch') return [{ kind: 'acl', denies: parseAclDenies(readAclConf(hostFs)) }];

  const rules = readRulesV4(hostFs);
  return [
    { kind: 'nat', forwards: parseForwardRules(rules) },
    { kind: 'filter', denies: parseInputDenies(rules) },
  ];
};

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
    await appendMachineLogLines(
      { readLog: deps.readSnmpdLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
        path: sweepLog.path,
        owner: sweepLog.owner,
        permissions: sweepLog.permissions,
      },
      lines,
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

/** What a target is CALLED, for the refusal that says the device has no such thing.
 *  The object's own name rather than the MIB module it used to sit under: a walk prints
 *  no module and a set takes none, so naming one here would point a player at a word
 *  they can find nowhere else. */
const OBJECT_OF: Readonly<Record<SnmpSetTarget['kind'], string>> = {
  nat: 'forward',
  acl: 'aclPort',
  filter: 'inputPort',
};

/** The kind of device a target's object belongs on. A switch keeps an access list and
 *  keeps no `rules.v4` at all; every other box keeps that file and both of its chains.
 *  So the access list is the special case here exactly as it is for the walk, and
 *  offering a device the other's OID is naming something that is not on it. */
const kindFor = (target: SnmpSetTarget): SnmpDeviceKind =>
  target.kind === 'acl' ? 'switch' : 'router';

/** The /24 an address sits on. A router forwards INTO the segment behind it, so a
 *  destination anywhere else names a host this device has no route to — and the rule
 *  would sit in the file looking like it worked. Taken from the DEVICE's own address so
 *  it stays true for a gateway on a layer nobody has walked yet. */
const segmentOf = (ip: string): string => ip.split('.').slice(0, 3).join('.');

/** Why a forward may not point where it was aimed, or `null` when it may.
 *
 *  TWO refusals, because they are two different facts about the device. A box that
 *  fronts no network — a workstation, or an occupant's box behind somebody's NAT —
 *  cannot hold a routable forward at all, whatever address it names; a box that DOES
 *  front one was simply handed an address outside it. Telling the first that a
 *  destination "is not on this device's segment" describes a segment the device does not
 *  have, and reads as a near miss when nothing about the write could have worked. */
const forwardRefusal = (destination: string, fronted: string | null): string | null => {
  if (fronted === null) return 'this device fronts no network';
  return segmentOf(destination) === fronted
    ? null
    : `${destination} is not on this device's segment`;
};

/** The state a port is in NOW, rendered the way the echo renders the state it will be
 *  in. One function for both ends of `old -> new`, so the two can never disagree about
 *  how a forward is spelled. */
const currentState = (hostFs: Directory, target: SnmpSetTarget): SnmpSetTarget => {
  if (target.kind === 'nat') {
    return {
      kind: 'nat',
      publicPort: target.publicPort,
      forward:
        parseForwardRules(readRulesV4(hostFs)).find(
          (forward) => forward.publicPort === target.publicPort,
        ) ?? null,
    };
  }

  // Each read from the chain that HOLDS this fact. A filter read out of the access
  // list — or out of the forwards sharing its own file — would report every port open
  // and log every close as though it had changed nothing.
  return target.kind === 'acl'
    ? { kind: 'acl', port: target.port, denied: parseAclDenies(readAclConf(hostFs)).includes(target.port) }
    : {
        kind: 'filter',
        port: target.port,
        denied: parseInputDenies(readRulesV4(hostFs)).includes(target.port),
      };
};

/** A port-table file as it is to be stored, whole. */
export type SnmpStoredFile = {
  readonly path: AbsPath;
  readonly owner: string;
  readonly permissions: FilePermissions;
  readonly content: string;
};

/** The file this target lives in, with the target's state written into it. */
const storedFile = (hostFs: Directory, target: SnmpSetTarget): SnmpStoredFile => {
  const rulesV4 = {
    path: RULES_V4_PATH,
    owner: RULES_V4_OWNER,
    permissions: RULES_V4_PERMISSIONS,
  };

  if (target.kind === 'nat') {
    return {
      ...rulesV4,
      content: withForward(readRulesV4(hostFs), target.publicPort, target.forward),
    };
  }

  // Two writers over one file, each blind to the other's lines, so a deny cannot eat a
  // forward its owner opened and a forward cannot lift a deny they set.
  return target.kind === 'acl'
    ? {
        path: ACL_CONF_PATH,
        owner: ACL_CONF_OWNER,
        permissions: ACL_CONF_PERMISSIONS,
        content: withDeny(readAclConf(hostFs), target.port, target.denied),
      }
    : { ...rulesV4, content: withInputDeny(readRulesV4(hostFs), target.port, target.denied) };
};

/** What the agent makes of one set, before anything is written.
 *
 *  `silent` is a community it answers at no tier: no frame, and nothing for the caller
 *  to tell apart from a device that is not there. `refused` is a community it DID
 *  accept, so the frame names the constraint. `write` is the file to store and the
 *  two ends of the change it makes. */
export type SnmpSetJudgement =
  | { readonly kind: 'silent' }
  | { readonly kind: 'refused'; readonly refusal: SnmpSetRefusal }
  | {
      readonly kind: 'write';
      readonly oid: string;
      readonly value: string;
      readonly previous: string;
      readonly file: SnmpStoredFile;
    };

/**
 * Judge one set against a device's files — community, grammar, device kind and the
 * segment a forward may point into, in that order.
 *
 * Pure, so every vantage that answers a set answers it the same way: the server for
 * somebody else's device, and the client for the player's own box. `frontedSegment` is
 * the one fact the files cannot give, because only the route knows what the device
 * stands in front of.
 */
export const judgeSnmpSet = (
  hostFs: Directory,
  request: {
    readonly community: string;
    readonly assignment: string;
    readonly frontedSegment: string | null;
  },
): SnmpSetJudgement => {
  const tier = communityTier(hostFs, request.community);
  if (tier === null) return { kind: 'silent' };

  const parsed = parseSnmpSet(request.assignment);
  if (!parsed.ok) return { kind: 'refused', refusal: parsed.refusal };

  const { oid, value } = describeSet(parsed.target);
  const refused = (refusal: Omit<SnmpSetRefusal, 'failedObject'>): SnmpSetJudgement => ({
    kind: 'refused',
    refusal: { ...refusal, failedObject: oid },
  });

  // `public` is a community the device DOES answer, so silence here would read as the
  // device being down while a walk with the same string works. Naming the tier is also
  // the lesson: the other string is the one to go and crack.
  if (tier === 'read-only') {
    return refused({
      reason: 'notWritable',
      detail: `the community "${request.community}" is read-only`,
    });
  }

  if (deviceKind(hostFs) !== kindFor(parsed.target)) {
    return refused({
      reason: 'noSuchName',
      detail: `${OBJECT_OF[parsed.target.kind]} is not implemented on this device`,
    });
  }

  if (parsed.target.kind === 'nat' && parsed.target.forward !== null) {
    const detail = forwardRefusal(parsed.target.forward.internalIp, request.frontedSegment);
    if (detail !== null) return refused({ reason: 'wrongValue', detail });
  }

  return {
    kind: 'write',
    oid,
    value,
    previous: describeSet(currentState(hostFs, parsed.target)).value,
    file: storedFile(hostFs, parsed.target),
  };
};
