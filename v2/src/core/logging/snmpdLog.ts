/**
 * snmpd-log line formatting — the `/var/log/snmpd.log` entries the agent writes when a
 * client names a community string:
 *
 *     Aug 27 09:14:03 gw-01 snmpd[4471]: Authentication failure (incorrect community
 *     name) from UDP: [10.0.0.9]
 *     Aug 27 09:14:04 gw-01 snmpd[4472]: Authentication succeeded from UDP: [10.0.0.9]
 *
 * Syslog-shaped like `auth.log` and unlike the two beside it, because that is what real
 * net-snmp emits — but written to the device's OWN file, the way an appliance running
 * `snmpd -Lf /var/log/snmpd.log` keeps it. So the shape is borrowed and the destination
 * is not: a router's agent noise does not belong in the file a defender reads for
 * logins.
 *
 * Legacy logged NOTHING here. On every other door silence is a gap; on this one it is a
 * defect, because reconfiguring a device through this door needs no shell and no
 * session — so this file is the only tell the owner ever gets.
 *
 * The attempt line names NO account, for the same reason the store's does not: the
 * secret belongs to the service. What the line can say is who tried and whether they
 * got in.
 *
 * Pure, framework-agnostic (core/): the timestamp and process id are supplied by the
 * caller.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CredentialAttempt } from './authLog';
import { formatSyslogLine } from './syslog';

/** The canonical `/var/log/snmpd.log` storage identity — single source of truth shared
 *  by the boot seed (`generation/routerFs`) and every server-side appender, so the
 *  seeded file and each appended patch agree on path, owner, and perms. World-READABLE
 *  like the other trace files: once you are ON the box any account may read it, and
 *  getting on the box is the gate. Root-only WRITE — the agent's append models a system
 *  write, so a visitor can never edit away the record of their visit. NOT on the tier-3
 *  allowlist: the door this file records is reachable without a session, but READING
 *  the record still costs you the box. */
export const SNMPD_LOG_PATH: AbsPath = asAbsPath('/var/log/snmpd.log');
export const SNMPD_LOG_OWNER = 'root';
export const SNMPD_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** Render a client REACHING the agent as its `/var/log/snmpd.log` line, before any
 *  community has been judged. Real net-snmp logs the connection and the verdict
 *  separately, and the two carry different evidence: a run of arrivals with no attempt
 *  behind them is somebody scanning, while an arrival followed by a refusal is somebody
 *  guessing. One combined line could not tell those apart.
 *
 *  The source port real net-snmp prints after the address is omitted. It is an ephemeral
 *  number this world does not model, so printing one would be inventing the only part of
 *  the line a defender might try to act on. */
export const formatSnmpdArrivalLine = ({
  fromIp,
  hostname,
  time,
  pid,
}: Pick<CredentialAttempt, 'fromIp' | 'hostname' | 'time' | 'pid'>): string =>
  formatSyslogLine({
    time,
    hostname,
    service: 'snmpd',
    pid,
    message: `Connection from UDP: [${fromIp}]`,
  });

/** Render one community-string attempt as its `/var/log/snmpd.log` line. The failure
 *  text is real net-snmp's own — a player who has seen the thing this imitates reads it
 *  without being taught. */
/** Render one accepted WRITE as its `/var/log/snmpd.log` line — the OID, what the port
 *  was, what it is now, and where the request came from.
 *
 *  Real net-snmp logs no such thing and neither did legacy, so this line is an
 *  invention. It is the one this door cannot do without: a walk at least leaves an
 *  arrival and a verdict, while the write that follows costs an attacker no account, no
 *  session and no shell. Without this line a stranger could rewrite a device's port
 *  table and leave nothing behind anywhere.
 *
 *  BOTH values, always — including when they are the same. What the defender needs to
 *  know is that somebody holding the community touched the device, and a line withheld
 *  because the file happened not to change would hide exactly the visit that proves the
 *  community is out.
 *
 *  ASCII `->` rather than an arrow glyph: this is a daemon's log file, and a player who
 *  greps it should not have to type a character their keyboard does not have. */
export const formatSnmpdSetLine = ({
  oid,
  previous,
  current,
  fromIp,
  hostname,
  time,
  pid,
}: Pick<CredentialAttempt, 'fromIp' | 'hostname' | 'time' | 'pid'> & {
  readonly oid: string;
  readonly previous: string;
  readonly current: string;
}): string =>
  formatSyslogLine({
    time,
    hostname,
    service: 'snmpd',
    pid,
    message: `SET ${oid} = ${previous} -> ${current} from UDP: [${fromIp}]`,
  });

export const formatSnmpdAttemptLine = ({
  outcome,
  fromIp,
  hostname,
  time,
  pid,
}: CredentialAttempt): string =>
  formatSyslogLine({
    time,
    hostname,
    service: 'snmpd',
    pid,
    message:
      outcome === 'success'
        ? `Authentication succeeded from UDP: [${fromIp}]`
        : `Authentication failure (incorrect community name) from UDP: [${fromIp}]`,
  });
