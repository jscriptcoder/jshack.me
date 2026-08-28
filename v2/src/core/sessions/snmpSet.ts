/**
 * handleSnmpSet — the write half of the door, and the only place in the game where a
 * player changes what a machine DOES without ever standing on it.
 *
 * NO SESSION ROW, and the community is re-read and re-judged on every set. A row minted
 * here would hand `listPatches` and `upsertPatch` to whoever reached port 161 — at the
 * tier that rewrites a NAT table — because `authorizeMachineAccess` never inspects
 * session kind. Re-judging per call is also what makes `systemctl stop snmpd` a real
 * defence: there is no session to invalidate, so the next set simply finds nothing.
 *
 * THREE ANSWERS, and the split between them is the design. A device that is not there,
 * one whose agent was stopped, and one that refused the community are all silence — a
 * real agent drops a bad community without a word, and telling them apart would hand a
 * scanner a free map of which devices are worth a wordlist before it spent one. Once
 * the community is ACCEPTED, though, the caller is talking to the agent, and every
 * refusal from there on says what was wrong: they have already proved the string, and
 * on the one door whose whole promise is the write, silence would leave them unable to
 * tell a bad value from a working one without walking the device again.
 *
 * The FILE is the table. Nothing here keeps a second copy of a forward: the device's
 * own `rules.v4` or `acl.conf` is read, one line is changed in it, and the result is
 * stored back — so the scan path and the ssh router see the change because there is
 * only ever one thing to see.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost';
import {
  agentStamp,
  appendSnmpdLog,
  communityTier,
  contactLines,
  deviceKind,
  type SnmpTraceDeps,
} from './snmpAgent';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatSnmpdSetLine } from '../logging/snmpdLog';
import {
  parseForwardRules,
  readRulesV4,
  withForward,
  RULES_V4_OWNER,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../network/iptablesRules';
import {
  parseAclDenies,
  readAclConf,
  withDeny,
  ACL_CONF_OWNER,
  ACL_CONF_PATH,
  ACL_CONF_PERMISSIONS,
} from '../network/switchAcl';
import { describeSet, parseSnmpSet, type SnmpSetRefusal, type SnmpSetTarget } from '../snmp/set';
import type { SnmpDeviceKind } from '../snmp/walk';
import type { Directory } from '../filesystem/types';
import type { NonceStore } from '../signedRequest/nonceStore';

export type SnmpSetDeps = ServiceHostLookup &
  SnmpTraceDeps & {
    readonly nonceStore: NonceStore;
  };

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key. The ASSIGNMENT travels as the player typed it — the
// server owns the grammar, because a client that parsed it would be a second authority
// on what a rule is and a client that could be told what to send.
const snmpSetSchema = z
  .looseObject({
    action: z.literal('snmpSet'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    community: z.string().min(1),
    assignment: z.string().min(1),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Word-for-word what an absent device answers, so a refused community cannot be told
 *  from a box that is not there. */
const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };

const refused = (refusal: SnmpSetRefusal): HandlerResponse => ({
  status: 200,
  body: { ok: false, refusal },
});

/** Which MIB a target belongs to, for the refusal that says the device has no such
 *  thing. */
const mibOf = (target: SnmpSetTarget): string => (target.kind === 'nat' ? 'NAT-MIB' : 'ACL-MIB');

/** The kind of device a target's MIB belongs on. A router keeps a NAT table and a
 *  switch keeps an access list, so offering either the other's OID is naming something
 *  that is not on it. */
const kindFor = (target: SnmpSetTarget): SnmpDeviceKind =>
  target.kind === 'nat' ? 'router' : 'switch';

/** The /24 an address sits on. A router forwards INTO the segment behind it, so a
 *  destination anywhere else names a host this device has no route to — and the rule
 *  would sit in the file looking like it worked. Taken from the DEVICE's own address so
 *  it stays true for a gateway on a layer nobody has walked yet. */
const segmentOf = (ip: string): string => ip.split('.').slice(0, 3).join('.');

/** The state a port is in NOW, rendered the way the echo renders the state it will be
 *  in. One function for both ends of `old -> new`, so the two can never disagree about
 *  how a forward is spelled. */
const currentState = (hostFs: Directory, target: SnmpSetTarget): SnmpSetTarget =>
  target.kind === 'nat'
    ? {
        kind: 'nat',
        publicPort: target.publicPort,
        forward:
          parseForwardRules(readRulesV4(hostFs)).find(
            (forward) => forward.publicPort === target.publicPort,
          ) ?? null,
      }
    : { kind: 'acl', port: target.port, denied: parseAclDenies(readAclConf(hostFs)).includes(target.port) };

