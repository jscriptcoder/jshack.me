/**
 * What a gateway knows about the network it serves: the DHCP leases it handed out and the
 * addresses it reserved. Every row names a real generated host by the MAC `hostMac` gives
 * it, so rooting a gateway reads as a map of its neighbours. Player occupants are never
 * listed — they come and go, and a base tree is frozen at the epoch.
 */

import type { FileNode } from '../filesystem/types';
import { createPrng } from './prng';
import { hostMac } from './hostMac';
import { dir, file, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from './baseFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { chainLinks, machineIdForLanHost } from './lanTopology';
import { hostMachineId } from './remoteHostId';
import { computeDeepGatewayId } from '../identity/router';
import { WORLD_EPOCH } from '../cve/worldClock';

/** One lease as dnsmasq granted it: the second of the epoch it was granted at, and the
 *  card and address it went to. */
export type DhcpGrant = {
  readonly at: number;
  readonly mac: string;
  readonly ip: string;
  readonly hostname: string;
};

/** A card the router keeps an address for, whoever asks. */
export type DhcpReservation = Omit<DhcpGrant, 'at'>;

/** The DHCP a router serves: the /24 it hands out, for how long, and the addresses it
 *  keeps for the segment's gateways. */
export type DhcpService = {
  readonly subnet: string;
  readonly leaseHours: number;
  readonly reservations: readonly DhcpReservation[];
};

/** One row of a switch's MAC table: the card seen on a port, and the host its admin
 *  labelled the port with. */
export type SwitchPort = {
  readonly port: string;
  readonly mac: string;
  readonly vlan: number;
  readonly hostname: string;
  readonly ip: string;
};

/** The files a gateway's network knowledge adds, grouped by the directory they join; the
 *  addresses of the hosts those files name; every lease it granted; the DHCP it serves,
 *  null on a switch; and a switch's ports, none on a router. */
export type GatewayNetworkEntries = {
  readonly etc: Record<string, FileNode>;
  readonly varLib: Record<string, FileNode>;
  readonly hosts: readonly string[];
  readonly grants: readonly DhcpGrant[];
  readonly dhcp: DhcpService | null;
  readonly ports: readonly SwitchPort[];
};

/** A host on the segment, with the machine id that fixes its MAC. */
type SegmentHost = { readonly host: LanHost; readonly machineId: string };

const LEASE_FILE = '/var/lib/misc/dnsmasq.leases';
const LEASE_HOURS = [12, 24] as const;
const EPOCH_SECONDS = WORLD_EPOCH / 1000;

const lastOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A segment's DHCP state as its router froze it at the epoch: every machine holds a
 *  lease granted on the last day before it; the segment's gateways have static addresses,
 *  so they are reservations rather than leases. */
const dhcpServer = (options: {
  readonly seed: string;
  readonly subnet: string;
  readonly machines: readonly SegmentHost[];
  readonly gateways: readonly SegmentHost[];
}): GatewayNetworkEntries => {
  const { seed, subnet, machines, gateways } = options;
  const prng = createPrng(`gw-net-${seed}`);
  const leaseHours = prng.pick(LEASE_HOURS);

  // Every lease is still held at the epoch, so each was granted within one term of it —
  // which, for a term of a day or less, is always on the last day.
  const term = leaseHours * 60 * 60;
  const grants: readonly DhcpGrant[] = machines.map(({ host, machineId }) => ({
    at: EPOCH_SECONDS - term + prng.nextInt(1, term - 1),
    mac: hostMac(machineId),
    ip: host.ip,
    hostname: host.hostname,
  }));
  const leases = grants
    .map(({ at, mac, ip, hostname }) => `${at + term} ${mac} ${ip} ${hostname} *\n`)
    .join('');

  const reserved: readonly DhcpReservation[] = gateways.map(({ host, machineId }) => ({
    mac: hostMac(machineId),
    ip: host.ip,
    hostname: host.hostname,
  }));
  const reservations = reserved
    .map(({ mac, ip, hostname }) => `dhcp-host=${mac},${ip},${hostname}\n`)
    .join('');

  const config = [
    '# DHCP and DNS for the segment',
    'interface=br-lan',
    'bind-interfaces',
    'domain-needed',
    'bogus-priv',
    `dhcp-range=${subnet}.2,${subnet}.254,${leaseHours}h`,
    `dhcp-leasefile=${LEASE_FILE}`,
    '',
    '# gateways keep their addresses',
  ].join('\n');

  return {
    etc: { 'dnsmasq.conf': file(`${config}\n${reservations}`, SERVICE_CONFIG_FILE) },
    varLib: { misc: dir({ 'dnsmasq.leases': file(leases, SERVICE_CONFIG_FILE) }, TRAVERSABLE_DIR) },
    hosts: [...machines, ...gateways].map(({ host }) => host.ip),
    grants,
    dhcp: { subnet, leaseHours, reservations: reserved },
    ports: [],
  };
};

/** The access point serves the home LAN: its machines, and the inner gateways on it. */
export const apGatewayNetwork = (essid: string): GatewayNetworkEntries => {
  const { subnet, hosts } = generateHomeLan(essid);
  const onLan = (keep: (host: LanHost) => boolean): readonly SegmentHost[] =>
    hosts.filter(keep).map((host) => ({ host, machineId: machineIdForLanHost(host, essid) }));
  return dhcpServer({
    seed: `ap-gw-${essid}`,
    subnet,
    machines: onLan((host) => host.kind === 'machine'),
    gateways: onLan((host) => host.kind !== 'machine' && lastOctet(host) !== 1),
  });
};

/** An inner or deep router serves the deep layer it fronts: that layer's one machine, and
 *  the child gateway fronting the next layer when the chain goes on. Only the chain walk
 *  knows whether it does, so the router is found on it; a router the network does not
 *  generate serves nothing. `seed` is the router's own seed key. */
export const chainRouterNetwork = (options: {
  readonly essid: string;
  readonly machineId: string;
  readonly seed: string;
}): GatewayNetworkEntries | undefined => {
  const { essid, machineId, seed } = options;
  const link = chainLinks(essid).find((candidate) => candidate.machineId === machineId);
  if (link === undefined) return undefined;
  const layer = generateDeepLayer(
    essid,
    { machineId, kind: link.host.kind },
    { hangsChild: link.hangsChild },
  );
  const child = layer.childGateway;
  return dhcpServer({
    seed,
    subnet: layer.subnet,
    machines: [{ host: layer.host, machineId: hostMachineId(layer.host, essid) }],
    gateways:
      child === null
        ? []
        : [{ host: child, machineId: computeDeepGatewayId(machineId, lastOctet(child)) }],
  });
};

/** A switch hands out no addresses, but it knows which card sits on which port: the one
 *  machine on the layer it fronts (a switch forwards nothing onward, so hangs no child).
 *  Its admin labelled the port with the host's name and address, as a managed switch's
 *  port descriptions usually read. `seed` is the switch's own seed key. */
export const chainSwitchNetwork = (options: {
  readonly essid: string;
  readonly machineId: string;
  readonly seed: string;
}): GatewayNetworkEntries | undefined => {
  const { essid, machineId, seed } = options;
  if (!chainLinks(essid).some((candidate) => candidate.machineId === machineId)) {
    return undefined;
  }
  const prng = createPrng(`gw-net-${seed}`);
  const { host } = generateDeepLayer(essid, { machineId, kind: 'switch' });
  const row: SwitchPort = {
    port: `gi1/0/${prng.nextInt(1, 24)}`,
    vlan: prng.pick([1, 10, 20, 100]),
    mac: hostMac(hostMachineId(host, essid)),
    hostname: host.hostname,
    ip: host.ip,
  };
  const table = [
    '# port     mac                vlan  description',
    `${row.port.padEnd(10)} ${row.mac}  ${String(row.vlan).padEnd(5)} ${row.hostname} (${row.ip})`,
    '',
  ].join('\n');
  return {
    etc: {},
    varLib: { switch: dir({ 'mac-table': file(table, SERVICE_CONFIG_FILE) }, TRAVERSABLE_DIR) },
    hosts: [host.ip],
    grants: [],
    dhcp: null,
    ports: [row],
  };
};
