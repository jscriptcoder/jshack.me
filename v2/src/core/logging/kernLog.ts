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

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { formatSyslogTimestamp } from './syslog';

/** The canonical `/var/log/kern.log` storage identity — single source of truth
 *  shared by the host-FS seed (`generation/remoteHostFs` + `workstationFs`) and
 *  the server-side appender (the nmap scan action), so the seeded file and every
 *  appended patch agree on path, owner, and perms. World-READABLE (a defender or
 *  post-breakin attacker can `cat` it) but root-only WRITE: an iptables LOG entry
 *  is a kernel write, never a player-tier one. Mirrors the `AUTH_LOG_*` set. */
export const KERN_LOG_PATH: AbsPath = asAbsPath('/var/log/kern.log');
export const KERN_LOG_OWNER = 'root';
export const KERN_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

export type RebootLogEvent = {
  readonly time: GameTime;
  readonly hostname: string;
  /** Where the reboot was ordered from (see `resolveCrossPlayerSourceIp`) — the
   *  defender's only lead on who threw them off their own box. */
  readonly sourceIp: string;
};

/** One reboot, as the box's kernel records it going down. Tagged `[reboot]` beside
 *  the `[iptables]` entries already in this file, because a defender reads the log
 *  top to bottom with `cat` and a line that does not announce which subsystem wrote
 *  it is one more thing to work out.
 *
 *  It names the sessions, not the machine: what the reader wants to know is whether
 *  whoever was inside is gone, and that is the fact the reboot actually settled. */
export const formatRebootLine = ({ time, hostname, sourceIp }: RebootLogEvent): string =>
  `${formatSyslogTimestamp(time)} ${hostname} kernel: [reboot] System restart requested from ${sourceIp} — all sessions terminated`;

export type NmapScanLogEvent = {
  readonly time: GameTime;
  readonly hostname: string;
  /** The scanner's resolved source IP (see `resolveLogSourceIP`). */
  readonly sourceIp: string;
  readonly probedPorts: readonly number[];
};

/** Render one nmap sweep against a single host as its aggregate `/var/log/kern.log`
 *  line. A host with no open ports still records the probe, rendered as
 *  `probed ports none (0 hits)` so the empty list never leaves a dangling gap. */
export const formatNmapScanAggregate = ({
  time,
  hostname,
  sourceIp,
  probedPorts,
}: NmapScanLogEvent): string => {
  const portList = probedPorts.length === 0 ? 'none' : probedPorts.join(',');
  return `${formatSyslogTimestamp(time)} ${hostname} kernel: [iptables] Port scan from ${sourceIp} — probed ports ${portList} (${probedPorts.length} hits)`;
};

export type SegfaultLogEvent = {
  readonly time: GameTime;
  readonly hostname: string;
  /** The program that faulted — rendered `command[pid]:` inside the `kernel:` line,
   *  the way a real crash names the faulting binary. */
  readonly command: string;
  /** The shared library the fault landed in, named WITHOUT its `.so` suffix (as
   *  `libraryDeps` carries it); the `.so` is appended here so the crash line matches
   *  what `ldd` and the exploit's own vulnerability line print. */
  readonly library: string;
  readonly pid: number;
};

/** Render a `msfconsole --local` MISS as the crash the kernel records (decision 69):
 *  the command links a library but none of them is live, so the program faults, and
 *  what a real box writes is a segfault line — not an "exploit" line, which nothing on
 *  the system knows to write. Modelled on a null-dereference crash (`at 0`, `ip 0`), so
 *  the line carries no address the game does not model and no CVE id: the recurring
 *  library name in these lines is the defender's whole clue to patch it. Same pid-less
 *  `kernel:` shape as the iptables line above, the command+pid living in the message. */
export const formatSegfaultLine = ({
  time,
  hostname,
  command,
  library,
  pid,
}: SegfaultLogEvent): string =>
  `${formatSyslogTimestamp(time)} ${hostname} kernel: ${command}[${pid}]: segfault at 0 ip 0000000000000000 sp 0000000000000000 error 4 in ${library}.so`;

/** Render one line the kernel writes on its own account — a boot message — in the same
 *  pid-less `kernel:` shape as the iptables and reboot lines above. */
export const formatKernelLine = ({
  time,
  hostname,
  message,
}: {
  readonly time: GameTime;
  readonly hostname: string;
  readonly message: string;
}): string => `${formatSyslogTimestamp(time)} ${hostname} kernel: ${message}`;
