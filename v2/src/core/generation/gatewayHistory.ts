/**
 * Who ran a gateway, root's shell history on it, and what its logs remember of the day
 * before the world began.
 *
 * A gateway's admin is somebody real. On the home LAN they are one of the network's
 * inhabitants, at their own machine: a desk machine where the LAN has one, else a phone
 * or tablet, else whatever machine the place has. A gateway below the LAN was set up
 * from the gateway above it, so its admin is that parent, at the first address of the
 * layer it fronts. Root's history on the gateway is theirs: the box's own configs and
 * logs, the hosts its network files list, and their own machine.
 *
 * The history is root-only, like any root's history; the logs are as readable as the live
 * logs beside them. Both draw from streams of the gateway's own, keyed by its machine id
 * (`gw-history-`, and `gw-history-logs-` for the logs), so no other concern's draws move.
 */

import type { FileEntry, FileNode } from '../filesystem/types';
import { asGameTime, type GameTime } from '../types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { file } from './baseFs';
import type { DhcpGrant } from './gatewayNetwork';
import { formatSyslogLine, SYSLOG_PERMISSIONS } from '../logging/syslog';
import {
  AUTH_LOG_PERMISSIONS,
  formatRootSessionLine,
  formatSshdAuthLine,
} from '../logging/authLog';
import { formatKernelLine, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import {
  formatSnmpdArrivalLine,
  formatSnmpdAttemptLine,
  SNMPD_LOG_PERMISSIONS,
} from '../logging/snmpdLog';
import { LOGROTATE_TIMER } from './pools/logLines';
import { createPrng, type Prng } from './prng';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { chainLinks, lanHostOctet, machineIdForLanHost } from './lanTopology';
import { isDeskMachine } from './npcHome';
import { roleOfHostname } from './pools/hostnames';
import { GATEWAY_ROOT_HISTORY } from './pools/rootContent';

/** Where a gateway stands: its own host, and whether that is on the home LAN. */
const placeOf = (
  essid: string,
  machineId: string,
): { readonly host: LanHost; readonly onLan: boolean } | undefined => {
  const accessPoint = generateHomeLan(essid).hosts.find((host) => lanHostOctet(host) === 1);
  if (accessPoint !== undefined && machineIdForLanHost(accessPoint, essid) === machineId) {
    return { host: accessPoint, onLan: true };
  }
  const link = chainLinks(essid).find((candidate) => candidate.machineId === machineId);
  return link === undefined ? undefined : { host: link.host, onLan: link.parentMachineId === null };
};

/** The admin's address: the FIRST draw of the gateway's history stream, so the history
 *  and anything else that names the admin always agree. */
const drawAdminIp = (options: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly onLan: boolean;
}): string => {
  const { prng, essid, host, onLan } = options;
  if (!onLan) return `${host.ip.split('.').slice(0, 3).join('.')}.1`;
  const machines = generateHomeLan(essid).hosts.filter((candidate) => candidate.kind === 'machine');
  const desks = machines.filter(isDeskMachine);
  const personal = machines.filter(
    (candidate) => roleOfHostname(candidate.hostname) === 'workstation',
  );
  const [tier = machines] = [desks, personal].filter((hosts) => hosts.length > 0);
  return prng.pick(tier).ip;
};

const historyStream = (machineId: string): Prng => createPrng(`gw-history-${machineId}`);

/** A gateway the network generates: the host it is, whether it stands on the home LAN,
 *  and the address its admin works from. */
export type GatewaySite = {
  readonly host: LanHost;
  readonly onLan: boolean;
  readonly adminIp: string;
};

/** Where a gateway stands and who runs it, or undefined for a gateway the network does
 *  not generate. */
export const gatewaySite = (essid: string, machineId: string): GatewaySite | undefined => {
  const place = placeOf(essid, machineId);
  return place === undefined
    ? undefined
    : { ...place, adminIp: drawAdminIp({ prng: historyStream(machineId), essid, ...place }) };
};

/** The address the gateway's admin works from, or undefined for a gateway the network
 *  does not generate. */
export const gatewayAdminIp = (essid: string, machineId: string): string | undefined =>
  gatewaySite(essid, machineId)?.adminIp;

/** Every file's absolute path under a directory's entries. */
const filePaths = (prefix: string, entries: Readonly<Record<string, FileNode>>): string[] =>
  Object.entries(entries).flatMap(([name, node]) =>
    node.kind === 'file'
      ? [`${prefix}/${name}`]
      : filePaths(`${prefix}/${name}`, Object.fromEntries(node.entries)),
  );

