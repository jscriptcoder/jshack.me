import { describe, expect, it } from 'vitest';
import { buildMissionKeyBoxFs } from './missionKeyBoxFs.js';
import {
  missionShape,
  MISSION_ROUTE_DAY,
  type MissionDecoy,
  type MissionRoute,
} from '../missions/missionShape.js';
import { readOpenPorts } from '../services/pidfile.js';
import { parseDpkgVersions } from '../packages/dpkgStatus.js';
import { liveCve } from '../cve/liveCve.js';
import { UNCRACKABLE_HASHES } from './passwordPools.js';
import { MYSQL_USERNAMES } from './pools/database.js';
import { databaseIn, DATADIR_OWNER } from '../mysql/datadir.js';
import { readRwCommunityHash, readSnmpdState } from '../snmp/rwCommunity.js';
import { parseSnmpdConf, readSnmpdConf, SNMPD_CONF_PERMISSIONS } from '../snmp/conf.js';
import { SHUT_HASHES } from '../missions/leakablePool.js';
import { missionLeakFile } from '../missions/missionLeak.js';
import { SNMP_ROUTE_NUMBER } from '../../test/factories/snmpRouteContract.js';
import { DEPLOYMENT_SECRETS } from '../../test/factories/webRouteContract.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/** The first sampled contract number whose route is `route`, running none of `without` as a
 *  decoy and, when `without` names `mysql`, not keeping its key in a database either. */
const numberWithRoute = (route: MissionRoute, without: readonly MissionDecoy[] = []): number => {
  for (let missionNumber = 2; missionNumber < 5000; missionNumber += 1) {
    const shape = missionShape(missionNumber);
    if (shape.route !== route) continue;
    if (without.some((decoy) => shape.decoys.includes(decoy))) continue;
    if (without.includes('mysql') && shape.storage === 'database') continue;
    return missionNumber;
  }
  throw new Error(`no ${route} contract in range`);
};

/** The first sampled contract number running `decoy` as a decoy. */
const numberWithDecoy = (decoy: MissionDecoy): number => {
  for (let missionNumber = 2; missionNumber < 5000; missionNumber += 1) {
    if (missionShape(missionNumber).decoys.includes(decoy)) return missionNumber;
  }
  throw new Error(`no ${decoy} decoy in range`);
};

/** What a scan of the box finds listening: its own sshd and every service the shape names,
 *  the route's and the decoys'. */
const servicesNamedFor = (missionNumber: number): readonly string[] =>
  ['ssh', ...missionShape(missionNumber).keyBoxServices.map(({ service }) => service)].sort();

const HYDRA = numberWithRoute('hydra');
const MSF = numberWithRoute('msfconsole');
const WEB = numberWithRoute('web');
const FTP = numberWithRoute('ftp');
const MYSQL = numberWithRoute('mysql');
const SNMP = numberWithRoute('snmp');

const fileAt = (fs: Directory, segments: readonly string[]): string => {
  let node: FileNode = fs;
  for (const segment of segments) {
    if (node.kind !== 'directory') throw new Error(`not a directory before ${segment}`);
    const next = node.entries.get(segment);
    if (next === undefined) throw new Error(`missing ${segments.join('/')}`);
    node = next;
  }
  if (node.kind !== 'file') throw new Error(`${segments.join('/')} is not a file`);
  return node.content;
};

const nodeAt = (fs: Directory, segments: readonly string[]): FileNode | undefined =>
  segments.reduce<FileNode | undefined>(
    (node, segment) => (node?.kind === 'directory' ? node.entries.get(segment) : undefined),
    fs,
  );

const listTree = (directory: Directory, prefix = ''): readonly string[] =>
  [...directory.entries].flatMap(([name, node]) =>
    node.kind === 'directory' ? listTree(node, `${prefix}${name}/`) : [`${prefix}${name}`],
  );

