import { describe, expect, it } from 'vitest';
import { relationsFrom, relationsTo, type Login, type Relation } from './relations.js';
import {
  DECLARED_NETWORKS,
  PLACELESS_FIRST_OCTET,
  publicAddress,
  REGION_FIRST_OCTETS,
  RIDGEMONT,
} from './world.js';
import { deepBoxes, gatewaysOn, lanBoxes } from '../../test/worldContent.js';
import { buildDeepHostFs } from './deepHostFs.js';
import { chainLinks } from './lanTopology.js';
import { generateDeepLayer } from './generateDeepLayer.js';
import type { Directory } from '../filesystem/types.js';
import { generateHomeLan } from './generateHomeLan.js';
import { hostServices, npcUsername } from './remoteHostFs.js';
import { seededForwards } from './seededForwards.js';
import { isDeskMachine } from './npcHome.js';
import { roleOfHostname } from './pools/hostnames.js';
import { DEBIAN_CRONTAB_HEADER } from './pools/etcFiles.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { walkTree } from '../filesystem/walkTree.js';
import type { LanHost } from './generateHomeLan.js';

/**
 * Nothing on the internet leads to a home: it publishes nothing and no search finds it.
 * The businesses of its town know where it is. An IT contractor keeps a shortcut to
 * each client it looks after, and a shop that backs its files up offsite copies them to
 * somebody's box every night. Those are the only leads to a home, so every home is the
 * client of at least one business, and every lead names a door that really opens.
 */

const millbrook = DECLARED_NETWORKS.filter((network) => network.town === 'Millbrook');

/** Every relation in Millbrook, each once, from the side it is drawn on. */
const allRelations = (): readonly Relation[] =>
  millbrook.flatMap((network) => relationsTo(network.key));

/** Every lead to `key` that logs in there, leaving out a supplier's invoice. */
const loginsTo = (key: string): readonly Login[] =>
  relationsTo(key).filter((relation): relation is Login => relation.kind !== 'supplier');

/** Every lead in Millbrook that logs in where it leads. */
const allLogins = (): readonly Login[] => millbrook.flatMap((network) => loginsTo(network.key));

/** The ssh a gateway forwards to a box behind it, if it forwards one. */
const sshForwardOf = (key: string) =>
  seededForwards(key).find((forward) => {
    const host = generateHomeLan(key).hosts.find(
      (candidate) => candidate.ip === forward.internalIp,
    );
    return (
      host !== undefined &&
      hostServices(key, host).some(
        ({ spec, port }) => spec.service === 'ssh' && port === forward.internalPort,
      )
    );
  });

