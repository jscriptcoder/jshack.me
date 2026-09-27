/**
 * named-log line formatting — the `/var/log/named.log` entries BIND writes for a
 * zone transfer (AXFR):
 *
 *     05-Sep-2026 22:13:20.456 client 203.0.113.7 (acme-corp.lan): transfer of 'acme-corp.lan/IN': AXFR ended: 8 records
 *
 * Like `vsftpd.log` and `access.log`, and unlike `auth.log`, this is NOT a syslog
 * line: `named` writes its own channel file rather than handing the entry to
 * syslog, so there is no hostname and no `service[pid]:` tag. `formatSyslogLine` is
 * therefore not reusable — the timestamp is BIND's own `DD-Mon-YYYY HH:MM:SS.mmm`
 * shape too. Only `MONTHS` is shared.
 *
 * A transfer is what makes a name server the LOUD box on its network. An ordinary
 * lookup writes nothing (BIND's querylog default — and every host now resolves
 * through DNS, so a query log would fill with the traffic of ordinary play), but a
 * transfer and a refused attempt each leave ONE line naming the source. The source
 * is named by IP alone, exactly as kern.log and auth.log name a scanner or a login;
 * the record count mirrors dig's `;; XFR size: N records`, so the defender who roots
 * the box learns how much of the zone left, and to whom.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { MONTHS } from './syslog';

/** The canonical `/var/log/named.log` storage identity — single source of truth
 *  shared by the boot seed (`generation/remoteHostFs`) and the server-side appender,
 *  so the seeded file and every appended patch agree on path, owner, and perms.
 *  World-READABLE, matching the other trace files: once you are ON the box any account
 *  may read it, and getting on the box is the gate. Root-only WRITE — the daemon's
 *  append models a system write, never a player-tier one, so a visitor can never edit
 *  away the record of their transfer. NOT on the tier-3 allowlist: you have to get in
 *  to read it. Mirrors the `AUTH_LOG_*` / `VSFTPD_LOG_*` sets. */
export const NAMED_LOG_PATH: AbsPath = asAbsPath('/var/log/named.log');
export const NAMED_LOG_OWNER = 'root';
export const NAMED_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const padZero = (value: number, width = 2): string => value.toString().padStart(width, '0');

/** Format BIND's log timestamp `DD-Mon-YYYY HH:MM:SS.mmm` (UTC) — e.g.
 *  `05-Sep-2026 22:13:20.456`. Day zero-padded to width 2, the clock fields to 2, and
 *  the milliseconds to 3, exactly as BIND renders them. */
const formatNamedTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = padZero(date.getUTCDate());
  const month = MONTHS[date.getUTCMonth()];
  const clock = `${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
  return `${day}-${month}-${date.getUTCFullYear()} ${clock}.${padZero(date.getUTCMilliseconds(), 3)}`;
};

/** What the server recomputed the transfer to be. An open box handed the zone over
 *  (and carries its record count, the size dig reported); a closed box refused. There
 *  is no third form here — a target that is not a name server, or an ordinary lookup,
 *  writes no line at all, so the caller never reaches this formatter for them. */
export type ZoneTransferOutcome =
  | { readonly verdict: 'transferred'; readonly records: number }
  | { readonly verdict: 'denied' };

export type ZoneTransferLogEvent = {
  /** Epoch-ms of the universe clock — the server's UTC time at append. */
  readonly time: GameTime;
  /** The transferring player's server-derived source IP (see `resolveCrossPlayerSourceIp`). */
  readonly sourceIp: string;
  /** The zone that was asked for, e.g. `grad-student-wifi.lan` (from `lanZoneName`). */
  readonly zone: string;
  readonly outcome: ZoneTransferOutcome;
};

/** Render one AXFR event as its `/var/log/named.log` line. A completed transfer ends
 *  with its record count — the line `dig` has no defender-side equivalent of until now;
 *  a refusal names the denial and carries no count, because nothing left. One formatter
 *  for both, so a defender greps the file once and reads the whole visit. */
export const formatNamedXfrLine = ({
  time,
  sourceIp,
  zone,
  outcome,
}: ZoneTransferLogEvent): string => {
  const head = `${formatNamedTimestamp(time)} client ${sourceIp} (${zone}): `;
  return outcome.verdict === 'transferred'
    ? `${head}transfer of '${zone}/IN': AXFR ended: ${outcome.records} records`
    : `${head}zone transfer '${zone}/IN' denied`;
};

/** Render the `rndc` command an admin sent the daemon, as BIND records receiving it. */
export const formatNamedControlLine = ({
  time,
  command,
}: {
  readonly time: GameTime;
  readonly command: string;
}): string => `${formatNamedTimestamp(time)} received control channel command '${command}'`;

/** Render a zone going live, naming the serial the zone file carries — the number a
 *  secondary compares, and the one line that says which edition of the zone is served. */
export const formatNamedZoneLoadedLine = ({
  time,
  zone,
  serial,
}: {
  readonly time: GameTime;
  readonly zone: string;
  readonly serial: number;
}): string => `${formatNamedTimestamp(time)} zone ${zone}/IN: loaded serial ${serial}`;
