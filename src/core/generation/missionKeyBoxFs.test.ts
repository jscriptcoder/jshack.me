import { describe, expect, it } from 'vitest';
import { buildMissionKeyBoxFs } from './missionKeyBoxFs.js';
import { missionShape, MISSION_ROUTE_DAY, type MissionRoute } from '../missions/missionShape.js';
import { readOpenPorts } from '../services/pidfile.js';
import { parseDpkgVersions } from '../packages/dpkgStatus.js';
import { liveCve } from '../cve/liveCve.js';
import { UNCRACKABLE_HASHES } from './passwordPools.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/** The first sampled contract number whose route is `route`. */
const numberWithRoute = (route: MissionRoute): number => {
  for (let missionNumber = 2; missionNumber < 5000; missionNumber += 1) {
    if (missionShape(missionNumber).route === route) return missionNumber;
  }
  throw new Error(`no ${route} contract in range`);
};

const HYDRA = numberWithRoute('hydra');
const MSF = numberWithRoute('msfconsole');
const WEB = numberWithRoute('web');
const FTP = numberWithRoute('ftp');

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

  it('runs a web server and sshd on the web route, and holds no leak of its own', () => {
    const box = buildMissionKeyBoxFs(WEB);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(['http', 'ssh']);
    // The file is the server's to lay in: what the client computes must not hold it.
    expect(fileAt(box, ['var', 'www', 'html', 'index.html'])).toContain('It works!');
    const published = listTree(box).filter((path) => path.startsWith('var/www/html/'));
    expect(published).toEqual(['var/www/html/index.html']);
  });

  it('runs an ftp server and sshd on the ftp route, and holds no leak of its own', () => {
    const box = buildMissionKeyBoxFs(FTP);

    expect(readOpenPorts(box).map((port) => port.service).sort()).toEqual(['ftp', 'ssh']);
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

  it.each([
    ['hydra', HYDRA],
    ['msfconsole', MSF],
    ['web', WEB],
  ] as const)('opens nothing to anonymous on the %s route', (_route, missionNumber) => {
    const box = buildMissionKeyBoxFs(missionNumber);

    expect(nodeAt(box, ['etc', 'vsftpd.conf'])).toBeUndefined();
    expect(nodeAt(box, ['srv'])).toBeUndefined();
  });

  it('keeps a vsftpd log on any box running the daemon, and none on a box that is not', () => {
    expect(fileAt(buildMissionKeyBoxFs(FTP), ['var', 'log', 'vsftpd.log'])).toBe('');
    expect(nodeAt(buildMissionKeyBoxFs(HYDRA), ['var', 'log', 'vsftpd.log'])).toBeUndefined();
  });

  it('answers its own sshd, the hydra route reached through the forward', () => {
    expect(readOpenPorts(buildMissionKeyBoxFs(HYDRA)).some((port) => port.service === 'ssh')).toBe(
      true,
    );
    // The hydra key box exposes no other service of its own.
    expect(readOpenPorts(buildMissionKeyBoxFs(HYDRA)).map((port) => port.service)).toEqual(['ssh']);
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