describe("a Millbrook network's relations", () => {
  it('logs in at every home from one to three businesses, and at a business from at most two', () => {
    const counts = millbrook.map((network) => ({
      key: network.key,
      inRange:
        network.category === 'residential'
          ? loginsTo(network.key).length >= 1 && loginsTo(network.key).length <= 3
          : loginsTo(network.key).length <= 2,
    }));

    expect(counts).toEqual(millbrook.map(({ key }) => ({ key, inRange: true })));
  });

  it('comes only from a site of the same town that publishes, never from the network it leads to', () => {
    const publishers = millbrook
      .filter((network) => network.site !== undefined)
      .map((network) => network.key);
    for (const relation of allRelations()) {
      expect(publishers, relation.source).toContain(relation.source);
      expect(relation.source).not.toBe(relation.target);
    }
  });

  it("keeps a contractor's shortcuts on a desk of an office's own LAN", () => {
    const contractors = allLogins().filter((relation) => relation.kind === 'contractor');
    expect(contractors.length).toBeGreaterThan(0);
    for (const relation of contractors) {
      const source = millbrook.find((network) => network.key === relation.source);
      expect(source?.category).toBe('corporate');
      expect(generateHomeLan(relation.source).hosts).toContainEqual(relation.sourceHost);
      expect(isDeskMachine(relation.sourceHost), relation.sourceHost.hostname).toBe(true);
    }
  });

  it("backs up a file server of the source's own LAN to a box the target forwards ssh to", () => {
    const backups = allLogins().filter((relation) => relation.kind === 'backup');
    expect(backups.length).toBeGreaterThan(0);
    for (const relation of backups) {
      expect(generateHomeLan(relation.source).hosts).toContainEqual(relation.sourceHost);
      expect(roleOfHostname(relation.sourceHost.hostname)).toBe('fileserver');
      const forward = sshForwardOf(relation.target);
      expect(forward, relation.target).toBeDefined();
      expect(relation.port).toBe(forward?.publicPort);
      expect(relation.targetHost.ip).toBe(forward?.internalIp);
    }
  });

  it('backs a business up to a home alone, and to every home that lets ssh in from outside', () => {
    for (const relation of allLogins().filter((each) => each.kind === 'backup')) {
      const target = millbrook.find((network) => network.key === relation.target);
      expect(target?.category, relation.target).toBe('residential');
    }
    const reachableHomes = millbrook.filter(
      (network) => network.category === 'residential' && sshForwardOf(network.key) !== undefined,
    );
    expect(reachableHomes.length).toBeGreaterThan(0);
    for (const home of reachableHomes) {
      expect(
        relationsTo(home.key).some((relation) => relation.kind === 'backup'),
        home.essid,
      ).toBe(true);
    }
  });

  it('names the address the target answers at and a port that opens there onto an account that exists', () => {
    for (const relation of allRelations()) {
      expect(relation.address).toBe(publicAddress(relation.target));
    }
    for (const relation of allLogins()) {
      const forward = sshForwardOf(relation.target);
      if (forward === undefined) {
        // Nothing behind the gateway is reachable over ssh, so the lead is to the gateway
        // itself, whose sshd answers on 22 and knows only root.
        expect(relation).toMatchObject({ port: 22, user: 'root' });
        expect(relation.targetHost).toEqual(generateHomeLan(relation.target).hosts[0]);
      } else {
        expect(relation.port).toBe(forward.publicPort);
        expect(relation.targetHost.ip).toBe(forward.internalIp);
        expect(relation.user).toBe(npcUsername(relation.target, relation.targetHost));
      }
    }
  });

  it('is the same relation from either side', () => {
    const fromSources = millbrook.flatMap((network) => relationsFrom(network.key));
    expect([...fromSources].sort(byEnds)).toEqual([...allRelations()].sort(byEnds));
  });

  it('leads nowhere from or to a network the world does not declare', () => {
    expect(relationsTo('Linksys-Kitchen')).toEqual([]);
    expect(relationsFrom('Linksys-Kitchen')).toEqual([]);
  });

  it('leads nowhere from or to Ridgemont', () => {
    for (const network of DECLARED_NETWORKS.filter((each) => each.town === RIDGEMONT)) {
      expect(relationsTo(network.key), network.key).toEqual([]);
      expect(relationsFrom(network.key), network.key).toEqual([]);
    }
  });

  it('is pinned (golden): locks the relations- stream, its counts and its picks', () => {
    const essidOf = (key: string) => millbrook.find((network) => network.key === key)?.essid;
    const graph = allRelations().map(
      (relation) =>
        `${essidOf(relation.source)} ${relation.sourceHost.hostname} -${relation.kind}-> ` +
        `${essidOf(relation.target)}` +
        (relation.kind === 'supplier'
          ? ''
          : ` ${relation.user}@${relation.targetHost.hostname}:${relation.port}`),
    );

    expect(graph).toEqual([
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> TOWN-HALL-WIFI hkim@android-57:2222',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> MILLBROOK-PD root@net-gateway:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> LIBRARY-PUBLIC root@dist-rtr:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> TIPSY-TEAPOT root@gw-main:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> HARVEST-MARKET root@core-rtr:22',
      'PINNACLE-IT-SOLUTIONS share-16 -supplier-> HARVEST-MARKET',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> GREENLEAF-GROCERS root@firewall01:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> KOWALSKI-WIFI root@pfsense01:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> THE-HARGREAVES root@core-rtr:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> GARDEN-FLAT root@mikrotik01:22',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> ROSE-COTTAGE root@switch-core:22',
      'PINNACLE-IT-SOLUTIONS share-16 -backup-> PEAR-TREE-HOUSE mrodriguez@laptop-13:2222',
      'KEYSTONE-LOGISTICS workstation-33 -contractor-> OKONKWO-FAMILY root@firewall01:22',
    ]);
  });
});

/** The file at `path` on `host` of `key`, read as root, or `undefined` where there is none. */
const fileOn = (key: string, host: LanHost, path: string): string | undefined => {
  const read = createFsView(resolveLanHostIdentity(host, key).baseFs, { userType: 'root' }).read(
    asAbsPath(path),
  );
  return read.ok ? read.content : undefined;
};

