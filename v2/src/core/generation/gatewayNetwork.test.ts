import { describe, expect, it } from 'vitest';
import { buildApGatewayBaseFs, buildDeepGatewayBaseFs, buildDeepSwitchBaseFs } from './routerFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { chainLinks, machineIdForLanHost } from './lanTopology';
import { chainGatewayBaseFsForMachineId } from './lanHostIdentity';
import { hostMachineId } from './remoteHostId';
import { hostMac } from './hostMac';
import { computeDeepGatewayId } from '../identity/router';
import { WORLD_EPOCH } from '../cve/worldClock';
import { ALL_ESSIDS } from '../../test/worldContent';
import type { Directory, FileNode } from '../filesystem/types';
import { serializeTree } from '../filesystem/treeCodec';
import { filterTreeForRead } from '../patches/readFilter';
import { createPatchApi } from '../../adapters/patchApi';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { signedEnvelopeSchema } from '../signedRequest/types';
import { asAbsPath, asMachineId } from '../types';

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

const lastOctet = (ip: string): number => Number(ip.split('.')[3]);

/** A host as a lease or a reservation states it: the three facts both tables carry. */
const asEntry = (machineId: string, host: LanHost): string =>
  `${hostMac(machineId)} ${host.ip} ${host.hostname}`;

/** A router and the segment it hands addresses out on, stated from the population the
 *  network generates rather than from anything the router's own files say. */
type ServingRouter = {
  readonly name: string;
  readonly position: 'access point' | 'inner' | 'deep';
  readonly tree: Directory;
  readonly subnet: string;
  /** The machines on the segment, as their leases must read. */
  readonly machines: readonly string[];
  /** The segment's other gateways, as their reservations must read. */
  readonly gateways: readonly string[];
};

/** The access point serves the home LAN. */
const accessPoint = (essid: string): ServingRouter => {
  const { subnet, hosts } = generateHomeLan(essid);
  const entries = (keep: (host: LanHost) => boolean) =>
    hosts.filter(keep).map((host) => asEntry(machineIdForLanHost(host, essid), host));
  return {
    name: `${essid} ${subnet}.1`,
    position: 'access point',
    tree: buildApGatewayBaseFs(essid),
    subnet,
    machines: entries((host) => host.kind === 'machine'),
    gateways: entries((host) => host.kind !== 'machine' && lastOctet(host.ip) !== 1),
  };
};

/** Every inner and deep router serves the deep layer it fronts: that layer's one machine,
 *  and the child gateway fronting the next layer when the chain goes on. */
const chainRouters = (essid: string): readonly ServingRouter[] =>
  chainLinks(essid)
    .filter((link) => link.host.kind === 'router')
    .map((link) => {
      const layer = generateDeepLayer(
        essid,
        { machineId: link.machineId, kind: link.host.kind },
        { hangsChild: link.hangsChild },
      );
      const tree = chainGatewayBaseFsForMachineId(essid, link.machineId);
      if (tree === null) throw new Error(`no tree for ${link.machineId}`);
      const child = layer.childGateway;
      return {
        name: `${essid} ${link.host.ip}`,
        position: link.parentMachineId === null ? 'inner' : 'deep',
        tree,
        subnet: layer.subnet,
        machines: [asEntry(hostMachineId(layer.host, essid), layer.host)],
        gateways:
          child === null
            ? []
            : [asEntry(computeDeepGatewayId(link.machineId, lastOctet(child.ip)), child)],
      };
    });

/** Built inside each test, never cached at file level, so a mutation run credits each
 *  mutant to every test that reads it. */
const routers = (): readonly ServingRouter[] =>
  ALL_ESSIDS.flatMap((essid) => [accessPoint(essid), ...chainRouters(essid)]);

/** dnsmasq's lease columns: expiry (epoch seconds), MAC, IP, hostname, client id. */
const leaseRows = (router: ServingRouter) =>
  contentAt(router.tree, LEASES_PATH)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [expiry, mac, ip, hostname] = line.split(' ');
      return { expiry: Number(expiry), entry: `${mac} ${ip} ${hostname}`, ip: ip ?? '' };
    });

const settings = (router: ServingRouter, key: string): readonly string[] =>
  contentAt(router.tree, CONFIG_PATH)
    .split('\n')
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));

/** The lease term the router's `dhcp-range` sets, in hours. */
const leaseHours = (router: ServingRouter): number => {
  const [range = ''] = settings(router, 'dhcp-range');
  return Number(/,(\d+)h$/.exec(range)?.[1]);
};

const EPOCH_SECONDS = WORLD_EPOCH / 1000;
const DAY_SECONDS = 24 * 60 * 60;

