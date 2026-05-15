import { describe, it, expect } from 'vitest';
import {
  buildInfrastructurePidFiles,
  buildNcBackdoorPidFiles,
  INFRA_PID_CONFIGS,
} from './infraPidFiles';
import { generateMissionNetwork } from '../generateMission';
import { generateHomeNetwork, homeNetworkSeed } from '../generateHomeNetwork';
import { generateTechpartsNetwork } from '../../themedNetworks/generators/techpartsNetwork';
import { generateSearchEngineNetwork } from '../../themedNetworks/generators/searchEngineNetwork';
import type { GeneratedMachine } from '../types';
import type { Port } from '../../network/types';
import type { WorldNetwork } from '../../worldNetworks/types';

// NPC backdoors need a generation-time `/var/run/nc-<port>.pid` so
// cross-player nc-connect can read it server-side.

const ELITE_PORT = (overrides: Partial<Port> = {}): Port => ({
  port: 4444,
  service: 'elite',
  serviceVersion: '1.10',
  open: true,
  owner: { username: 'admin', userType: 'user', homePath: '/home/admin' },
  ...overrides,
});

describe('buildNcBackdoorPidFiles', () => {
  it('emits one pidfile per elite port with an owner', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ port: 4444 })]);
    expect(Object.keys(result)).toEqual(['nc-4444.pid']);
    expect(result['nc-4444.pid']?.content).toBe(
      'nc:port=4444,user=admin,userType=user,home=/home/admin',
    );
  });

  it('skips elite ports without an owner', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ owner: undefined })]);
    expect(result).toEqual({});
  });

  it('skips closed ports', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ open: false })]);
    expect(result).toEqual({});
  });

  it('skips non-elite ports', () => {
    const result = buildNcBackdoorPidFiles([
      {
        port: 22,
        service: 'ssh',
        serviceVersion: '8.9',
        open: true,
        owner: { username: 'admin', userType: 'user', homePath: '/home/admin' },
      },
    ]);
    expect(result).toEqual({});
  });

  it('emits multiple pidfiles for multiple backdoor ports', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({ port: 4444 }),
      ELITE_PORT({
        port: 31337,
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      }),
    ]);
    expect(Object.keys(result).sort()).toEqual(['nc-31337.pid', 'nc-4444.pid']);
  });

  it('preserves the ServiceOwner.userType in the pidfile content', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      }),
    ]);
    expect(result['nc-4444.pid']?.content).toBe('nc:port=4444,user=root,userType=root,home=/root');
  });

  it('sets the FileNode owner to the listener userType', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({
        owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
      }),
    ]);
    expect(result['nc-4444.pid']?.owner).toBe('guest');
  });
});

describe('buildInfrastructurePidFiles', () => {
  it('returns an empty record for no ports', () => {
    expect(buildInfrastructurePidFiles([])).toEqual({});
  });

  it('skips closed ports', () => {
    const result = buildInfrastructurePidFiles([{ port: 3306, service: 'mysql', open: false }]);
    expect(result).toEqual({});
  });

  it('skips ports whose service has no INFRA_PID_CONFIGS entry', () => {
    const result = buildInfrastructurePidFiles([
      { port: 22, service: 'ssh', open: true },
      { port: 4444, service: 'elite', open: true },
    ]);
    expect(result).toEqual({});
  });

  it('emits one pid file for a single-port single-service binary (mysqld)', () => {
    const result = buildInfrastructurePidFiles([{ port: 3306, service: 'mysql', open: true }]);
    expect(Object.keys(result)).toEqual(['mysqld.pid']);
    expect(result['mysqld.pid']?.content).toBe('/usr/sbin/mysqld:port=3306');
  });

  it('groups multi-port single-binary into one pid file with multi-line content (nginx 80 + 443)', () => {
    const result = buildInfrastructurePidFiles([
      { port: 80, service: 'http', open: true },
      { port: 443, service: 'https', open: true },
    ]);
    expect(Object.keys(result)).toEqual(['nginx.pid']);
    expect(result['nginx.pid']?.content).toBe('/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443');
  });

  it('groups three nginx services (http + https + http-alt) into one nginx.pid', () => {
    const result = buildInfrastructurePidFiles([
      { port: 80, service: 'http', open: true },
      { port: 443, service: 'https', open: true },
      { port: 8080, service: 'http-alt', open: true },
    ]);
    expect(Object.keys(result)).toEqual(['nginx.pid']);
    expect(result['nginx.pid']?.content).toBe(
      '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443\n/usr/sbin/nginx:port=8080',
    );
  });

  it('groups dovecot services (imap + imaps + pop3) into one dovecot.pid', () => {
    const result = buildInfrastructurePidFiles([
      { port: 143, service: 'imap', open: true },
      { port: 993, service: 'imaps', open: true },
      { port: 110, service: 'pop3', open: true },
    ]);
    expect(Object.keys(result)).toEqual(['dovecot.pid']);
    expect(result['dovecot.pid']?.content).toBe(
      '/usr/sbin/dovecot:port=143\n/usr/sbin/dovecot:port=993\n/usr/sbin/dovecot:port=110',
    );
  });

  it('emits separate pid files for distinct binaries', () => {
    const result = buildInfrastructurePidFiles([
      { port: 80, service: 'http', open: true },
      { port: 3306, service: 'mysql', open: true },
      { port: 6379, service: 'redis', open: true },
    ]);
    expect(Object.keys(result).sort()).toEqual(['mysqld.pid', 'nginx.pid', 'redis.pid']);
    expect(result['nginx.pid']?.content).toBe('/usr/sbin/nginx:port=80');
    expect(result['mysqld.pid']?.content).toBe('/usr/sbin/mysqld:port=3306');
    expect(result['redis.pid']?.content).toBe('/usr/sbin/redis-server:port=6379');
  });

  it('excludes closed ports from a multi-port group', () => {
    const result = buildInfrastructurePidFiles([
      { port: 80, service: 'http', open: true },
      { port: 443, service: 'https', open: false },
    ]);
    expect(Object.keys(result)).toEqual(['nginx.pid']);
    expect(result['nginx.pid']?.content).toBe('/usr/sbin/nginx:port=80');
  });

  it('emits no file for a binary group whose ports are all closed', () => {
    const result = buildInfrastructurePidFiles([
      { port: 80, service: 'http', open: false },
      { port: 443, service: 'https', open: false },
    ]);
    expect(result).toEqual({});
  });
});

