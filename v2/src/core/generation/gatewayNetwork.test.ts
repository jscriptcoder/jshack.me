import { describe, expect, it } from 'vitest';
import { buildApGatewayBaseFs } from './routerFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { machineIdForLanHost } from './lanTopology';
import { hostMac } from './hostMac';
import { WORLD_EPOCH } from '../cve/worldClock';
import { ALL_ESSIDS } from '../../test/worldContent';
import type { Directory, FileNode } from '../filesystem/types';

const LEASES_PATH = 'var/lib/misc/dnsmasq.leases';
const CONFIG_PATH = 'etc/dnsmasq.conf';

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

const contentAt = (tree: Directory, path: string): string => {
  const node = nodeAt(tree, path);
  if (node?.kind !== 'file') throw new Error(`no file at /${path}`);
  return node.content;
};

/** A host as a lease or a reservation states it: the three facts both tables carry. */
const asEntry = (essid: string, host: LanHost): string =>
  `${hostMac(machineIdForLanHost(host, essid))} ${host.ip} ${host.hostname}`;

/** dnsmasq's lease columns: expiry (epoch seconds), MAC, IP, hostname, client id. */
const leaseRows = (leases: string) =>
  leases
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [expiry, mac, ip, hostname] = line.split(' ');
      return { expiry: Number(expiry), entry: `${mac} ${ip} ${hostname}`, ip: ip ?? '' };
    });

const settings = (config: string, key: string): readonly string[] =>
  config
    .split('\n')
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));

const lastOctet = (ip: string): number => Number(ip.split('.')[3]);

const EPOCH_SECONDS = WORLD_EPOCH / 1000;
const DAY_SECONDS = 24 * 60 * 60;

describe('an access point knows its LAN', () => {
  it('leases exactly the generated machines on its LAN, each by its IP, name and MAC', () => {
    for (const essid of ALL_ESSIDS) {
      const leased = leaseRows(contentAt(buildApGatewayBaseFs(essid), LEASES_PATH)).map(
        (row) => row.entry,
      );
      const machines = generateHomeLan(essid)
        .hosts.filter((host) => host.kind === 'machine')
        .map((host) => asEntry(essid, host));
      expect(new Set(leased)).toEqual(new Set(machines));
      expect(leased).toHaveLength(machines.length);
    }
  });

  it('reserves the other gateways on its LAN rather than leasing them', () => {
    for (const essid of ALL_ESSIDS) {
      const reserved = settings(contentAt(buildApGatewayBaseFs(essid), CONFIG_PATH), 'dhcp-host').map(
        (reservation) => reservation.split(',').join(' '),
      );
      const gateways = generateHomeLan(essid)
        .hosts.filter((host) => host.kind !== 'machine' && lastOctet(host.ip) !== 1)
        .map((host) => asEntry(essid, host));
      expect(new Set(reserved)).toEqual(new Set(gateways));
    }
  });

  it('hands out a range that covers every lease and never the address of the gateway itself', () => {
    for (const essid of ALL_ESSIDS) {
      const tree = buildApGatewayBaseFs(essid);
      const [range] = settings(contentAt(tree, CONFIG_PATH), 'dhcp-range');
      const [first = '', last = ''] = (range ?? '').split(',');
      const { subnet } = generateHomeLan(essid);
      expect(first.startsWith(`${subnet}.`)).toBe(true);
      expect(last.startsWith(`${subnet}.`)).toBe(true);
      expect(lastOctet(first)).toBeGreaterThan(1);
      for (const row of leaseRows(contentAt(tree, LEASES_PATH))) {
        expect(lastOctet(row.ip)).toBeGreaterThanOrEqual(lastOctet(first));
        expect(lastOctet(row.ip)).toBeLessThanOrEqual(lastOctet(last));
      }
    }
  });

  it('granted every lease on the last day before the epoch, for the configured lease time', () => {
    for (const essid of ALL_ESSIDS) {
      const tree = buildApGatewayBaseFs(essid);
      const [range = ''] = settings(contentAt(tree, CONFIG_PATH), 'dhcp-range');
      const hours = Number(/,(\d+)h$/.exec(range)?.[1]);
      expect(hours).toBeGreaterThan(0);
      for (const row of leaseRows(contentAt(tree, LEASES_PATH))) {
        const granted = row.expiry - hours * 60 * 60;
        expect(granted).toBeGreaterThanOrEqual(EPOCH_SECONDS - DAY_SECONDS);
        expect(granted).toBeLessThan(EPOCH_SECONDS);
      }
    }
  });

  it('lets anyone on the box read the leases and the config, and only root change them', () => {
    const tree = buildApGatewayBaseFs(ALL_ESSIDS[0] ?? '');
    for (const path of [LEASES_PATH, CONFIG_PATH]) {
      const node = nodeAt(tree, path);
      expect(node?.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node?.perms.write).toEqual(['root']);
    }
  });
});
