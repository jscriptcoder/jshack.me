/**
 * The SNMP door from your own chair — the whole walk and the whole set, client side.
 *
 * Every other target goes through the server, because a client asking about somebody
 * else's device must not be trusted to answer its own question. Your own box has nothing
 * to protect from you: you are root on it, the agent's config is a file you can open, and
 * the read-write community is the one the install printed for you.
 *
 * It is also the only place either can be answered at all. The server's same-LAN
 * vantage excludes the caller on purpose, so a walk or a set on your own address that
 * went out found nothing standing there and timed out — while a stranger's of the same
 * agent answered.
 *
 * What differs from a visitor's path is WHERE the decision runs, never what it decides.
 * The community judgement, the device's kind, platform and port tables, the set's
 * grammar and refusals, and the lines a visit leaves come from the same readers and
 * formatters the server's two handlers use, so a rule that changes changes for both
 * vantages at once.
 *
 * The filter is not consulted. A denied port is closed to the NETWORK, and the box's own
 * addresses never cross it, which is the promise the seeded `rules.v4` makes its owner.
 *
 * Read off the machine as it stands RIGHT NOW rather than off the tree this client is
 * holding: a visitor walking this agent appends to its `snmpd.log` under this owner's key,
 * and composing from a stale copy would erase their visit from the defender's own record
 * — or, on a set, revert a rule the owner changed in another tab.
 */

import { readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { derivePid } from '../logging/syslog.js';
import { formatSnmpdSetLine } from '../logging/snmpdLog.js';
import {
  communityTier,
  contactLines,
  deviceKind,
  judgeSnmpSet,
  platformOf,
  portTablesOf,
} from '../sessions/snmpAgent.js';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf.js';
import { asGameTime } from '../types.js';
import type { CommandEnv, FsView, SnmpSetResult, SnmpWalkResult } from './types.js';
import type { Directory } from '../filesystem/types.js';
import type { Ipv4 } from '../network/interfaces.js';

/**
 * Append the visit's lines to the box's own `/var/log/snmpd.log` in ONE write, as the
 * server's appender does: they are one event to the box.
 *
 * A read that FAILED writes nothing, because replacing a box's history with two lines is
 * a worse outcome than dropping them. An absent file is not that failure — it is a box
 * whose agent has had nothing to say yet, and the first visit creates it.
 */
const appendOwnLog = async (
  env: CommandEnv,
  view: FsView,
  lines: readonly string[],
): Promise<void> => {
  const { sweepLog } = SERVICE_CATALOG.snmp;
  const existing = view.read(sweepLog.path);
  if (!existing.ok && existing.error !== 'not_found') return;

  const current = existing.ok ? existing.content : '';
  await env.patches.write(sweepLog.path, `${current}${lines.map((line) => `${line}\n`).join('')}`, {
    owner: sweepLog.owner,
    permissions: sweepLog.permissions,
    ...(existing.ok ? {} : { isNew: true }),
  });
};

/** Whether the agent holds `port` (its own 161 when none was named), as its pidfile
 *  says — the same source `nmap` reads, so `systemctl stop snmpd` shuts this door too. */
const agentListening = (fs: Directory, port: number | undefined): boolean => {
  const wanted = port ?? SERVICE_CATALOG.snmp.defaultPort;
  return readOpenPorts(fs).some(
    (open) => open.port === wanted && open.service === SERVICE_CATALOG.snmp.service,
  );
};

/** A moment on the box's own clock, in the shape every snmpd.log line is stamped from. */
const ownStamp = (env: CommandEnv) => {
  const stamp = env.now();
  return { hostname: env.hostname, time: asGameTime(stamp), pid: derivePid(stamp) };
};

/**
 * Walk the agent on your own box — the local half of `env.snmp.walk`, answering in the
 * same shape so the command renders one block and one silence.
 *
 * `fromIp` is the address the box was reached BY — loopback or its own LAN address — and
 * is what its log names. `ownIp` is the address the box holds, which is the one interface
 * a walk shows: a workstation fronts nothing, so it has no outside face.
 */
export const walkOwnAgent = async (
  env: CommandEnv,
  params: {
    readonly fromIp: string;
    readonly ownIp: Ipv4;
    readonly port: number | undefined;
    readonly community: string;
  },
): Promise<SnmpWalkResult> => {
  const view = await env.fs.reload();
  const fs = view.root();
  // An agent that is not running is not there, and leaves nothing behind.
  if (!agentListening(fs, params.port)) return { ok: false };

  const tier = communityTier(fs, params.community);
  await appendOwnLog(
    env,
    view,
    contactLines({ accepted: tier !== null, fromIp: params.fromIp, ...ownStamp(env) }),
  );
  if (tier === null) return { ok: false };

  const kind = deviceKind(fs);
  const identity = {
    hostname: env.hostname,
    kind,
    platform: platformOf(fs),
    sysContact: parseSnmpdConf(readSnmpdConf(fs)).sysContact,
    addresses: [params.ownIp],
  };
  return tier === 'read-only'
    ? { ok: true, tier, identity }
    : { ok: true, tier, identity, portTables: portTablesOf(fs, kind) };
};

/**
 * Set one OID on the agent on your own box — the local half of `env.snmp.set`, judged by
 * the same `judgeSnmpSet` the server answers a stranger with.
 *
 * A workstation fronts no network, so a forward is refused here exactly as it is when
 * somebody else aims one at this box.
 *
 * The file is stored FIRST and the log after, so the SET line is only claimed for a
 * write that landed. One that did not answers as silence, which is what the server's
 * failed write reaches the player as.
 */
export const setOwnAgent = async (
  env: CommandEnv,
  params: {
    readonly fromIp: string;
    readonly port: number | undefined;
    readonly community: string;
    readonly assignment: string;
  },
): Promise<SnmpSetResult> => {
  const view = await env.fs.reload();
  const fs = view.root();
  if (!agentListening(fs, params.port)) return { ok: false, refusal: null };

  const judgement = judgeSnmpSet(fs, {
    community: params.community,
    assignment: params.assignment,
    frontedSegment: null,
  });
  const contact = contactLines({
    accepted: judgement.kind !== 'silent',
    fromIp: params.fromIp,
    ...ownStamp(env),
  });

  if (judgement.kind !== 'write') {
    await appendOwnLog(env, view, contact);
    return { ok: false, refusal: judgement.kind === 'silent' ? null : judgement.refusal };
  }

  const { oid, value, previous, file } = judgement;
  const stored = await env.patches.write(file.path, file.content, {
    owner: file.owner,
    permissions: file.permissions,
    ...(view.read(file.path).ok ? {} : { isNew: true }),
  });
  await appendOwnLog(env, view, [
    ...contact,
    ...(stored.ok
      ? [
          formatSnmpdSetLine({
            oid,
            previous,
            current: value,
            fromIp: params.fromIp,
            ...ownStamp(env),
          }),
        ]
      : []),
  ]);

  return stored.ok ? { ok: true, oid, value } : { ok: false, refusal: null };
};
