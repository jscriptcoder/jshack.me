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

/** The files a gateway's network knowledge adds, grouped by the directory they join. */
export type GatewayNetworkEntries = {
  readonly etc: Record<string, FileNode>;
  readonly varLib: Record<string, FileNode>;
};

/** A host on the segment, with the machine id that fixes its MAC. */
type SegmentHost = { readonly host: LanHost; readonly machineId: string };

const LEASE_FILE = '/var/lib/misc/dnsmasq.leases';
const LEASE_HOURS = [12, 24] as const;
const EPOCH_SECONDS = WORLD_EPOCH / 1000;
const DAY_SECONDS = 24 * 60 * 60;

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

  const leases = machines
    .map(({ host, machineId }) => {
      const granted = EPOCH_SECONDS - DAY_SECONDS + prng.nextInt(0, DAY_SECONDS - 1);
      const expiry = granted + leaseHours * 60 * 60;
      return `${expiry} ${hostMac(machineId)} ${host.ip} ${host.hostname} *\n`;
    })
    .join('');

  const reservations = gateways
    .map(({ host, machineId }) => `dhcp-host=${hostMac(machineId)},${host.ip},${host.hostname}\n`)
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
