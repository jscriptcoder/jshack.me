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

/** Render one community-string attempt as its `/var/log/snmpd.log` line. The failure
 *  text is real net-snmp's own — a player who has seen the thing this imitates reads it
 *  without being taught. */
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