/** The file this target lives in, with the target's state written into it. */
const storedFile = (hostFs: Directory, target: SnmpSetTarget) =>
  target.kind === 'nat'
    ? {
        path: RULES_V4_PATH,
        owner: RULES_V4_OWNER,
        permissions: RULES_V4_PERMISSIONS,
        content: withForward(readRulesV4(hostFs), target.publicPort, target.forward),
      }
    : {
        path: ACL_CONF_PATH,
        owner: ACL_CONF_OWNER,
        permissions: ACL_CONF_PERMISSIONS,
        content: withDeny(readAclConf(hostFs), target.port, target.denied),
      };

export const handleSnmpSet = async (
  body: unknown,
  deps: SnmpSetDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, snmpSetSchema, { nonceStore: deps.nonceStore });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The same reach every other door uses, asked for THIS daemon. Nothing is logged on a
  // box that never answered.
  const reach = await reachServiceHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
    port: SERVICE_CATALOG.snmp.defaultPort,
    service: SERVICE_CATALOG.snmp.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, hostFs, machineId, sourceIp, writerKey } = reach.reached;

  const tier = communityTier(hostFs, payload.community);
  // The TARGET's key once the box has an owner, so a device keeps one file and one log
  // however many callers set on it.
  const target = { writerKey: writerKey ?? publicKey, machineId };
  const contact = contactLines({
    accepted: tier !== null,
    // The ROUTE decides the address whenever it can; on the caller's own LAN it knows
    // nothing and the claim stands.
    fromIp: sourceIp ?? payload.source_ip ?? 'unknown',
    ...agentStamp(deps, hostname),
  });

  if (tier === null) {
    await appendSnmpdLog(deps, target, contact);
    return UNREACHABLE;
  }

  const parsed = parseSnmpSet(payload.assignment);
  if (!parsed.ok) {
    await appendSnmpdLog(deps, target, contact);
    return refused(parsed.refusal);
  }

  const { oid, value } = describeSet(parsed.target);
  const answer = (refusal: Omit<SnmpSetRefusal, 'failedObject'>): HandlerResponse =>
    refused({ ...refusal, failedObject: oid });

  if (tier === 'read-only') {
    await appendSnmpdLog(deps, target, contact);
    // `public` is a community the device DOES answer, so silence here would read as the
    // device being down while a walk with the same string works. Naming the tier is
    // also the lesson: the other string is the one to go and crack.
    return answer({
      reason: 'notWritable',
      detail: `the community "${payload.community}" is read-only`,
    });
  }

  if (deviceKind(hostFs) !== kindFor(parsed.target)) {
    await appendSnmpdLog(deps, target, contact);
    return answer({
      reason: 'noSuchName',
      detail: `${mibOf(parsed.target)} is not implemented on this device`,
    });
  }

  if (
    parsed.target.kind === 'nat' &&
    parsed.target.forward !== null &&
    segmentOf(parsed.target.forward.internalIp) !== segmentOf(payload.target_ip)
  ) {
    await appendSnmpdLog(deps, target, contact);
    return answer({
      reason: 'wrongValue',
      detail: `${parsed.target.forward.internalIp} is not on this device's segment`,
    });
  }

  const previous = describeSet(currentState(hostFs, parsed.target)).value;
  const stored = storedFile(hostFs, parsed.target);
  const { error } = await deps.upsertPatch({
    writer_key: target.writerKey,
    machine_id: machineId,
    path: stored.path,
    content: stored.content,
    owner: stored.owner,
    permissions: stored.permissions,
    node_type: 'file',
  });

  // The trace goes down LAST and in one append, so the SET line is only ever claimed
  // for a write the journal actually took. A line naming a change that did not happen
  // would be worse than no line at all: it is the defender's only evidence.
  await appendSnmpdLog(deps, target, [
    ...contact,
    ...(error
      ? []
      : [
          formatSnmpdSetLine({
            oid,
            previous,
            current: value,
            fromIp: sourceIp ?? payload.source_ip ?? 'unknown',
            ...agentStamp(deps, hostname),
          }),
        ]),
  ]);

  if (error) return { status: 500, body: { error: 'port_table_write_failed' } };
  return { status: 200, body: { ok: true, oid, value } };
};