describe('the key box of a contract network', () => {
  it('carries the three accounts, with root as the shape draws it', () => {
    const passwd = fileAt(buildMissionKeyBoxFs(HYDRA), ['etc', 'passwd']);
    const rootHash = passwd.split('\n')[0]?.split(':')[1];

    expect(rootHash).toBe(missionShape(HYDRA).keyBoxRootHash);
    // An NPC user and guest sit below root, shells that cannot read the root-only key.
    expect(passwd).toMatch(/:1000:1000:/);
    expect(passwd).toMatch(/^guest:[^:]*:1001:1001:/m);
  });

  it('runs a web server and sshd on the web route, beside its decoys, and holds no leak of its own', () => {
    const box = buildMissionKeyBoxFs(WEB);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(servicesNamedFor(WEB));
    expect(readOpenPorts(box).map((port) => port.service)).toContain('http');
    // The file is the server's to lay in: what the client computes must not hold it.
    expect(fileAt(box, ['var', 'www', 'html', 'index.html'])).toContain('It works!');
    const published = listTree(box).filter((path) => path.startsWith('var/www/html/'));
    expect(published).toEqual(['var/www/html/index.html']);
  });

  it('runs an ftp server and sshd on the ftp route, beside its decoys, and holds no leak of its own', () => {
    const box = buildMissionKeyBoxFs(FTP);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(servicesNamedFor(FTP));
    expect(readOpenPorts(box).map((port) => port.service)).toContain('ftp');
    // The directory is there for the door to land in; the file is the server's to lay in.
    expect(nodeAt(box, ['srv', 'ftp', 'pub'])?.kind).toBe('directory');
    expect(listTree(box).filter((path) => path.startsWith('srv/'))).toEqual([]);
  });

  it('says on the ftp route that the door lets anonymous in, for any tier to read', () => {
    const config = nodeAt(buildMissionKeyBoxFs(FTP), ['etc', 'vsftpd.conf']);

    expect(config?.kind).toBe('file');
    expect(config?.kind === 'file' ? config.content : '').toMatch(/^anonymous_enable=YES$/m);
    expect(config?.perms.read).toContain('guest');
    expect(config?.perms.write).toEqual(['root']);
  });

  it('states no landing directory in the config, because the door reads none', () => {
    expect(fileAt(buildMissionKeyBoxFs(FTP), ['etc', 'vsftpd.conf'])).not.toMatch(/anon_root/);
  });

  it.each(['hydra', 'msfconsole', 'web'] as const)(
    'opens nothing to anonymous on the %s route with no ftp decoy',
    (route) => {
      const box = buildMissionKeyBoxFs(numberWithRoute(route, ['ftp']));

      expect(nodeAt(box, ['etc', 'vsftpd.conf'])).toBeUndefined();
      expect(nodeAt(box, ['srv'])).toBeUndefined();
    },
  );

  it('keeps a vsftpd log on any box running the daemon, and none on a box that is not', () => {
    expect(fileAt(buildMissionKeyBoxFs(FTP), ['var', 'log', 'vsftpd.log'])).toBe('');
    expect(
      nodeAt(buildMissionKeyBoxFs(numberWithRoute('hydra', ['ftp'])), ['var', 'log', 'vsftpd.log']),
    ).toBeUndefined();
  });

  it('runs mysqld and sshd on the database route, beside its decoys, with the client a shell logs in by', () => {
    const box = buildMissionKeyBoxFs(MYSQL);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(servicesNamedFor(MYSQL));
    expect(readOpenPorts(box).map((port) => port.service)).toContain('mysql');
    expect(nodeAt(box, ['usr', 'bin', 'mysql'])?.kind).toBe('file');
    expect(nodeAt(box, ['usr', 'sbin', 'mysqld'])?.kind).toBe('file');
  });

  it('guards the database with its two drawn accounts and nobody else', () => {
    const database = databaseIn(buildMissionKeyBoxFs(MYSQL));
    const drawn = missionShape(MYSQL).keyBoxDatabase;

    expect(database?.credentials).toHaveLength(2);
    expect(database?.credentials[0]).toEqual({
      username: 'root',
      passwordHash: drawn?.rootHash,
      userType: 'root',
    });
    expect(MYSQL_USERNAMES).toContain(database?.credentials[1]?.username);
    expect(database?.credentials[1]?.passwordHash).toBe(drawn?.accountHash);
    expect(database?.credentials[1]?.userType).toBe('user');
  });

  it('generates an application in the database, the same one every time', () => {
    const database = databaseIn(buildMissionKeyBoxFs(MYSQL));

    expect(database?.name.length).toBeGreaterThan(0);
    expect(Object.keys(database?.tables ?? {}).length).toBeGreaterThan(0);
    expect(databaseIn(buildMissionKeyBoxFs(MYSQL))).toEqual(database);
  });

  it('names the box own NPC as the application admin, and nobody off the box', () => {
    // Drawn for the key box and not the gateway: a gateway's application would count the key box
    // as a neighbour, and list somebody who has no account here.
    const box = buildMissionKeyBoxFs(MYSQL);
    const npc = fileAt(box, ['etc', 'passwd'])
      .split('\n')
      .find((line) => line.includes(':1000:1000:'))
      ?.split(':')[0];

    expect(databaseIn(box)?.tables['users']?.rows.map((row) => row['username'])).toEqual([npc]);
  });

  it('draws each contract its own application, so no two share a row of it', () => {
    const passwordHashOf = (missionNumber: number) =>
      databaseIn(buildMissionKeyBoxFs(missionNumber))?.tables['users']?.rows[0]?.['password_hash'];
    const [first, second] = Array.from({ length: 5000 }, (_unused, index) => index + 2).filter(
      (missionNumber) =>
        missionShape(missionNumber).route === 'mysql' && passwordHashOf(missionNumber) !== undefined,
    );
    if (first === undefined || second === undefined) throw new Error('two contracts in range');

    expect(passwordHashOf(first)).not.toBe(passwordHashOf(second));
  });

  it('keeps the table holding the word out of the box as it generates', () => {
    expect(Object.keys(databaseIn(buildMissionKeyBoxFs(MYSQL))?.tables ?? {})).not.toContain(
      'settings',
    );
  });

  it('keeps the datadir root-only, since it holds the hashes a sweep has to work for', () => {
    const datadir = nodeAt(buildMissionKeyBoxFs(MYSQL), ['var', 'lib', 'mysql', 'data.json']);

    expect(datadir?.perms.read).toEqual(['root']);
    expect(datadir?.perms.write).toEqual(['root']);
    expect(datadir?.owner).toBe(DATADIR_OWNER);
  });

  it('keeps a mysql log on the database route, and says nothing else about a database', () => {
    const box = buildMissionKeyBoxFs(MYSQL);

    expect(fileAt(box, ['var', 'log', 'mysql.log'])).toBe('');
    expect(nodeAt(box, ['etc', 'mysql.cnf'])).toBeUndefined();
  });

  it.each(['hydra', 'msfconsole', 'web', 'ftp', 'snmp'] as const)(
    'holds no database on the %s route with no database decoy or key',
    (route) => {
      const box = buildMissionKeyBoxFs(numberWithRoute(route, ['mysql']));

      expect(nodeAt(box, ['var', 'lib', 'mysql'])).toBeUndefined();
      expect(nodeAt(box, ['var', 'log', 'mysql.log'])).toBeUndefined();
      expect(readOpenPorts(box).some((port) => port.service === 'mysql')).toBe(false);
    },
  );

  it('runs snmpd and sshd on the snmp route, beside its decoys, with the client a shell walks by', () => {
    const box = buildMissionKeyBoxFs(SNMP);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(servicesNamedFor(SNMP));
    expect(readOpenPorts(box).map((port) => port.service)).toContain('snmp');
    expect(nodeAt(box, ['usr', 'bin', 'snmpwalk'])?.kind).toBe('file');
    expect(nodeAt(box, ['usr', 'bin', 'snmpset'])?.kind).toBe('file');
    expect(nodeAt(box, ['usr', 'sbin', 'snmpd'])?.kind).toBe('file');
  });

  it('holds the read-write community as the shape draws it, for root alone', () => {
    const box = buildMissionKeyBoxFs(SNMP);
    const state = nodeAt(box, ['var', 'lib', 'snmp', 'snmpd.conf']);

    expect(readRwCommunityHash(box)).toBe(missionShape(SNMP).keyBoxCommunityHash);
    expect(state?.perms.read).toEqual(['root']);
    expect(state?.perms.write).toEqual(['root']);
  });

  it('keeps an agent log on the snmp route', () => {
    expect(fileAt(buildMissionKeyBoxFs(SNMP), ['var', 'log', 'snmpd.log'])).toBe('');
  });

  it('keeps the read-only community and the word out of the box as it generates', () => {
    const box = buildMissionKeyBoxFs(SNMP);

    expect(nodeAt(box, ['etc', 'snmp'])).toBeUndefined();
    expect(nodeAt(box, ['etc', 'iptables'])).toBeUndefined();
  });

  it.each(['hydra', 'msfconsole', 'web', 'ftp', 'mysql'] as const)(
    'runs no agent and holds no community on the %s route with no agent decoy',
    (route) => {
      const box = buildMissionKeyBoxFs(numberWithRoute(route, ['snmp']));

      expect(readSnmpdState(box)).toBe('');
      expect(readSnmpdConf(box)).toBe('');
      expect(nodeAt(box, ['var', 'log', 'snmpd.log'])).toBeUndefined();
      expect(readOpenPorts(box).some((port) => port.service === 'snmp')).toBe(false);
    },
  );

  it('answers its own sshd, the hydra route reached through the forward', () => {
    expect(readOpenPorts(buildMissionKeyBoxFs(HYDRA)).some((port) => port.service === 'ssh')).toBe(
      true,
    );
    // Nothing else of its own listens there, only its decoys' daemons.
    expect(readOpenPorts(buildMissionKeyBoxFs(HYDRA)).map((port) => port.service).sort()).toEqual(
      servicesNamedFor(HYDRA),
    );
  });

  it('runs the msfconsole route service on its critical release, reachable to a scan', () => {
    const shape = missionShape(MSF);
    const routeService = shape.keyBoxServices[0];
    const ports = readOpenPorts(buildMissionKeyBoxFs(MSF));

    expect(ports.some((port) => port.service === 'ssh')).toBe(true);
    expect(ports.some((port) => port.port === routeService?.port)).toBe(true);

    const manifest = parseDpkgVersions(fileAt(buildMissionKeyBoxFs(MSF), ['var', 'lib', 'dpkg', 'status']));
    expect(manifest.get(routeService?.package ?? '')).toBe(routeService?.version);
    const routeCve = liveCve(routeService?.package ?? '', routeService?.version ?? '', MISSION_ROUTE_DAY);
    expect(routeCve?.severity).toBe('critical');
  });

  it('sits on the releases the shape pins, nothing else above guest', () => {
    const shape = missionShape(MSF);
    const manifest = parseDpkgVersions(fileAt(buildMissionKeyBoxFs(MSF), ['var', 'lib', 'dpkg', 'status']));

    expect(manifest.size).toBeGreaterThan(0);
    for (const [pkg, version] of manifest) {
      expect(version, pkg).toBe(shape.keyBoxVersions[pkg]);
    }
  });

  it('holds no key file of its own — the server lays that in', () => {
    const tree = JSON.stringify(serialize(buildMissionKeyBoxFs(HYDRA)));
    expect(tree).not.toMatch(/ACCESS-/);
  });

  it('is the same box for the same number', () => {
    expect(buildMissionKeyBoxFs(MSF)).toEqual(buildMissionKeyBoxFs(MSF));
  });

  it('starts the standard log files empty, as a box that has traced like any other', () => {
    // A mission box leaves auth, kern and access traces like any box, so it ships those
    // three logs, each empty until something writes to it.
    const fs = buildMissionKeyBoxFs(HYDRA);

    for (const log of ['access.log', 'auth.log', 'kern.log']) {
      expect(fileAt(fs, ['var', 'log', log])).toBe('');
    }
  });
});

