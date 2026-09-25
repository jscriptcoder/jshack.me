/**
 * Who ran a gateway, and root's shell history on it.
 *
 * A gateway's admin is somebody real. On the home LAN they are one of the network's
 * inhabitants, at their own machine: a desk machine where the LAN has one, else a phone
 * or tablet, else whatever machine the place has. A gateway below the LAN was set up
 * from the gateway above it, so its admin is that parent, at the first address of the
 * layer it fronts. Root's history on the gateway is theirs: the box's own configs and
 * logs, the hosts its network files list, and their own machine.
 *
 * Root-only, like any root's history. Everything draws from the gateway's own
 * `gw-history-` stream, keyed by its machine id, so no other concern's draws move.
 */

import type { FileNode } from '../filesystem/types';
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

/** The address the gateway's admin works from, or undefined for a gateway the network
 *  does not generate. */
export const gatewayAdminIp = (essid: string, machineId: string): string | undefined => {
  const place = placeOf(essid, machineId);
  return place === undefined
    ? undefined
    : drawAdminIp({ prng: historyStream(machineId), essid, ...place });
};

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
