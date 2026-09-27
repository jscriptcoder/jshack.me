/**
 * The fixed text behind a generated box's rotated logs: the housekeeping systemd runs
 * every day, the words it uses for each service it starts, and what the kernel says
 * while it boots.
 *
 * Every rotated log is readable by anyone on the box, and the tests hold these lines to
 * the rules the rest of the world content follows:
 * - **No account but root**, and no slot that could carry one.
 * - **No version and no decimal** — `/var/lib/dpkg/status` is the one place a version
 *   lives — so the kernel's boot lines leave out its release and its uptime stamps.
 * - **No path the box does not have**: the boot names `/boot/vmlinuz`, which every box
 *   carries, and no device node.
 */

import type { ServiceSpec } from '../../services/serviceCatalog';

/** A timer systemd fires once a day: what it says starting, and the unit it runs. */
export type DailyTimer = { readonly description: string; readonly unit: string };

/** Log rotation runs first thing, every day, on every box — it is what left this day in
 *  its own `.1` file. */
export const LOGROTATE_TIMER: DailyTimer = {
  description: 'Rotate log files',
  unit: 'logrotate.service',
};

/** The other daily housekeeping a Debian box runs, of which each box shows a few. */
export const DAILY_TIMERS: readonly DailyTimer[] = [
  { description: 'Daily apt download activities', unit: 'apt-daily.service' },
  { description: 'Daily apt upgrade and clean activities', unit: 'apt-daily-upgrade.service' },
  { description: 'Cleanup of Temporary Directories', unit: 'systemd-tmpfiles-clean.service' },
  { description: 'Daily man-db regeneration', unit: 'man-db.service' },
  { description: 'Update the plocate database', unit: 'plocate-updatedb.service' },
];

/** What systemd calls each service when it starts it after a boot. Keyed by the
 *  catalog's service name. */
export const SERVICE_UNIT_DESCRIPTIONS: Readonly<Record<ServiceSpec['service'], string>> = {
  ssh: 'OpenBSD Secure Shell server',
  http: 'A high performance web server and a reverse proxy server',
  ftp: 'vsftpd FTP server',
  mysql: 'MySQL Community Server',
  redis: 'Advanced key-value store',
  snmp: 'Simple Network Management Protocol (SNMP) Daemon',
  domain: 'BIND Domain Name Server',
};

/** The kernel's boot, in the order it prints it. Slots: `{uuid}` the root filesystem's
 *  UUID from `/etc/fstab`, `{cpus}` the processor count, `{available}` and `{total}`
 *  memory in kilobytes. */
export const KERNEL_BOOT_LINES: readonly string[] = [
  'Command line: BOOT_IMAGE=/boot/vmlinuz root=UUID={uuid} ro quiet',
  'BIOS-provided physical RAM map:',
  'NX (Execute Disable) protection: active',
  'smpboot: Allowing {cpus} CPUs, 0 hotplug CPUs',
  'Kernel command line: BOOT_IMAGE=/boot/vmlinuz root=UUID={uuid} ro quiet',
  'Memory: {available}K/{total}K available',
  'ACPI: Interpreter enabled',
  'PCI: Using configuration type 1 for base access',
  'clocksource: Switched to clocksource tsc',
  'NET: Registered PF_INET6 protocol family',
  'audit: initializing netlink subsys (disabled)',
  'random: crng init done',
  'EXT4-fs: mounted filesystem {uuid} r/w with ordered data mode',
  'Freeing unused kernel image (initmem) memory: 2716K',
];

/** How often Redis's snapshot rule fires, as it states the rule when it saves. */
export const REDIS_SAVE_RULES: readonly { readonly changes: number; readonly seconds: number }[] = [
  { changes: 1, seconds: 3600 },
  { changes: 100, seconds: 300 },
  { changes: 10000, seconds: 60 },
];