describe('a router knows the segment it serves', () => {
  it('covers the access point and every inner and deep router in the world', () => {
    const deep = routers().filter((router) => router.subnet.startsWith('10.'));
    expect(deep.length).toBeGreaterThan(ALL_ESSIDS.length);
    expect(deep.some((router) => router.gateways.length === 0)).toBe(true);
    expect(deep.some((router) => router.gateways.length === 1)).toBe(true);
  });

  it('leases exactly the generated machines on its segment, each by its IP, name and MAC', () => {
    for (const router of routers()) {
      const leased = leaseRows(router).map((row) => row.entry);
      expect(new Set(leased), router.name).toEqual(new Set(router.machines));
      expect(leased, router.name).toHaveLength(router.machines.length);
    }
  });

  it('reserves the other gateways on its segment rather than leasing them', () => {
    for (const router of routers()) {
      const reserved = settings(router, 'dhcp-host').map((reservation) =>
        reservation.split(',').join(' '),
      );
      expect(new Set(reserved), router.name).toEqual(new Set(router.gateways));
    }
  });

  it('hands out a range on its segment that covers every lease and never its own address', () => {
    for (const router of routers()) {
      const [range = ''] = settings(router, 'dhcp-range');
      const [first = '', last = ''] = range.split(',');
      expect(first.startsWith(`${router.subnet}.`), router.name).toBe(true);
      expect(last.startsWith(`${router.subnet}.`), router.name).toBe(true);
      expect(lastOctet(first), router.name).toBeGreaterThan(1);
      for (const row of leaseRows(router)) {
        expect(lastOctet(row.ip), router.name).toBeGreaterThanOrEqual(lastOctet(first));
        expect(lastOctet(row.ip), router.name).toBeLessThanOrEqual(lastOctet(last));
      }
    }
  });

  it('granted every lease on the last day before the epoch, for the configured lease time', () => {
    for (const router of routers()) {
      const hours = leaseHours(router);
      expect(hours, router.name).toBeGreaterThan(0);
      for (const row of leaseRows(router)) {
        const granted = row.expiry - hours * 60 * 60;
        expect(granted, router.name).toBeGreaterThanOrEqual(EPOCH_SECONDS - DAY_SECONDS);
        expect(granted, router.name).toBeLessThan(EPOCH_SECONDS);
      }
    }
  });

  it('still holds every lease when the world begins, so none it lists has run out', () => {
    for (const router of routers()) {
      for (const row of leaseRows(router)) {
        expect(row.expiry, `${router.name} ${row.ip}`).toBeGreaterThan(EPOCH_SECONDS);
      }
    }
  });

  it('keeps its leases in the file its config names', () => {
    for (const router of routers()) {
      expect(settings(router, 'dhcp-leasefile'), router.name).toEqual([`/${LEASES_PATH}`]);
    }
  });

  it('granted its leases through the day, on a draw of its own', () => {
    const all = routers();
    const grants = all.flatMap((router) =>
      leaseRows(router).map((row) => row.expiry - leaseHours(router) * 60 * 60),
    );
    // Spread through the day rather than bunched at its end.
    expect(Math.max(...grants) - Math.min(...grants)).toBeGreaterThan(DAY_SECONDS / 2);
    // Each router draws on its own stream, so no position shares one term and one clock.
    for (const position of ['access point', 'inner', 'deep'] as const) {
      const firstGrants = all
        .filter((router) => router.position === position)
        .map((router) => leaseRows(router)[0]?.expiry);
      expect(new Set(firstGrants).size, position).toBeGreaterThan(1);
    }
  });

  it('lets anyone on the box read the leases and the config, and only root change them', () => {
    for (const router of routers()) {
      for (const path of [LEASES_PATH, CONFIG_PATH]) {
        const node = nodeAt(router.tree, path);
        expect(node?.perms.read, router.name).toEqual(['root', 'user', 'guest']);
        expect(node?.perms.write, router.name).toEqual(['root']);
      }
    }
  });
});

const MAC_TABLE_PATH = 'var/lib/switch/mac-table';

/** Every switch in the world, with the layer it fronts stated from the population the
 *  network generates. A switch forwards nothing onward, so its layer is one machine. */
const switches = () =>
  ALL_ESSIDS.flatMap((essid) =>
    chainLinks(essid)
      .filter((link) => link.host.kind === 'switch')
      .map((link) => {
        const layer = generateDeepLayer(essid, { machineId: link.machineId, kind: 'switch' });
        const tree = chainGatewayBaseFsForMachineId(essid, link.machineId);
        if (tree === null) throw new Error(`no tree for ${link.machineId}`);
        return {
          name: `${essid} ${link.host.ip}`,
          tree,
          inner: link.parentMachineId === null,
          host: layer.host,
          mac: hostMac(hostMachineId(layer.host, essid)),
        };
      }),
  );

/** The table's rows past its header: port, MAC, VLAN, then the port's description. */
const tableRows = (tree: Directory) =>
  contentAt(tree, MAC_TABLE_PATH)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [port = '', mac = '', vlan = '', ...description] = line.split(/\s+/);
      return { port, mac, vlan, description: description.join(' ') };
    });

