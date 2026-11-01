import { describe, expect, it } from 'vitest';
import { buildMissionKeyBoxFs } from './missionKeyBoxFs.js';
import { missionShape, MISSION_ROUTE_DAY } from '../missions/missionShape.js';
import { readOpenPorts } from '../services/pidfile.js';
import { parseDpkgVersions } from '../packages/dpkgStatus.js';
import { liveCve } from '../cve/liveCve.js';
import { UNCRACKABLE_HASHES } from './passwordPools.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/** The first sampled contract number whose route is `route`. */
const numberWithRoute = (route: 'hydra' | 'msfconsole'): number => {
  for (let missionNumber = 2; missionNumber < 5000; missionNumber += 1) {
    if (missionShape(missionNumber).route === route) return missionNumber;
  }
  throw new Error(`no ${route} contract in range`);
};

const HYDRA = numberWithRoute('hydra');
const MSF = numberWithRoute('msfconsole');

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

describe('the key box of a contract network', () => {
  it('carries the three accounts, with root as the shape draws it', () => {
    const passwd = fileAt(buildMissionKeyBoxFs(HYDRA), ['etc', 'passwd']);
    const rootHash = passwd.split('\n')[0]?.split(':')[1];

    expect(rootHash).toBe(missionShape(HYDRA).keyBoxRootHash);
    // An NPC user and guest sit below root, shells that cannot read the root-only key.
    expect(passwd).toMatch(/:1000:1000:/);
    expect(passwd).toMatch(/^guest:[^:]*:1001:1001:/m);
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