describe("an IT contractor's shortcuts", () => {
  const contractors = () => allLogins().filter((relation) => relation.kind === 'contractor');

  /** Where the person at the contractor's desk keeps their `.ssh/`. */
  const sshDirOf = (relation: Relation) =>
    `/home/${npcUsername(relation.source, relation.sourceHost)}/.ssh`;

  it("names each client in the desk owner's ssh config, by its wifi, at its address, as its account", () => {
    expect(contractors().length).toBeGreaterThan(0);
    for (const relation of contractors()) {
      const config = fileOn(relation.source, relation.sourceHost, `${sshDirOf(relation)}/config`);
      const name = millbrook.find((network) => network.key === relation.target)?.essid;
      const portLine = relation.port === 22 ? '' : `    Port ${relation.port}\n`;
      // One block a host, each running up to the blank line before the next `Host`.
      const blocks = (config ?? '').split(/\n(?=Host )/);
      expect(blocks, relation.target).toContain(
        `Host ${name?.toLowerCase()}\n    HostName ${relation.address}\n    User ${relation.user}\n${portLine}`,
      );
    }
  });

  it('is pinned (golden): locks the relation-host-key- stream, the key a client box shows', () => {
    const police = contractors().find((relation) => relation.address === '87.98.97.142');
    if (police === undefined) throw new Error('the contractor does not look after the police');
    const knownHosts = fileOn(police.source, police.sourceHost, `${sshDirOf(police)}/known_hosts`);
    expect((knownHosts ?? '').split('\n')).toContain(
      '87.98.97.142 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI3hcZjj2Ws/q9qo+Q3piRjwZX74KNM1wRa4S0kEh3ise',
    );
  });

  it('has met every client over ssh, at the address and port it connects to', () => {
    for (const relation of contractors()) {
      const knownHosts = fileOn(
        relation.source,
        relation.sourceHost,
        `${sshDirOf(relation)}/known_hosts`,
      );
      const names =
        relation.port === 22 ? relation.address : `[${relation.address}]:${relation.port}`;
      const lines = (knownHosts ?? '').split('\n');
      expect(
        lines.some(
          (line) => /^\S+ ssh-ed25519 AAAA\S+$/.test(line) && line.startsWith(`${names} `),
        ),
        relation.target,
      ).toBe(true);
    }
  });

  it('keeps no shortcut to a client on any other box of the office', () => {
    for (const relation of contractors()) {
      const others = generateHomeLan(relation.source).hosts.filter(
        (host) => host.kind === 'machine' && host.ip !== relation.sourceHost.ip,
      );
      for (const host of others) {
        const home = `/home/${npcUsername(relation.source, host)}/.ssh`;
        for (const path of [`${home}/config`, `${home}/known_hosts`, '/root/.ssh/known_hosts']) {
          expect(
            fileOn(relation.source, host, path) ?? '',
            `${host.hostname} ${path}`,
          ).not.toContain(relation.address);
        }
      }
    }
  });
});

/** Every file under `path` on `host` of `key`, by its path beneath `path`. */
const filesUnder = (key: string, host: LanHost, path: string): ReadonlyMap<string, string> => {
  const fs = createFsView(resolveLanHostIdentity(host, key).baseFs, { userType: 'root' });
  return new Map(
    walkTree(fs, asAbsPath(path), (filePath, node) =>
      node.kind === 'file' ? [[filePath.slice(path.length), node.content ?? ''] as const] : [],
    ),
  );
};

