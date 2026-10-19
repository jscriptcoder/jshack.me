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
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from './callerVantage.js';
import {
  agentStamp,
  appendSnmpdLog,
  contactLines,
  judgeSnmpSet,
  type SnmpTraceDeps,
} from './snmpAgent.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { formatSnmpdSetLine } from '../logging/snmpdLog.js';
import type { SnmpSetRefusal } from '../snmp/set.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type SnmpSetDeps = ServiceHostLookup &
  CallerVantageDeps &
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
    // The port a forwarded device is NAMED by, exactly as the walk takes it. Absent is
    // the agent's own 161; present, the box behind that forward is what gets written.
    port: z.number().int().min(1).max(65535).optional(),
    community: z.string().min(1),
    assignment: z.string().min(1),
    // The box the shell stands on; absent means the caller's own workstation. The
    // source address is the vantage's, so `source_ip` is accepted but never read.
    caller_machine_id: z.string().min(1).optional(),
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

export const handleSnmpSet = async (
  body: unknown,
  deps: SnmpSetDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, snmpSetSchema, { nonceStore: deps.nonceStore });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Where the caller stands, derived from the box they name — never a claim. A write
  // naming a network the caller is not on is refused before any device is reached.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // The same reach every other door uses, asked for THIS daemon. Nothing is logged on a
  // box that never answered.
  const reach = await reachServiceHost(deps, {
    essid: vantage.essid,
    targetIp: payload.target_ip,
    callerMachineId: payload.caller_machine_id,
    ownLanSourceIp: vantage.sourceIp,
    port: payload.port ?? SERVICE_CATALOG.snmp.defaultPort,
    service: SERVICE_CATALOG.snmp.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, hostFs, machineId, sourceIp, writerKey, frontedSegment } = reach.reached;

  const judgement = judgeSnmpSet(hostFs, {
    community: payload.community,
    assignment: payload.assignment,
    // The segment the DEVICE fronts, resolved by the vantage that found it and never
    // derived here. Through a forward the typed address is the gateway the caller came
    // in through; addressed directly, an inner gateway forwards into the layer BEHIND
    // it rather than the LAN it stands on; and across the world the ESSID on the
    // request names the ATTACKER's own network, so a bound taken from it refuses every
    // address inside the LAN under attack and accepts only ones that resolve to nothing.
    frontedSegment,
  });
  // The TARGET's key once the box has an owner, so a device keeps one file and one log
  // however many callers set on it.
  const target = { writerKey, machineId };
  const contact = contactLines({
    accepted: judgement.kind !== 'silent',
    // The ROUTE decides the address whenever it can; on the caller's own LAN it knows
    // nothing and the claim stands.
    fromIp: sourceIp ?? 'unknown',
    ...agentStamp(deps, hostname),
  });

  if (judgement.kind !== 'write') {
    await appendSnmpdLog(deps, target, contact);
    return judgement.kind === 'silent' ? UNREACHABLE : refused(judgement.refusal);
  }

  const { oid, value, previous, file } = judgement;
  const { error } = await deps.upsertPatch({
    writer_key: target.writerKey,
    machine_id: machineId,
    path: file.path,
    content: file.content,
    owner: file.owner,
    permissions: file.permissions,
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
            fromIp: sourceIp ?? 'unknown',
            ...agentStamp(deps, hostname),
          }),
        ]),
  ]);

  if (error) return { status: 500, body: { error: 'port_table_write_failed' } };
  return { status: 200, body: { ok: true, oid, value } };
};
