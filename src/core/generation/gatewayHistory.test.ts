import { describe, expect, it } from 'vitest';
import { gatewayAdminIp, gatewayRootHistory } from './gatewayHistory';
import { GATEWAY_ROOT_HISTORY } from './pools/rootContent';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { isDeskMachine } from './npcHome';
import { roleOfHostname } from './pools/hostnames';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory, FileNode } from '../filesystem/types';
import {
  ALL_ESSIDS,
  gatewaysOn,
  softwareVersionsIn,
  type Gateway,
} from '../../test/worldContent';

const HISTORY_PATH = '/root/.bash_history';
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

const everyGateway = (): readonly Gateway[] => gatewaysOn(ALL_ESSIDS);

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
    const gateways = everyGateway();
    const lanAdmins = ALL_ESSIDS.map((essid) =>
      new Set(
        gateways.filter((gateway) => gateway.essid === essid && gateway.onLan).map(adminOf),
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
      for (const line of history.split('\n').slice(0, -1)) {
        expect(line, `${gateway.name}: ${JSON.stringify(line)}`).toMatch(/^[a-z]/);
        expect(line, gateway.name).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it('controls only the daemons that run on it, and somewhere in the world controls each', () => {
    const controlled = new Set<string>();
    for (const gateway of everyGateway()) {
      for (const line of historyOf(gateway).split('\n').filter((row) => row.startsWith('systemctl'))) {
        expect(line, gateway.name).toMatch(/^systemctl (status|restart) \S+$/);
      }
      for (const [, daemon = ''] of historyOf(gateway).matchAll(/^systemctl (?:status|restart) (\S+)$/gm)) {
        controlled.add(daemon);
        expect(nodeAt(gateway.tree, `/var/run/${daemon}.pid`), `${gateway.name} ${daemon}`).not.toBeNull();
      }
    }
    expect([...controlled].sort()).toEqual(['snmpd', 'sshd']);
  });

  it('reads what the box keeps somewhere in the world: its network state, its agent and its logs', () => {
    const histories = everyGateway().map(historyOf).join('\n');
    for (const path of [
      '/etc/dnsmasq.conf',
      '/var/lib/misc/dnsmasq.leases',
      '/var/lib/switch/mac-table',
      '/etc/snmp/snmpd.conf',
      '/var/lib/snmp/snmpd.conf',
    ]) {
      expect(histories, path).toMatch(new RegExp(`^(cat|less|nano) ${path}$`, 'm'));
    }
    for (const reader of ['tail', 'tail -f', 'less', 'grep -i error']) {
      expect(histories, reader).toMatch(new RegExp(`^${reader} /var/log/\\S+$`, 'm'));
    }
  });

  it('names no admin on a gateway the network does not generate', () => {
    const history = gatewayRootHistory({
      machineId: 'no-such-gateway',
      site: undefined,
      deviceConfig: {},
      otherConfig: {},
      state: {},
      logs: {},
      daemons: [],
      hosts: [],
    });
    // With nothing of its own to name, all it keeps is its admin's habits.
    for (const line of history.trimEnd().split('\n')) expect(GATEWAY_ROOT_HISTORY).toContain(line);
  });
});

const rotatedLog = (gateway: Gateway, name: string): string | null => {
  const node = nodeAt(gateway.tree, `/var/log/${name}`);
  return node?.kind === 'file' ? node.content : null;
};

const linesOf = (content: string | null): readonly string[] =>
  (content ?? '').split('\n').filter((line) => line !== '');

/** A second of the epoch as the syslog stamp it is logged under. */
const syslogStamp = (epochSeconds: number): string => {
  const time = new Date(epochSeconds * 1000).toISOString();
  return `Jul ${time.slice(8, 10)} ${time.slice(11, 19)}`;
};

describe('what a gateway remembers of its last day', () => {
  it('logs its admin in over ssh that day, from their own machine and nowhere else', () => {
    for (const gateway of everyGateway()) {
      const auth = linesOf(rotatedLog(gateway, 'auth.log.1'));
      const logins = auth.flatMap((line) => /Accepted password for root from (\S+)/.exec(line)?.[1] ?? []);
      expect(logins.length, gateway.name).toBeGreaterThan(0);
      expect(new Set(logins), gateway.name).toEqual(new Set([adminOf(gateway)]));
      const opened = auth.filter((line) => line.includes('session opened for user root'));
      const closed = auth.filter((line) => line.includes('session closed for user root'));
      expect(opened.length, gateway.name).toBe(logins.length);
      expect(closed.length, gateway.name).toBe(logins.length);
      for (const line of [...opened, ...closed]) {
        expect(line, gateway.name).toMatch(/ sshd\[\d+\]: pam_unix\(sshd:session\)/);
      }
    }
  });

  it('acknowledges every lease a router holds, at the second it was granted', () => {
    const routers = everyGateway().filter(({ host }) => host.kind === 'router');
    for (const gateway of routers) {
      const config = nodeAt(gateway.tree, '/etc/dnsmasq.conf');
      const leases = nodeAt(gateway.tree, '/var/lib/misc/dnsmasq.leases');
      if (config?.kind !== 'file' || leases?.kind !== 'file') throw new Error(gateway.name);
      const leaseHours = Number(/^dhcp-range=.*,(\d+)h$/m.exec(config.content)?.[1]);
      const syslog = linesOf(rotatedLog(gateway, 'syslog.1'));
      const acks = syslog.filter((line) => line.includes('DHCPACK('));
      const rows = linesOf(leases.content);
      expect(acks.length, gateway.name).toBe(rows.length);
      for (const row of rows) {
        const [expiry = '', mac = '', ip = '', hostname = ''] = row.split(' ');
        const granted = Number(expiry) - leaseHours * 3600;
        expect(
          syslog.some(
            (line) =>
              line.startsWith(`${syslogStamp(granted)} `) &&
              line.endsWith(`DHCPACK(br-lan) ${ip} ${mac} ${hostname}`),
          ),
          `${gateway.name} acknowledges ${ip}`,
        ).toBe(true);
        const request = syslog.findIndex((line) => line.endsWith(`DHCPREQUEST(br-lan) ${ip} ${mac}`));
        const ack = syslog.findIndex((line) => line.includes(`DHCPACK(br-lan) ${ip} `));
        expect(request, `${gateway.name} asked for ${ip}`).toBeGreaterThanOrEqual(0);
        expect(request, `${gateway.name} asked for ${ip} first`).toBeLessThan(ack);
        expect(syslog[request], gateway.name).toContain(`${syslogStamp(granted)} `);
        expect(syslog[request], gateway.name).toMatch(/ dnsmasq-dhcp\[\d+\]: /);
        expect(syslog[ack], gateway.name).toMatch(/ dnsmasq-dhcp\[\d+\]: /);
      }
    }
  });

  it("opens syslog.1 with the morning's log rotation, which is what emptied the live logs", () => {
    for (const gateway of everyGateway()) {
      const syslog = linesOf(rotatedLog(gateway, 'syslog.1'));
      expect(syslog[0], gateway.name).toMatch(/^Jul 11 00:00:0\d \S+ systemd\[1\]: Starting Rotate log files\.\.\.$/);
      expect(syslog, gateway.name).toContainEqual(
        expect.stringMatching(/ systemd\[1\]: logrotate\.service: Deactivated successfully\.$/),
      );
      expect(syslog, gateway.name).toContainEqual(
        expect.stringMatching(/ systemd\[1\]: Finished Rotate log files\.$/),
      );
    }
  });

  it('hands out no address from a switch', () => {
    for (const gateway of everyGateway().filter(({ host }) => host.kind === 'switch')) {
      expect(rotatedLog(gateway, 'syslog.1') ?? '', gateway.name).not.toContain('dnsmasq');
    }
  });

  it("keeps an snmpd.log.1 exactly where the agent runs, polled from the admin's machine", () => {
    let polled = 0;
    for (const gateway of everyGateway()) {
      const runsAgent = nodeAt(gateway.tree, '/var/run/snmpd.pid') !== null;
      const log = rotatedLog(gateway, 'snmpd.log.1');
      expect(log !== null, gateway.name).toBe(runsAgent);
      if (log === null) continue;
      polled += 1;
      const clients = [...log.matchAll(/UDP: \[([\d.]+)\]/g)].map(([, client]) => client);
      expect(clients.length, gateway.name).toBeGreaterThan(0);
      expect(new Set(clients), gateway.name).toEqual(new Set([adminOf(gateway)]));
      expect(log, gateway.name).not.toContain('failure');
    }
    expect(polled).toBeGreaterThan(0);
  });

  it('keeps a kern.log.1 of links that went down that day, each coming back up', () => {
    for (const gateway of everyGateway()) {
      const kernel = linesOf(rotatedLog(gateway, 'kern.log.1'));
      expect(kernel.length, gateway.name).toBeGreaterThan(0);
      const down = kernel.flatMap((line) => /kernel: (\w+): link down$/.exec(line)?.[1] ?? []);
      const up = kernel.flatMap((line) => /kernel: (\w+): link up\b/.exec(line)?.[1] ?? []);
      expect(down.length, gateway.name).toBeGreaterThan(0);
      expect(up, gateway.name).toEqual(down);
    }
  });

  it('keeps no rotated access log, since nothing on a gateway served the web', () => {
    for (const gateway of everyGateway()) {
      expect(rotatedLog(gateway, 'access.log.1'), gateway.name).toBeNull();
    }
  });
});