/** Root's `.bash_history` on a gateway, from what the gateway holds. */
export const gatewayRootHistory = (options: {
  readonly essid: string;
  readonly machineId: string;
  /** The configs that make the device what it is (its NAT rules or its ACL), which
   *  its admin always has edited. */
  readonly deviceConfig: Readonly<Record<string, FileNode>>;
  /** Every other config under `/etc` the admin may have looked at. */
  readonly otherConfig: Readonly<Record<string, FileNode>>;
  /** `/var/lib`'s entries. */
  readonly state: Readonly<Record<string, FileNode>>;
  /** `/var/log`'s entries. */
  readonly logs: Readonly<Record<string, FileNode>>;
  /** The daemons running on the box. */
  readonly daemons: readonly string[];
  /** The hosts the gateway's network files list. */
  readonly hosts: readonly string[];
}): string => {
  const { essid, machineId, deviceConfig, otherConfig, state, logs, daemons, hosts } = options;
  const prng = historyStream(machineId);
  const place = placeOf(essid, machineId);
  const adminIp = place === undefined ? undefined : drawAdminIp({ prng, essid, ...place });

  const habits = prng.pickN(GATEWAY_ROOT_HISTORY, prng.nextInt(5, 9));
  const edits = filePaths('/etc', deviceConfig).map((path) => `nano ${path}`);
  const reads = [...filePaths('/etc', otherConfig), ...filePaths('/var/lib', state)]
    .filter(() => prng.next() < 0.6)
    .map((path) => `${prng.pick(['cat', 'less', 'nano'])} ${path}`);
  const logLines = prng
    .pickN(filePaths('/var/log', logs), prng.nextInt(1, 2))
    .map((path) => `${prng.pick(['tail', 'tail -f', 'less', 'grep -i error'])} ${path}`);
  const serviceLines = daemons
    .filter(() => prng.next() < 0.5)
    .map((daemon) => `systemctl ${prng.pick(['status', 'restart'])} ${daemon}`);
  const hostLines = prng
    .pickN(hosts, Math.min(hosts.length, prng.nextInt(1, 3)))
    .map((ip) => `ping -c ${prng.pick([1, 3, 4])} ${ip}`);
  const adminLines = adminIp === undefined ? [] : [`ping -c 3 ${adminIp}`];

  const history = prng.shuffle([
    ...habits,
    ...edits,
    ...reads,
    ...logLines,
    ...serviceLines,
    ...hostLines,
    ...adminLines,
  ]);
  return `${history.join('\n')}\n`;
};

const DAY_SECONDS = 86_400;
const LAST_SECOND = DAY_SECONDS - 1;
/** 2026-07-11 00:00:00, in seconds of the epoch. */
const DAY_START = WORLD_EPOCH / 1000 - DAY_SECONDS;
const LINK_SPEEDS = ['100Mbps', '1000Mbps'] as const;

/** One line and the second of 2026-07-11 it was written at. */
type Entry = { readonly second: number; readonly line: string };

const timeAt = (second: number): GameTime => asGameTime((DAY_START + second) * 1000);

const laterBy = (second: number, seconds: number): number => Math.min(second + seconds, LAST_SECOND);

const pidFrom = (prng: Prng): number => prng.nextInt(1000, 99999);

/** A file's lines in the order they happened; the sort is stable, so lines written in the
 *  same second keep the order they were written in. */
const inOrder = (entries: readonly Entry[]): string =>
  [...entries]
    .sort((left, right) => left.second - right.second)
    .map(({ line }) => `${line}\n`)
    .join('');

/**
 * The `.1` rotations of a gateway's logs: what it remembers of 2026-07-11, the day before
 * logrotate ran at the epoch. The morning's rotation and every lease the router granted
 * that day (`syslog.1`), its admin logging in from their own machine (`auth.log.1`), a
 * link or two dropping and coming back (`kern.log.1`), and, where the agent runs, the
 * admin's machine polling it (`snmpd.log.1`). Nothing served the web, so no `access.log`
 * rotated. World-readable, like the live logs they rotated out of, so no line names an
 * account but root. A gateway the network does not generate remembers nothing.
 */