describe('a decoy on the key box', () => {
  // Each is the real door of its kind as the box generates, minus what the server lays in, so
  // working it is the only way to find it holds nothing.
  it('serves the stock page behind a web decoy, and nothing else', () => {
    const box = buildMissionKeyBoxFs(numberWithDecoy('web'));

    expect(fileAt(box, ['var', 'www', 'html', 'index.html'])).toContain('It works!');
    expect(listTree(box).filter((path) => path.startsWith('var/www/'))).toEqual([
      'var/www/html/index.html',
    ]);
  });

  it('lets anonymous into an empty pub behind an ftp decoy', () => {
    const box = buildMissionKeyBoxFs(numberWithDecoy('ftp'));

    expect(fileAt(box, ['etc', 'vsftpd.conf'])).toMatch(/^anonymous_enable=YES$/m);
    expect(nodeAt(box, ['srv', 'ftp', 'pub'])?.kind).toBe('directory');
    expect(listTree(box).filter((path) => path.startsWith('srv/'))).toEqual([]);
    expect(fileAt(box, ['var', 'log', 'vsftpd.log'])).toBe('');
  });

  it('keeps a generated application behind a database decoy, with no word and no key', () => {
    const missionNumber = numberWithDecoy('mysql');
    const database = databaseIn(buildMissionKeyBoxFs(missionNumber));

    expect(database?.credentials[1]?.passwordHash).toBe(
      missionShape(missionNumber).keyBoxDatabase?.accountHash,
    );
    expect(Object.keys(database?.tables ?? {})).not.toContain('settings');
    expect(Object.keys(database?.tables ?? {})).not.toContain('api_keys');
  });

  it('answers a guessable community behind an snmp decoy, with an ordinary contact', () => {
    const box = buildMissionKeyBoxFs(numberWithDecoy('snmp'));
    const conf = parseSnmpdConf(readSnmpdConf(box));

    expect(['monitor', 'netops']).toContain(conf.roCommunity);
    expect(conf.sysContact).toBe('netops@corp.local');
    expect(nodeAt(box, ['etc', 'snmp', 'snmpd.conf'])?.perms).toEqual(SNMPD_CONF_PERMISSIONS);
    expect(SHUT_HASHES).toContain(readRwCommunityHash(box));
    expect(fileAt(box, ['var', 'log', 'snmpd.log'])).toBe('');
  });

  it('reads line for line like the snmp route config, but for its community and contact', () => {
    // A header or a trailing newline the route's file lacks would tell a guest which is which.
    const decoy = readSnmpdConf(buildMissionKeyBoxFs(numberWithDecoy('snmp'))).split('\n');
    const route = (missionLeakFile(SNMP_ROUTE_NUMBER, DEPLOYMENT_SECRETS)?.content ?? '').split('\n');

    expect(decoy).toHaveLength(route.length);
    expect(decoy[0]).toBe(route[0]);
    expect(decoy.at(-1)).toBe(route.at(-1));
  });

  it('draws both guessable communities across contracts', () => {
    const communityOf = (missionNumber: number): string | null =>
      parseSnmpdConf(readSnmpdConf(buildMissionKeyBoxFs(missionNumber))).roCommunity;
    const communities = new Set(
      Array.from({ length: 3000 }, (_unused, index) => index + 2)
        .filter((missionNumber) => missionShape(missionNumber).decoys.includes('snmp'))
        .slice(0, 40)
        .map(communityOf),
    );

    expect([...communities].sort()).toEqual(['monitor', 'netops']);
  });
});

/** The key box's root hash on the msfconsole route stays shut. */
describe('the msfconsole key box root', () => {
  it('is uncrackable, so the service hole is the only way in', () => {
    expect(UNCRACKABLE_HASHES).toContain(missionShape(MSF).keyBoxRootHash);
  });
});

/** A small structural serializer so the no-key assertion can scan the whole tree. */
const serialize = (node: FileNode): unknown =>
  node.kind === 'file'
    ? node.content
    : Object.fromEntries([...node.entries].map(([name, child]) => [name, serialize(child)]));
