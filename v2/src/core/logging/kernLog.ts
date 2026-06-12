/**
 * Kernel-log line formatting — the `/var/log/kern.log` entries the netfilter
 * (iptables) LOG target writes. An nmap port scan lands here as ONE aggregate
 * line per sweep (not one per probe — that would flood the log), listing every
 * probed port and the scanner's source IP, the way real iptables records a scan.
 *
 * Unlike auth.log lines, a `kernel:` entry has NO `[pid]`, so it composes the
 * shared syslog timestamp directly rather than `formatSyslogLine`. Ported from
 * legacy `src/logging/formatters.ts:formatNmapScanAggregate`.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import type { GameTime } from '../types';
import { formatSyslogTimestamp } from './syslog';

export type NmapScanLogEvent = {
  readonly time: GameTime;
  readonly hostname: string;
  /** The scanner's resolved source IP (see `resolveLogSourceIP`). */
  readonly sourceIp: string;
  readonly probedPorts: readonly number[];
};

/** Render one nmap sweep as a single aggregate `/var/log/kern.log` line. */
export const formatNmapScanAggregate = ({
  time,
  hostname,
  sourceIp,
  probedPorts,
}: NmapScanLogEvent): string =>
  `${formatSyslogTimestamp(time)} ${hostname} kernel: [iptables] Port scan from ${sourceIp} — probed ports ${probedPorts.join(',')} (${probedPorts.length} hits)`;
