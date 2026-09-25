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
import { machineIdForLanHost } from './lanTopology';
import { WORLD_EPOCH } from '../cve/worldClock';

/** The files a gateway's network knowledge adds, grouped by the directory they join. */
export type GatewayNetworkEntries = {
  readonly etc: Record<string, FileNode>;
  readonly varLib: Record<string, FileNode>;
};

const LEASE_FILE = '/var/lib/misc/dnsmasq.leases';
const LEASE_HOURS = [12, 24] as const;
const EPOCH_SECONDS = WORLD_EPOCH / 1000;
const DAY_SECONDS = 24 * 60 * 60;

const lastOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A LAN's DHCP state as its access point froze it at the epoch: every generated machine
 *  holds a lease granted on the last day before it; the other gateways on the LAN have
 *  static addresses, so they are reservations rather than leases. */
export const apGatewayNetwork = (essid: string): GatewayNetworkEntries => {
  const prng = createPrng(`gw-net-ap-gw-${essid}`);
  const { subnet, hosts } = generateHomeLan(essid);
  const leaseHours = prng.pick(LEASE_HOURS);
  const macOf = (host: LanHost): string => hostMac(machineIdForLanHost(host, essid));

  const leases = hosts
    .filter((host) => host.kind === 'machine')
    .map((host) => {
      const granted = EPOCH_SECONDS - DAY_SECONDS + prng.nextInt(0, DAY_SECONDS - 1);
      const expiry = granted + leaseHours * 60 * 60;
      return `${expiry} ${macOf(host)} ${host.ip} ${host.hostname} *\n`;
    })
    .join('');

  const reservations = hosts
    .filter((host) => host.kind !== 'machine' && lastOctet(host) !== 1)
    .map((host) => `dhcp-host=${macOf(host)},${host.ip},${host.hostname}\n`)
    .join('');

  const config = [
    '# DHCP and DNS for the LAN',
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