describe("a business's offsite backup", () => {
  const backups = () => allLogins().filter((relation) => relation.kind === 'backup');

  /** The job the source's crontab runs, as it would be typed. */
  const commandOf = (relation: Login) => {
    const name = millbrook.find((network) => network.key === relation.source)?.essid;
    return (
      `rsync -az /srv/ ${relation.user}@${relation.address}:backups/${name?.toLowerCase()}/ ` +
      `-e 'ssh -p ${relation.port}'`
    );
  };

  it("runs nightly from the file server's crontab, as root, to the home's address and port", () => {
    expect(backups().length).toBeGreaterThan(0);
    for (const relation of backups()) {
      const jobs = (fileOn(relation.source, relation.sourceHost, '/etc/crontab') ?? '')
        .split('\n')
        .filter((line) => line.endsWith(`\troot\t${commandOf(relation)}`));
      expect(jobs, relation.source).toHaveLength(1);
      expect(jobs[0]).toMatch(/^\d{1,2} [0-5]\t\* \* \*\t/);
    }
  });

  it('shows in the rotated syslog as run on the last day, and leaves root no mail', () => {
    for (const relation of backups()) {
      const syslog = fileOn(relation.source, relation.sourceHost, '/var/log/syslog.1') ?? '';
      expect(syslog.split('\n'), relation.source).toContain(
        `Jul 11 01:11:00 share-16 CRON[94770]: (root) CMD (${commandOf(relation)})`,
      );
      const mail = fileOn(relation.source, relation.sourceHost, '/var/mail/root') ?? '';
      expect(mail, relation.source).not.toContain('rsync');
    }
  });

  it("leaves a copy of the file server's share in the home account's backups, file for file", () => {
    for (const relation of backups()) {
      const name = millbrook.find((network) => network.key === relation.source)?.essid;
      const share = filesUnder(relation.source, relation.sourceHost, '/srv');
      const copy = filesUnder(
        relation.target,
        relation.targetHost,
        `/home/${relation.user}/backups/${name?.toLowerCase()}`,
      );
      expect(share.size, relation.source).toBeGreaterThan(0);
      expect(copy).toEqual(share);
    }
  });

  it('keeps the copy where the account it came in as can read it', () => {
    for (const relation of backups()) {
      const name = millbrook.find((network) => network.key === relation.source)?.essid;
      const fs = createFsView(resolveLanHostIdentity(relation.targetHost, relation.target).baseFs, {
        userType: 'root',
      });
      const owners = walkTree(fs, asAbsPath(`/home/${relation.user}/backups`), (_, node) => [
        node.owner,
      ]);
      expect(owners.length, name).toBeGreaterThan(0);
      expect(new Set(owners)).toEqual(new Set([relation.user]));
    }
  });

  it('is pinned (golden): locks the relation-cron- stream, the time of night the job runs', () => {
    const [relation] = backups();
    if (relation === undefined) throw new Error('Millbrook backs nothing up');
    const jobs = (fileOn(relation.source, relation.sourceHost, '/etc/crontab') ?? '')
      .split('\n')
      .filter((line) => line.includes('rsync'));
    expect(jobs).toEqual([`11 1\t* * *\troot\t${commandOf(relation)}`]);
  });

  it('runs on no box of the town but a file server that backs its share up', () => {
    const sources = backups().map((relation) => `${relation.source} ${relation.sourceHost.ip}`);
    for (const network of millbrook) {
      for (const host of generateHomeLan(network.key).hosts.filter(
        (candidate) => candidate.kind === 'machine',
      )) {
        const label = `${network.essid} ${host.hostname}`;
        const crontab = fileOn(network.key, host, '/etc/crontab') ?? '';
        const runsBackup = sources.includes(`${network.key} ${host.ip}`);
        expect(crontab.includes('rsync'), label).toBe(runsBackup);
        // Whatever else it holds is Debian's header and one job a line, as cron reads it.
        expect(crontab.startsWith(DEBIAN_CRONTAB_HEADER), label).toBe(true);
        expect(crontab.endsWith('\n'), label).toBe(true);
        for (const job of crontab.slice(DEBIAN_CRONTAB_HEADER.length).split('\n').slice(0, -1)) {
          expect(job, label).toMatch(/^\S+ \S+\t\S+ \S+ \S+\troot\t\S/);
        }
      }
    }
  });

  it('keeps copies on no box of the town but the one a backup logs in to', () => {
    const targets = backups().map((relation) => `${relation.target} ${relation.targetHost.ip}`);
    for (const network of millbrook) {
      for (const host of generateHomeLan(network.key).hosts.filter(
        (candidate) => candidate.kind === 'machine',
      )) {
        const home = `/home/${npcUsername(network.key, host)}`;
        const read = createFsView(resolveLanHostIdentity(host, network.key).baseFs, {
          userType: 'root',
        }).list(asAbsPath(`${home}/backups`));
        const folders = read.ok ? [...read.entries].sort() : null;
        const expected = backups()
          .filter(
            (relation) =>
              `${relation.target} ${relation.targetHost.ip}` === `${network.key} ${host.ip}`,
          )
          .map((relation) =>
            millbrook.find((each) => each.key === relation.source)?.essid.toLowerCase(),
          );
        expect(folders, `${network.essid} ${host.hostname}`).toEqual(
          targets.includes(`${network.key} ${host.ip}`) ? expected : null,
        );
      }
    }
  });

  it('keeps no copy on any other box of the home', () => {
    for (const relation of backups()) {
      const others = generateHomeLan(relation.target).hosts.filter(
        (host) => host.kind === 'machine' && host.ip !== relation.targetHost.ip,
      );
      for (const host of others) {
        const home = `/home/${npcUsername(relation.target, host)}/backups`;
        expect(filesUnder(relation.target, host, home).size, host.hostname).toBe(0);
      }
    }
  });
});