// Inventory of which `INFRA_PID_CONFIGS` entries actually have open ports
// somewhere in the generator corpus today. The pid-file-source-of-truth
// promotion in step 2 only needs to handle services that DO appear here;
// the remaining `INFRA_PID_CONFIGS` entries (imaps, pop3, modbus, rsync)
// stay decorative until a generator opens them.
//
// To update: if a generator starts opening a port for a service not in
// this allowlist, the test below fails. Add the service to
// SERVICES_WITH_OPEN_PORTS and update the step-2 parser accordingly.
const SERVICES_WITH_OPEN_PORTS: readonly string[] = [
  'dns',
  'http',
  'http-alt',
  'https',
  'imap',
  'mongodb',
  'mqtt',
  'mysql',
  'openvpn',
  'postgresql',
  'redis',
  'smb',
  'smtp',
  'snmp',
  'vnc',
];

const MISSION_SAMPLES = 20;
const HOME_SAMPLES = 20;

const techpartsRow: WorldNetwork = {
  public_ip: '198.51.100.80',
  seed: 'inventory-techparts',
  name: 'techparts.io',
  description: 'inventory',
  theme: 'techparts',
  public_domain: 'techparts.io',
  search_metadata: { title: 't', description: 'd', keywords: [] },
};

const finditRow: WorldNetwork = {
  public_ip: '192.0.2.80',
  seed: 'inventory-findit',
  name: 'findit.io',
  description: 'inventory',
  theme: 'search-engine',
  public_domain: 'findit.io',
  search_metadata: { title: 'f', description: 'd', keywords: [] },
};

const collectInfraServicesWithOpenPorts = (
  discovered: Set<string>,
  machines: readonly GeneratedMachine[],
  routerMachine: GeneratedMachine,
): void => {
  const all = [...machines, routerMachine];
  for (const machine of all) {
    for (const port of machine.remoteMachine.ports) {
      if (port.open && INFRA_PID_CONFIGS[port.service]) {
        discovered.add(port.service);
      }
    }
  }
};

describe('INFRA_PID_CONFIGS coverage in generated networks', () => {
  it('working set of infra services with open ports matches the allowlist', async () => {
    const discovered = new Set<string>();

    for (let i = 0; i < MISSION_SAMPLES; i++) {
      const mission = await generateMissionNetwork(`inventory-mission-${i}`);
      collectInfraServicesWithOpenPorts(discovered, mission.machines, mission.routerMachine);
    }

    for (let i = 0; i < HOME_SAMPLES; i++) {
      const home = await generateHomeNetwork({
        seed: homeNetworkSeed('inventory-home', i),
        essid: `INVENTORY-${i}`,
      });
      collectInfraServicesWithOpenPorts(discovered, home.machines, home.routerMachine);
    }

    const techparts = await generateTechpartsNetwork(techpartsRow, {
      allocateIp: async () => '198.51.100.80',
      allRows: [techpartsRow],
    });
    collectInfraServicesWithOpenPorts(discovered, techparts.machines, techparts.routerMachine);

    const findit = await generateSearchEngineNetwork(finditRow, {
      allocateIp: async () => '192.0.2.80',
      allRows: [finditRow],
    });
    collectInfraServicesWithOpenPorts(discovered, findit.machines, findit.routerMachine);

    expect([...discovered].sort()).toEqual([...SERVICES_WITH_OPEN_PORTS].sort());
  });
});