describe('a switch knows the layer it fronts', () => {
  it('covers every inner and deep switch in the world', () => {
    expect(switches().some((device) => device.inner)).toBe(true);
    expect(switches().some((device) => !device.inner)).toBe(true);
  });

  it('lists exactly the machine on its layer, by the MAC every other table gives it', () => {
    for (const device of switches()) {
      expect(tableRows(device.tree).map((row) => row.mac), device.name).toEqual([device.mac]);
    }
  });

  it('describes each port by the name and address of the host plugged into it', () => {
    for (const device of switches()) {
      for (const row of tableRows(device.tree)) {
        expect(row.description, device.name).toBe(`${device.host.hostname} (${device.host.ip})`);
      }
    }
  });

  it('lets anyone on the box read the table, and only root change it', () => {
    for (const device of switches()) {
      const node = nodeAt(device.tree, MAC_TABLE_PATH);
      expect(node?.perms.read, device.name).toEqual(['root', 'user', 'guest']);
      expect(node?.perms.write, device.name).toEqual(['root']);
    }
  });

  it('names each port and VLAN the way the switch does, on a draw of its own', () => {
    const all = switches();
    for (const device of all) {
      for (const row of tableRows(device.tree)) {
        expect(row.port, device.name).toMatch(/^gi1\/0\/([1-9]|1\d|2[0-4])$/);
        expect(row.vlan, device.name).toMatch(/^\d+$/);
      }
    }
    for (const inner of [true, false]) {
      const ports = all
        .filter((device) => device.inner === inner)
        .map((device) => tableRows(device.tree)[0]?.port);
      expect(new Set(ports).size).toBeGreaterThan(1);
    }
  });

  it('hands out no addresses, because a switch runs no DHCP', () => {
    for (const device of switches()) {
      expect(nodeAt(device.tree, CONFIG_PATH), device.name).toBeUndefined();
      expect(nodeAt(device.tree, LEASES_PATH), device.name).toBeUndefined();
    }
  });
});

/** The ceiling on the access point's tree as it crosses the wire to a remote reader: the
 *  only gateway tree that is serialized, sent to every occupant who reads it. Measured at
 *  about 16 KB with the leases in, and set at double to leave room for the box's history
 *  without letting it grow unwatched. */
const AP_WIRE_CEILING = 32_768;

describe('what a gateway costs to carry', () => {
  it('keeps the access point small on the wire, at the most a reader can see', () => {
    for (const essid of ALL_ESSIDS) {
      const wire = JSON.stringify(serializeTree(filterTreeForRead(buildApGatewayBaseFs(essid), 'root')));
      expect(wire.length, essid).toBeLessThan(AP_WIRE_CEILING);
    }
  });

  it('fits every file a gateway knows of its network into the one signed write that saves it', async () => {
    const identity = generateIdentity();
    const sent: string[] = [];
    const patches = createPatchApi({
      identity,
      machineId: asMachineId(computeWorkstationId('deskbox', identity.publicKeyHex)),
      owner: 'operator',
      tier: 'user',
      fetchImpl: async (_url, init) => {
        sent.push(String(init?.body));
        return new Response('{}', { status: 200 });
      },
    });
    // The write's size is what the transport limits, and a file's escaped length is what
    // decides it, so the files hardest to carry are the ones sent.
    const files = [
      ...routers().flatMap((router) => [LEASES_PATH, CONFIG_PATH].map((path) => [router.name, router.tree, path] as const)),
      ...switches().map((device) => [device.name, device.tree, MAC_TABLE_PATH] as const),
    ];
    expect(files.length).toBeGreaterThan(0);
    const hardest = files
      .map(([name, tree, path]) => [`${name}:/${path}`, contentAt(tree, path)] as const)
      .sort(([, one], [, other]) => JSON.stringify(other).length - JSON.stringify(one).length)
      .slice(0, 20);

    for (const [path, content] of hardest) {
      await patches.write(asAbsPath(`/home/operator/${path.split('/').pop() ?? ''}`), content, {
        isNew: true,
      });
    }
    expect(sent).toHaveLength(hardest.length);
    sent.forEach((body, index) => {
      expect(
        signedEnvelopeSchema.safeParse(JSON.parse(body)).success,
        `${hardest[index]?.[0]}: ${JSON.stringify(hardest[index]?.[1]).length} escaped`,
      ).toBe(true);
    });
  });
});

describe('a gateway the network does not generate', () => {
  it('knows no segment, because none is behind it', () => {
    const [essid = ''] = ALL_ESSIDS;
    const router = buildDeepGatewayBaseFs(essid, 'no-such-gateway', 50);
    const device = buildDeepSwitchBaseFs(essid, 'no-such-gateway', 42);
    expect(nodeAt(router, CONFIG_PATH)).toBeUndefined();
    expect(nodeAt(router, LEASES_PATH)).toBeUndefined();
    expect(nodeAt(device, MAC_TABLE_PATH)).toBeUndefined();
  });
});