/**
 * A box beyond Ridgemont may name another network: that is how a lead reads. It names
 * one only where a relation of its own network leads, and nothing on a LAN it does not
 * stand on. A backup copy is its source's files, so it is read as its source's.
 */
describe("an unlisted business's supplier lead", () => {
  const supplies = () => allRelations().filter((relation) => relation.kind === 'supplier');

  /** Whether `key`'s site is on its town's directory, which is how an unlisted
   *  institution is found. */
  const onDirectory = (key: string) => {
    const domain = millbrook.find((network) => network.key === key)?.site?.domain;
    return millbrook.some((network) =>
      (network.directory ?? []).some((site) => site.domain === domain),
    );
  };

  /** The invoices `relation`'s customer keeps on its share, by file name. */
  const invoicesOf = (relation: Relation) =>
    filesUnder(relation.source, relation.sourceHost, '/srv/share/invoices/');

  it('leads to every unlisted business, and to nothing else', () => {
    const unlistedBusinesses = millbrook.filter(
      (network) => network.unlisted === true && !onDirectory(network.key),
    );
    expect(unlistedBusinesses.length).toBeGreaterThan(0);
    for (const network of unlistedBusinesses) {
      expect(
        relationsTo(network.key).some((relation) => relation.kind === 'supplier'),
        network.essid,
      ).toBe(true);
    }
    for (const relation of supplies()) {
      expect(unlistedBusinesses.map((network) => network.key)).toContain(relation.target);
    }
  });

  it('is kept by a listed publisher, on a file server that keeps a working share', () => {
    expect(supplies().length).toBeGreaterThan(0);
    for (const relation of supplies()) {
      const source = millbrook.find((network) => network.key === relation.source);
      expect(source?.site, relation.source).toBeDefined();
      expect(source?.unlisted, relation.source).toBeUndefined();
      expect(generateHomeLan(relation.source).hosts).toContainEqual(relation.sourceHost);
      expect(filesUnder(relation.source, relation.sourceHost, '/srv/share/').size).toBeGreaterThan(
        0,
      );
    }
  });

  it("leaves its invoice on the customer's share, naming the supplier by its site and domain", () => {
    for (const relation of supplies()) {
      const site = millbrook.find((network) => network.key === relation.target)?.site;
      const invoices = [...invoicesOf(relation).values()].filter(
        (content) => content.includes(site?.domain ?? '') && content.includes(site?.name ?? ''),
      );
      expect(invoices, relation.target).toHaveLength(1);
    }
  });

  it('is pinned (golden): locks the relation-invoice- stream, the invoice the customer keeps', () => {
    const [relation] = supplies();
    if (relation === undefined) throw new Error('Millbrook has no supplier');
    expect([...invoicesOf(relation)]).toEqual([
      [
        'harvest-market-7123.txt',
        [
          'INVOICE 7123',
          '',
          'From: Harvest Market',
          '      harvestmarket.com',
          'To:   Pinnacle IT Solutions',
          '',
          'Date: 2026-07-04',
          'Payment due within 30 days.',
          '',
          'Goods supplied, as ordered    2217.00',
          'TOTAL DUE                     2217.00',
          '',
        ].join('\n'),
      ],
    ]);
    // Filed in office hours on the day it is dated, from the desk of whoever filed it.
    const log = fileOn(relation.source, relation.sourceHost, '/var/log/vsftpd.log.1') ?? '';
    expect(log.split('\n')).toContain(
      'Sat Jul  4 16:08:15 2026 [pid 65126] [nasadmin] OK UPLOAD: Client "192.168.10.57", ' +
        '"/srv/share/invoices/harvest-market-7123.txt", 210 bytes',
    );
  });

  it('keeps no invoice from the supplier on any other box of the town', () => {
    const kept = supplies().map((relation) => `${relation.source} ${relation.sourceHost.ip}`);
    for (const network of millbrook) {
      for (const host of generateHomeLan(network.key).hosts.filter(
        (candidate) => candidate.kind === 'machine',
      )) {
        const invoices = filesUnder(network.key, host, '/srv/share/invoices/');
        expect(invoices.size > 0, `${network.essid} ${host.hostname}`).toBe(
          kept.includes(`${network.key} ${host.ip}`),
        );
      }
    }
  });

  it('records the invoice arriving on the share, like every other file there', () => {
    for (const relation of supplies()) {
      const log = fileOn(relation.source, relation.sourceHost, '/var/log/vsftpd.log.1') ?? '';
      for (const name of invoicesOf(relation).keys()) {
        expect(log, name).toContain(`/srv/share/invoices/${name}`);
      }
    }
  });
});