export const gatewayLogRotations = (options: {
  readonly essid: string;
  readonly machineId: string;
  /** Every lease the gateway granted, none on a switch. */
  readonly grants: readonly DhcpGrant[];
  readonly hasSnmp: boolean;
}): Readonly<Record<string, FileNode>> => {
  const { essid, machineId, grants, hasSnmp } = options;
  const site = gatewaySite(essid, machineId);
  if (site === undefined) return {};
  const { adminIp } = site;
  const { hostname } = site.host;
  const prng = createPrng(`gw-history-logs-${machineId}`);
  const syslog = (second: number, service: string, pid: number, message: string): Entry => ({
    second,
    line: formatSyslogLine({ time: timeAt(second), hostname, service, pid, message }),
  });

  const rotated = prng.nextInt(0, 5);
  const rotationDone = laterBy(rotated, prng.nextInt(1, 40));
  const rotation = [
    syslog(rotated, 'systemd', 1, `Starting ${LOGROTATE_TIMER.description}...`),
    syslog(rotationDone, 'systemd', 1, `${LOGROTATE_TIMER.unit}: Deactivated successfully.`),
    syslog(rotationDone, 'systemd', 1, `Finished ${LOGROTATE_TIMER.description}.`),
  ];
  const dnsmasq = pidFrom(prng);
  const leases = grants.flatMap(({ at, mac, ip, hostname: client }) => [
    syslog(at - DAY_START, 'dnsmasq-dhcp', dnsmasq, `DHCPREQUEST(br-lan) ${ip} ${mac}`),
    syslog(at - DAY_START, 'dnsmasq-dhcp', dnsmasq, `DHCPACK(br-lan) ${ip} ${mac} ${client}`),
  ]);

  const visits = Array.from({ length: prng.nextInt(1, 3) }, () => {
    const second = prng.nextInt(0, LAST_SECOND - 60);
    const pid = pidFrom(prng);
    const session = (at: number, phase: 'opened' | 'closed'): Entry => ({
      second: at,
      line: formatRootSessionLine({ time: timeAt(at), hostname, service: 'sshd', pid, phase }),
    });
    return [
      {
        second,
        line: formatSshdAuthLine({
          outcome: 'success',
          user: 'root',
          fromIp: adminIp,
          hostname,
          time: timeAt(second),
          pid,
        }),
      },
      session(second, 'opened'),
      session(laterBy(second, prng.nextInt(60, 3600)), 'closed'),
    ];
  }).flat();

  // Each drop falls in an hour of its own and lasts under two minutes, so one link is
  // back before the next goes down.
  const kernel = (second: number, message: string): Entry => ({
    second,
    line: formatKernelLine({ time: timeAt(second), hostname, message }),
  });
  const drops = prng
    .pickN(
      Array.from({ length: 24 }, (_, hour) => hour),
      prng.nextInt(1, 2),
    )
    .flatMap((hour) => {
      const link = prng.pick(['eth0', 'eth1']);
      const down = hour * 3600 + prng.nextInt(0, 3000);
      return [
        kernel(down, `${link}: link down`),
        kernel(
          laterBy(down, prng.nextInt(2, 90)),
          `${link}: link up, ${prng.pick(LINK_SPEEDS)}, full-duplex`,
        ),
      ];
    });

  const agent = pidFrom(prng);
  const polls = hasSnmp
    ? Array.from({ length: prng.nextInt(1, 4) }, () => {
        const second = prng.nextInt(0, LAST_SECOND);
        const attempt = { fromIp: adminIp, hostname, time: timeAt(second), pid: agent };
        return [
          { second, line: formatSnmpdArrivalLine(attempt) },
          {
            second,
            line: formatSnmpdAttemptLine({ ...attempt, outcome: 'success', user: 'root' }),
          },
        ];
      }).flat()
    : [];

  const rotations: readonly (readonly [string, readonly Entry[], FileEntry['perms']])[] = [
    ['syslog.1', [...rotation, ...leases], SYSLOG_PERMISSIONS],
    ['auth.log.1', visits, AUTH_LOG_PERMISSIONS],
    ['kern.log.1', drops, KERN_LOG_PERMISSIONS],
    ['snmpd.log.1', polls, SNMPD_LOG_PERMISSIONS],
  ];
  return Object.fromEntries(
    rotations
      .filter(([, entries]) => entries.length > 0)
      .map(([name, entries, perms]) => [name, file(inOrder(entries), perms)]),
  );
};
