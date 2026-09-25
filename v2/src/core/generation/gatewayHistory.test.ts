import { describe, expect, it } from 'vitest';
import { gatewayAdminIp } from './gatewayHistory';
import { buildApGatewayBaseFs } from './routerFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { chainLinks, machineIdForLanHost } from './lanTopology';
import { chainGatewayBaseFsForMachineId } from './lanHostIdentity';
import { isDeskMachine } from './npcHome';
import { roleOfHostname } from './pools/hostnames';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory, FileNode } from '../filesystem/types';
import { ALL_ESSIDS, softwareVersionsIn } from '../../test/worldContent';

const HISTORY_PATH = '/root/.bash_history';
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/** A gateway as the world places it: where it stands, and the tree it is built with. */
type Gateway = {
  readonly name: string;
  readonly essid: string;
  readonly machineId: string;
  readonly host: LanHost;
  /** Whether it stands on the home LAN (the access point and the Layer-1 gateways)
   *  rather than on a layer below it. */
  readonly onLan: boolean;
  readonly tree: Directory;
};

/** Every gateway on every network: the access point and each gateway down its chain,
 *  built inside each test that asks for them. */
const everyGateway = (): readonly Gateway[] =>
  ALL_ESSIDS.flatMap((essid) => {
    const accessPoint = generateHomeLan(essid).hosts.find((host) => host.ip.endsWith('.1'));
    if (accessPoint === undefined) throw new Error(`${essid} has no access point`);
    const chain = chainLinks(essid).map((link): Gateway => {
      const tree = chainGatewayBaseFsForMachineId(essid, link.machineId);
      if (tree === null) throw new Error(`no tree for ${link.machineId}`);
      return {
        name: `${essid} ${link.host.ip}`,
        essid,
        machineId: link.machineId,
        host: link.host,
        onLan: link.parentMachineId === null,
        tree,
      };
    });
    return [
      {
        name: `${essid} ${accessPoint.ip}`,
        essid,
        machineId: machineIdForLanHost(accessPoint, essid),
        host: accessPoint,
        onLan: true,
        tree: buildApGatewayBaseFs(essid),
      },
      ...chain,
    ];
  });

const nodeAt = (tree: Directory, path: string): FileNode | null =>
  createFsView(tree, { userType: 'root' }).stat(asAbsPath(path));

const historyOf = (gateway: Gateway): string => {
  const node = nodeAt(gateway.tree, HISTORY_PATH);
  if (node?.kind !== 'file') throw new Error(`${gateway.name} keeps no ${HISTORY_PATH}`);
  return node.content;
};

const adminOf = (gateway: Gateway): string => {
  const adminIp = gatewayAdminIp(gateway.essid, gateway.machineId);
  if (adminIp === undefined) throw new Error(`${gateway.name} has no admin`);
  return adminIp;
};

/** The machines a LAN gateway's admin may sit at, best first: a desk machine, then a
 *  person's own device (a phone or a tablet), then any machine on the LAN. */
const adminCandidates = (essid: string): readonly (readonly LanHost[])[] => {
  const machines = generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');
  return [
    machines.filter(isDeskMachine),
    machines.filter((host) => roleOfHostname(host.hostname) === 'workstation'),
    machines,
  ];
};

/** Every address the gateway's own network files state: the leases and reservations a
 *  router hands out, or the host on a switch's port. */
const addressesItKnows = (gateway: Gateway): ReadonlySet<string> =>
  new Set(
    ['/var/lib/misc/dnsmasq.leases', '/etc/dnsmasq.conf', '/var/lib/switch/mac-table'].flatMap(
      (path) => {
        const node = nodeAt(gateway.tree, path);
        return node?.kind === 'file'
          ? node.content
              .split('\n')
              .filter((line) => !line.startsWith('dhcp-range='))
              .flatMap((line) => line.match(IPV4) ?? [])
          : [];
      },
    ),
  );