describe('what a Millbrook box names beyond its own network', () => {
  const keys = millbrook.map((network) => network.key);

  /** Every box of `keys`, with the tree it is built with. */
  const boxes = () => [
    ...lanBoxes(keys).map(({ essid, host }) => ({
      essid,
      name: host.hostname,
      tree: resolveLanHostIdentity(host, essid).baseFs,
    })),
    ...deepBoxes(keys).map(({ essid, host }) => ({
      essid,
      name: host.hostname,
      tree: buildDeepHostFs(essid, host),
    })),
    ...gatewaysOn(keys).map((gateway) => ({
      essid: gateway.essid,
      name: gateway.name,
      tree: gateway.tree,
    })),
  ];

  /** Every file on `tree`, each with the network whose facts it states: a backup copy's
   *  are its source's, everything else the box's own. */
  const statements = (essid: string, tree: Directory) => {
    const copies = loginsTo(essid).filter((relation) => relation.kind === 'backup');
    return walkTree(createFsView(tree, { userType: 'root' }), asAbsPath('/'), (path, node) => {
      if (node.kind !== 'file') return [];
      const copy = copies.find((relation) => {
        const folder = millbrook.find((network) => network.key === relation.source)?.essid;
        return path.startsWith(`/home/${relation.user}/backups/${folder?.toLowerCase()}/`);
      });
      return [{ path, content: node.content ?? '', network: copy?.source ?? essid }];
    });
  };

  const addressesIn = (content: string): readonly string[] =>
    content.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];

  it('names no address of the world but its own and those its relations lead to', () => {
    const worldOctets = [...REGION_FIRST_OCTETS, PLACELESS_FIRST_OCTET];
    const knownTo = new Map(
      keys.map((key) => [
        key,
        [publicAddress(key), ...relationsFrom(key).map((relation) => relation.address)],
      ]),
    );
    const stray = boxes().flatMap(({ essid, name, tree }) =>
      statements(essid, tree).flatMap(({ path, content, network }) => {
        const known = knownTo.get(network) ?? [];
        return addressesIn(content)
          .filter((address) => worldOctets.includes(Number(address.split('.')[0])))
          .filter((address) => !known.includes(address))
          .map((address) => `${name} ${path}: ${address}`);
      }),
    );

    expect(stray).toEqual([]);
  });

  it('names no private address off the network whose facts it states', () => {
    const subnetsOf = new Map(
      keys.map((key) => [
        key,
        [
          generateHomeLan(key).subnet,
          ...chainLinks(key).map(
            (link) =>
              generateDeepLayer(key, { machineId: link.machineId, kind: link.host.kind }).subnet,
          ),
        ],
      ]),
    );
    const isPrivate = (address: string) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
    const stray = boxes().flatMap(({ essid, name, tree }) =>
      statements(essid, tree).flatMap(({ path, content, network }) => {
        const subnets = subnetsOf.get(network) ?? [];
        return addressesIn(content)
          .filter(isPrivate)
          .filter((address) => !subnets.some((subnet) => address.startsWith(`${subnet}.`)))
          .map((address) => `${name} ${path}: ${address}`);
      }),
    );

    expect(stray).toEqual([]);
  });
});

const byEnds = (left: Relation, right: Relation): number =>
  `${left.target} ${left.source} ${left.kind}`.localeCompare(
    `${right.target} ${right.source} ${right.kind}`,
  );
