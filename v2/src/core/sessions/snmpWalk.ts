/**
 * handleSnmpWalk — the server-side answer to "what is this device?".
 *
 * The read-only tier, and the whole of what the public community buys: a name, a
 * platform, a contact, and the addresses the box actually holds. Not one port it
 * forwards. That split is the door's economy — the port table costs a community string
 * somebody has to crack, and this tier exists to tell a player there is something here
 * worth cracking it for.
 *
 * NOTHING is asked of the caller but the community. There is no account at this door
 * and no session row at any tier: a row minted for a caller who proved nothing would
 * hand `listPatches` and `upsertPatch` to anyone who can reach port 161.
 *
 * A REFUSED community is answered exactly as an absent device is. Real net-snmp drops a
 * bad community without a word, and an answer that told the two apart would hand a
 * scanner a free map of which devices hold a community worth a wordlist — spendable
 * before a single word of one. The server still knows the difference, because the log
 * it writes has to.
 *
 * Both outcomes are TRACED on the target, and on this door the trace matters more than
 * on any other: a walk costs no login and leaves no session, so these lines are the only
 * evidence a device's owner will ever have that somebody looked.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { derivePid } from '../logging/syslog';
import { appendMachineLog } from '../patches/appendMachineLog';
import { computeApGatewayId } from '../identity/router';
import { parseAclDenies, readAclConf } from '../network/switchAcl';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules';
import { readRwCommunityHash } from '../snmp/rwCommunity';
import { md5 } from '../generation/md5';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf';
import { asGameTime } from '../types';
import type { SnmpDeviceKind, SnmpIdentity, SnmpPortTable } from '../snmp/walk';
import type { Directory } from '../filesystem/types';
import type { FindPublicIpByEssid } from '../logging/crossPlayerSourceIp';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type SnmpWalkDeps = ServiceHostLookup & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the snmpd.log lines. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/snmpd.log`, so a walk appends to the device's
   *  history instead of replacing it. */
  readonly readSnmpdLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The address the access point wears on the outside. Only a device that FRONTS the
   *  world has one to show. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
};

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key (the server stamps it from the verified signature). The
// community is the only thing the caller sends, and it names no account: a community
// string belongs to the service, not to a person.
const snmpWalkSchema = z
  .looseObject({
    action: z.literal('snmpWalk'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    community: z.string().min(1),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Word-for-word what an absent device answers, so a refused community cannot be told
 *  from a box that is not there. Built here rather than imported because the point is
 *  that this door emits the reach's own refusal, not a second one that resembles it. */
const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };

/** Which platform the device speaks as. Read off the port-authority file it already
 *  carries — a switch keeps `/etc/switch/acl.conf` where a router keeps its NAT table —
 *  rather than off its hostname, which names no such thing, or off a second copy in the
 *  agent's own config, which the owner's `nano` could put out of step with the box.
 *
 *  A switch is the special case; anything else answers as the Linux box it is, which is
 *  also the right answer for a workstation that installs an agent of its own. */
const deviceKind = (hostFs: Directory): SnmpDeviceKind =>
  readAclConf(hostFs) === '' ? 'router' : 'switch';

/** The device's port table, read from the file it actually routes by. A router's NAT
 *  chain and a switch's access list are two different facts, so the kind decides which
 *  file is consulted — the same kind the identity block reports, resolved once.
 *
 *  Rendered from the file on EVERY walk, never cached and never copied: the whole point
 *  of the door is one fact behind two interfaces, and a second copy could tell a player
 *  a port was forwarded that the box does not honour. */
const portTableOf = (hostFs: Directory, kind: SnmpDeviceKind): SnmpPortTable =>
  kind === 'switch'
    ? { kind: 'acl', denies: parseAclDenies(readAclConf(hostFs)) }
    : { kind: 'nat', forwards: parseForwardRules(readRulesV4(hostFs)) };

/** Every address the device holds, in interface order: its own, then the one the access
 *  point wears outside when this IS the access point's gateway. Nothing behind that
 *  gateway has an outside face, and a second interface there would be an address that
 *  answers nothing. */
const addressesOf = async (
  deps: SnmpWalkDeps,
  device: { readonly essid: string; readonly machineId: string; readonly localIp: string },
): Promise<readonly string[]> => {
  if (device.machineId !== computeApGatewayId(device.essid)) return [device.localIp];
  const { data } = await deps.findPublicIpByEssid(device.essid);
  return data === null ? [device.localIp] : [device.localIp, data.public_ip];
};

/** Land the arrival and the verdict on the target's own snmpd.log. Best-effort, like
 *  every other door's trace: an answer that really happened must not be undone by a
 *  write that did not.
 *
 *  BOTH lines in one append. They are one event to the box, and two appends would be
 *  two read-modify-writes racing over the same file. Two lines rather than one because
 *  they carry different evidence: a run of arrivals with no verdict behind them is
 *  somebody scanning, and an arrival followed by a refusal is somebody guessing. */
const recordWalk = async (
  deps: SnmpWalkDeps,
  walk: {
    readonly writerKey: string;
    readonly machineId: string;
    readonly hostname: string;
    readonly fromIp: string;
    readonly accepted: boolean;
  },
): Promise<void> => {
  const stamp = deps.now();
  const { sweepLog } = SERVICE_CATALOG.snmp;
  const record = {
    outcome: walk.accepted ? ('success' as const) : ('failure' as const),
    // A community belongs to the service, so no line here names an account. The field
    // is carried by the shared attempt shape and is meaningless at this door.
    user: '',
    fromIp: walk.fromIp,
    hostname: walk.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  };
  const line = [sweepLog.formatArrival?.(record), sweepLog.formatAttempt(record)]
    .filter((entry) => entry !== undefined)
    .join('\n');

  try {
    await appendMachineLog(
      { readLog: deps.readSnmpdLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: walk.writerKey,
        machineId: walk.machineId,
        path: sweepLog.path,
        owner: sweepLog.owner,
        permissions: sweepLog.permissions,
      },
      line,
    );
  } catch {
    // best-effort: the walk's outcome stands regardless of a logging failure.
  }
};

export const handleSnmpWalk = async (
  body: unknown,
  deps: SnmpWalkDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, snmpWalkSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The same reach every other door uses, asked for THIS daemon: a device whose agent
  // was stopped is simply not there, which is what makes `systemctl stop snmpd` a real
  // defence rather than a cosmetic one. Nothing is logged on a box that never answered.
  const reach = await reachServiceHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
    port: SERVICE_CATALOG.snmp.defaultPort,
    service: SERVICE_CATALOG.snmp.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, hostFs, machineId, sourceIp, writerKey } = reach.reached;

  const conf = parseSnmpdConf(readSnmpdConf(hostFs));
  const rwCommunityHash = readRwCommunityHash(hostFs);
  // Two locks on one door, and the READ-WRITE one is tried first: it is the strictly
  // greater grant, so a device whose two communities were somehow the same string must
  // answer with the tier that string was earned at.
  //
  // Hashed here and never on the client, exactly as every account password on every
  // other door is. A client that compared hashes would be a client that could be told
  // which hash to compare.
  //
  // A device whose config names no community answers nobody — which is exactly what an
  // owner who blanked their own file asked for, rather than a default nobody set. The
  // same holds for a read-write community that is absent: `undefined` never matches, so
  // a deleted state file closes the tier rather than opening it to everyone.
  const tier =
    rwCommunityHash !== undefined && md5(payload.community) === rwCommunityHash
      ? ('read-write' as const)
      : conf.roCommunity === payload.community
        ? ('read-only' as const)
        : null;
  const accepted = tier !== null;

  await recordWalk(deps, {
    // The TARGET's key once the box has an owner, so every visitor's lines accrete into
    // one row on the defender's box rather than a row each, where the newest would erase
    // the rest on replay.
    writerKey: writerKey ?? publicKey,
    machineId,
    hostname,
    // The ROUTE decides the address whenever it can; on the caller's own LAN it knows
    // nothing and the claim stands.
    fromIp: sourceIp ?? payload.source_ip ?? 'unknown',
    accepted,
  });

  if (tier === null) return UNREACHABLE;

  const kind = deviceKind(hostFs);
  const identity: SnmpIdentity = {
    hostname,
    kind,
    sysContact: conf.sysContact,
    addresses: await addressesOf(deps, {
      essid: payload.essid,
      machineId,
      localIp: payload.target_ip,
    }),
  };
  // The tier is STATED rather than left to be inferred from whether a table came back.
  // Default-deny means a fresh router forwards nothing, so an empty table is the
  // ordinary read-write answer; a client that read "no table" as "read-only" would tell
  // most players their cracked community had been refused.
  return tier === 'read-only'
    ? { status: 200, body: { ok: true, tier, identity } }
    : { status: 200, body: { ok: true, tier, identity, portTable: portTableOf(hostFs, kind) } };
};