describe('who administers a gateway', () => {
  it('runs a LAN gateway from a desk machine on its LAN, else a phone or tablet, else any machine', () => {
    for (const gateway of everyGateway().filter(({ onLan }) => onLan)) {
      const adminIp = adminOf(gateway);
      const tier = adminCandidates(gateway.essid).find((hosts) => hosts.length > 0) ?? [];
      expect(
        tier.map((host) => host.ip),
        `${gateway.name} is run from ${adminIp}`,
      ).toContain(adminIp);
    }
  });

  it('runs a gateway below the LAN from its parent, at the first address of the layer it stands on', () => {
    const deep = everyGateway().filter(({ onLan }) => !onLan);
    expect(deep.length).toBeGreaterThan(0);
    for (const gateway of deep) {
      const layer = gateway.host.ip.split('.').slice(0, 3).join('.');
      expect(adminOf(gateway), gateway.name).toBe(`${layer}.1`);
    }
  });

  it('draws the admin per gateway, so a LAN is not always run from one desk', () => {
    const lanAdmins = ALL_ESSIDS.map((essid) =>
      new Set(
        everyGateway()
          .filter((gateway) => gateway.essid === essid && gateway.onLan)
          .map(adminOf),
      ),
    );
    expect(lanAdmins.some((admins) => admins.size > 1)).toBe(true);
  });

  it('knows no admin for a gateway the network does not generate', () => {
    const [essid = ''] = ALL_ESSIDS;
    expect(gatewayAdminIp(essid, 'no-such-gateway')).toBeUndefined();
  });
});

describe("root's shell history on a gateway", () => {
  it('is kept on every gateway, readable and writable by root alone', () => {
    for (const gateway of everyGateway()) {
      const node = nodeAt(gateway.tree, HISTORY_PATH);
      expect(node?.kind, gateway.name).toBe('file');
      expect(node?.perms.read, gateway.name).toEqual(['root']);
      expect(node?.perms.write, gateway.name).toEqual(['root']);
      expect(nodeAt(gateway.tree, '/root')?.perms.read, gateway.name).toEqual(['root']);
    }
  });

  it("names the admin's own machine", () => {
    for (const gateway of everyGateway()) {
      expect(historyOf(gateway).match(IPV4) ?? [], gateway.name).toContain(adminOf(gateway));
    }
  });

  it('names no host but the admin and the hosts the gateway itself lists', () => {
    for (const gateway of everyGateway()) {
      const known = new Set([adminOf(gateway), ...addressesItKnows(gateway)]);
      for (const address of historyOf(gateway).match(IPV4) ?? []) {
        expect(known.has(address), `${gateway.name} names ${address}`).toBe(true);
      }
    }
  });

  it('names only paths the gateway holds', () => {
    for (const gateway of everyGateway()) {
      const paths = historyOf(gateway).match(/(?<=^|\s|<)\/[\w./-]+/gm) ?? [];
      for (const path of paths) {
        expect(nodeAt(gateway.tree, path), `${gateway.name} names ${path}`).not.toBeNull();
      }
    }
  });

  it("works on what the gateway is: its own config, and a host its network files list", () => {
    for (const gateway of everyGateway()) {
      const history = historyOf(gateway);
      const config =
        gateway.host.kind === 'router' ? '/etc/iptables/rules.v4' : '/etc/switch/acl.conf';
      expect(history, gateway.name).toContain(config);
      const known = addressesItKnows(gateway);
      expect(
        (history.match(IPV4) ?? []).some((address) => known.has(address)),
        `${gateway.name} reaches none of its hosts`,
      ).toBe(true);
    }
  });

  it('names no software version, since only the package manifest dates a box', () => {
    for (const gateway of everyGateway()) {
      expect(softwareVersionsIn(historyOf(gateway)), gateway.name).toEqual([]);
    }
  });

  it('differs from gateway to gateway', () => {
    const histories = everyGateway().map(historyOf);
    expect(new Set(histories).size).toBe(histories.length);
  });

  it('is one command to a line, ending in a newline', () => {
    for (const gateway of everyGateway()) {
      const history = historyOf(gateway);
      expect(history.endsWith('\n'), gateway.name).toBe(true);
      expect(history.split('\n').slice(0, -1), gateway.name).not.toContain('');
    }
  });
});
