import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { buildMissionObjective } from './attackChain';
import { generateFileSystems } from './filesystem';
import {
  credentialLeakTemplates,
  forensicsCallingCardTemplates,
  forensicsLogTypes,
  forensicsNoiseIps,
} from './pools';
import type { MissionObjectiveType } from './types';
import type { FileNode } from '../filesystem/types';

const buildTestData = (seed: string, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { objective } = buildMissionObjective({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
    layers: topology.layers,
  });
  const { fileSystems } = generateFileSystems({
    prng,
    machines: topology.machines,
    usersByMachine,
    credentials,
    objective,
    layers: topology.layers,
  });
  return { topology, fileSystems, objective, credentials, usersByMachine };
};

const buildTestDataWithOverride = (
  seed: string,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  objectiveTypeOverride?: MissionObjectiveType,
) => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { objective } = buildMissionObjective({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
    objectiveTypeOverride,
    layers: topology.layers,
  });
  const { fileSystems } = generateFileSystems({
    prng,
    machines: topology.machines,
    usersByMachine,
    credentials,
    objective,
    layers: topology.layers,
  });
  return { topology, fileSystems, objective, credentials, usersByMachine };
};

const resolveNode = (root: FileNode, path: string): FileNode | undefined => {
  const parts = path.split('/').filter(Boolean);
  let current: FileNode | undefined = root;
  for (const part of parts) {
    if (current?.type !== 'directory' || !current.children) return undefined;
    current = current.children[part];
  }
  return current;
};

describe('generateFileSystems', () => {
  it('produces deterministic output for the same seed', () => {
    const a = buildTestData('fs-seed');
    const b = buildTestData('fs-seed');
    expect(a.fileSystems).toEqual(b.fileSystems);
  });

  it('produces different output for different seeds', () => {
    const a = buildTestData('fs-alpha');
    const b = buildTestData('fs-beta');
    expect(a.fileSystems).not.toEqual(b.fileSystems);
  });

  it('creates a filesystem for each machine', () => {
    const { topology, fileSystems } = buildTestData('count-test');
    topology.machines.forEach((m) => {
      expect(fileSystems[m.ip]).toBeDefined();
      expect(fileSystems[m.ip]?.type).toBe('directory');
      expect(fileSystems[m.ip]?.name).toBe('/');
    });
  });

  it('each filesystem has standard directories', () => {
    const { topology, fileSystems } = buildTestData('dirs-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      expect(root?.children?.['root']).toBeDefined();
      expect(root?.children?.['home']).toBeDefined();
      expect(root?.children?.['etc']).toBeDefined();
      expect(root?.children?.['var']).toBeDefined();
    });
  });

  it('each filesystem has /etc/passwd', () => {
    const { topology, fileSystems } = buildTestData('passwd-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const passwd = resolveNode(root as FileNode, '/etc/passwd');
      expect(passwd).toBeDefined();
      expect(passwd?.type).toBe('file');
      expect(passwd?.content).toBeTruthy();
    });
  });

  it('target machine has the target file for exfiltrate/tamper objectives', () => {
    for (let i = 0; i < 200; i++) {
      const { fileSystems, objective } = buildTestData(`target-file-${i}`);
      if (
        objective.type === 'credential_theft' ||
        objective.type === 'sabotage' ||
        objective.type === 'backdoor' ||
        objective.type === 'portforward' ||
        objective.type === 'forensics'
      )
        continue;

      const targetFs = fileSystems[objective.targetMachine];
      const targetFile = resolveNode(targetFs as FileNode, objective.targetPath);
      expect(targetFile).toBeDefined();
      if (objective.binary) {
        const firstLine = objective.targetContent.split('\n').find((l) => l.trim().length > 0);
        expect(targetFile?.content).toContain(firstLine);
      } else {
        expect(targetFile?.content).toBe(objective.targetContent);
      }
      expect(objective.targetPath).not.toBe('/root/flag.txt');
      return;
    }
    throw new Error('No exfiltrate/tamper objective found in 200 seeds');
  });

  it('credential_theft objective skips target file placement', () => {
    for (let i = 0; i < 100; i++) {
      const { objective } = buildTestData(`cred-theft-fs-${i}`);
      if (objective.type !== 'credential_theft') continue;

      expect(objective.targetPath).toBe('');
      return;
    }
    throw new Error('No credential_theft objective found in 100 seeds');
  });

  it('non-target machines do not have a flag file in /root', () => {
    const { topology, fileSystems, objective } = buildTestData('no-flag-test');
    topology.machines
      .filter((m) => m.ip !== objective.targetMachine)
      .forEach((m) => {
        const root = fileSystems[m.ip];
        const flagFile = resolveNode(root as FileNode, '/root/flag.txt');
        expect(flagFile).toBeUndefined();
      });
  });

  it('each filesystem has /etc/hostname', () => {
    const { topology, fileSystems } = buildTestData('hostname-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const hostname = resolveNode(root as FileNode, '/etc/hostname');
      expect(hostname).toBeDefined();
      expect(hostname?.content).toBe(m.hostname);
    });
  });

  it('each filesystem has auth.log in /var/log', () => {
    const { topology, fileSystems } = buildTestData('log-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const authLog = resolveNode(root as FileNode, '/var/log/auth.log');
      expect(authLog).toBeDefined();
      expect(authLog?.content).toBeTruthy();
    });
  });

  describe('web content for machines with HTTP ports', () => {
    const buildWithRouter = (seed: string) => {
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium');
      const { usersByMachine, credentials } = generateUsers(
        prng,
        topology.machines,
        topology.entryPoint,
      );
      const { objective } = buildMissionObjective({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        difficulty: 'medium',
      });
      const { fileSystems } = generateFileSystems({
        prng,
        machines: topology.machines,
        usersByMachine,
        credentials,
        objective,
        routerMachine: topology.routerMachine,
        natForwarding: topology.natForwarding,
      });
      return { topology, fileSystems };
    };

    const HTTP_SERVICES = ['http', 'https', 'http-alt'];

    const hasOpenHttpPort = (machine: {
      readonly remoteMachine: {
        readonly ports: readonly {
          readonly port: number;
          readonly service: string;
          readonly open: boolean;
        }[];
      };
    }) => machine.remoteMachine.ports.some((p) => p.open && HTTP_SERVICES.includes(p.service));

    it('every machine with an open HTTP port has /var/www/html/index.html', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithRouter(`web-content-${i}`);

        // Check all internal machines
        topology.machines.filter(hasOpenHttpPort).forEach((m) => {
          const root = fileSystems[m.ip];
          const indexHtml = resolveNode(root as FileNode, '/var/www/html/index.html');
          expect(
            indexHtml,
            `Missing index.html on ${m.hostname} (${m.role}, seed web-content-${i})`,
          ).toBeDefined();
          expect(indexHtml?.type).toBe('file');
          expect(indexHtml?.content).toBeTruthy();
        });

        // Check router
        if (hasOpenHttpPort(topology.routerMachine)) {
          const routerFs = fileSystems[topology.routerMachine.ip];
          const indexHtml = resolveNode(routerFs as FileNode, '/var/www/html/index.html');
          expect(
            indexHtml,
            `Missing index.html on router ${topology.routerMachine.hostname}`,
          ).toBeDefined();
          expect(indexHtml?.type).toBe('file');
          expect(indexHtml?.content).toBeTruthy();
        }
      }
    });

    it('router web content looks like an admin panel', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithRouter(`router-web-${i}`);
        if (!hasOpenHttpPort(topology.routerMachine)) continue;

        const routerFs = fileSystems[topology.routerMachine.ip];
        const indexHtml = resolveNode(routerFs as FileNode, '/var/www/html/index.html');
        if (!indexHtml?.content) continue;

        // Router pages should reference the hostname and look like admin/management content
        expect(indexHtml.content).toContain(topology.routerMachine.hostname);
        return;
      }
      throw new Error('No router with HTTP port found in 50 seeds');
    });

    it('web content includes the machine hostname', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithRouter(`web-hostname-${i}`);
        const httpMachines = topology.machines.filter(hasOpenHttpPort);
        httpMachines.forEach((m) => {
          const root = fileSystems[m.ip];
          const indexHtml = resolveNode(root as FileNode, '/var/www/html/index.html');
          expect(indexHtml?.content).toContain(m.hostname);
        });
      }
    });

    it('web content is guest-readable', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithRouter(`web-perms-${i}`);
        const httpMachines = topology.machines.filter(hasOpenHttpPort);
        httpMachines.forEach((m) => {
          const root = fileSystems[m.ip];
          const indexHtml = resolveNode(root as FileNode, '/var/www/html/index.html');
          if (indexHtml) {
            expect(indexHtml.permissions.read).toContain('guest');
          }
        });
      }
    });
  });

  describe('iptables rules file on router', () => {
    const buildWithRouter = (seed: string) => {
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium');
      const { usersByMachine, credentials } = generateUsers(
        prng,
        topology.machines,
        topology.entryPoint,
      );
      const { objective } = buildMissionObjective({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        difficulty: 'medium',
      });
      const { fileSystems } = generateFileSystems({
        prng,
        machines: topology.machines,
        usersByMachine,
        credentials,
        objective,
        routerMachine: topology.routerMachine,
        natForwarding: topology.natForwarding,
      });
      return { topology, fileSystems, objective };
    };

    it('forwarded mode: router has /etc/iptables/rules.v4 with forward rules', () => {
      const { topology, fileSystems } = buildWithRouter('iptables-forwarded-forwarded');
      // Find a seed that produces forwarded mode
      if (!topology.natForwarding) {
        // Skip if this seed doesn't produce forwarded mode — test with explicit seed
        return;
      }

      const routerFs = fileSystems[topology.routerMachine.ip];
      const rulesFile = resolveNode(routerFs as FileNode, '/etc/iptables/rules.v4');

      expect(rulesFile).toBeDefined();
      expect(rulesFile?.type).toBe('file');
      expect(rulesFile?.owner).toBe('root');

      // Should contain forward rules matching NAT config
      for (const rule of topology.natForwarding.rules) {
        expect(rulesFile?.content).toContain(
          `forward ${rule.publicPort} to ${rule.internalIp}:${rule.internalPort}`,
        );
      }
    });

    it('forwarded mode: rules match NAT forwarding exactly', () => {
      // Use explicit forwarded seed to guarantee forwarded mode
      for (let i = 0; i < 50; i++) {
        const data = buildWithRouter(`iptables-fwd-exact-${i}-forwarded`);
        if (!data.topology.natForwarding) continue;

        const routerFs = data.fileSystems[data.topology.routerMachine.ip];
        const rulesFile = resolveNode(routerFs as FileNode, '/etc/iptables/rules.v4');
        expect(rulesFile).toBeDefined();

        const content = rulesFile?.content ?? '';
        const forwardLines = content.split('\n').filter((line) => line.startsWith('forward '));

        expect(forwardLines.length).toBe(data.topology.natForwarding.rules.length);
        return;
      }
      throw new Error('No forwarded mode found in 50 seeds');
    });

    it('router-first mode: rules file exists but has no forward lines', () => {
      for (let i = 0; i < 50; i++) {
        const data = buildWithRouter(`iptables-routerfirst-${i}-router-first`);
        if (data.topology.natForwarding) continue; // skip forwarded seeds

        const routerFs = data.fileSystems[data.topology.routerMachine.ip];
        const rulesFile = resolveNode(routerFs as FileNode, '/etc/iptables/rules.v4');

        expect(rulesFile).toBeDefined();
        expect(rulesFile?.type).toBe('file');
        expect(rulesFile?.owner).toBe('root');

        // Should have the comment header but no forward lines
        const content = rulesFile?.content ?? '';
        expect(content).toContain('# Port Forwarding Rules');
        const forwardLines = content.split('\n').filter((line) => line.startsWith('forward '));
        expect(forwardLines.length).toBe(0);
        return;
      }
      throw new Error('No router-first mode found in 50 seeds');
    });

    it('iptables file is root-owned', () => {
      const data = buildWithRouter('iptables-owner-test-forwarded');
      const routerFs = data.fileSystems[data.topology.routerMachine.ip];
      const rulesFile = resolveNode(routerFs as FileNode, '/etc/iptables/rules.v4');

      expect(rulesFile).toBeDefined();
      expect(rulesFile?.owner).toBe('root');
      // mkFile('root') produces ['root', 'root'] — only root can write
      expect(rulesFile?.permissions.write).toEqual(['root', 'root']);
    });
  });

  describe('SNMP config file on router', () => {
    const buildWithSnmpRouter = (seed: string) => {
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'hard', { entryVariantOverride: 'snmp' });
      const { usersByMachine, credentials } = generateUsers(
        prng,
        topology.machines,
        topology.entryPoint,
      );
      // Generate router users separately (same pattern as generateMissionNetwork)
      const { usersByMachine: routerUsersByMachine, credentials: routerCredentials } =
        generateUsers(prng, [topology.routerMachine], '');
      const allCredentials = { ...credentials, ...routerCredentials };
      const allUsersByMachine = { ...usersByMachine, ...routerUsersByMachine };
      const { objective } = buildMissionObjective({
        prng,
        machines: topology.machines,
        credentials: allCredentials,
        entryPoint: topology.entryPoint,
        difficulty: 'hard',
      });
      const { fileSystems } = generateFileSystems({
        prng,
        machines: topology.machines,
        usersByMachine: allUsersByMachine,
        credentials: allCredentials,
        objective,
        routerMachine: topology.routerMachine,
        natForwarding: topology.natForwarding,
        entryVariant: 'snmp',
      });
      return { topology, fileSystems, credentials: allCredentials };
    };

    it('SNMP router has /etc/snmp/snmpd.conf with community strings and OID data', () => {
      const { topology, fileSystems, credentials } = buildWithSnmpRouter('snmp-fs-test');
      const routerFs = fileSystems[topology.routerMachine.ip];
      const snmpConf = resolveNode(routerFs as FileNode, '/etc/snmp/snmpd.conf');

      expect(snmpConf).toBeDefined();
      expect(snmpConf?.type).toBe('file');
      expect(snmpConf?.owner).toBe('root');

      const content = snmpConf?.content ?? '';
      // Must have read-only and read-write community strings
      expect(content).toContain('rocommunity public');
      expect(content).toMatch(/rwcommunity \w+/);
      // Must have system OIDs
      expect(content).toContain('sysName');
      expect(content).toContain(topology.routerMachine.hostname);
      // Must have firewall OIDs
      expect(content).toContain('firewallSSH deny');
      // Must have credentials leaked via extend script args
      const routerCreds = credentials[topology.routerMachine.ip];
      const userCred = routerCreds?.find((c) => c.username !== 'root');
      if (userCred) {
        expect(content).toContain(userCred.username);
        expect(content).toContain(userCred.password);
      }
    });

    it('snmpd.conf is deterministic for the same seed', () => {
      const a = buildWithSnmpRouter('snmp-determ');
      const b = buildWithSnmpRouter('snmp-determ');
      const confA = resolveNode(
        a.fileSystems[a.topology.routerMachine.ip] as FileNode,
        '/etc/snmp/snmpd.conf',
      );
      const confB = resolveNode(
        b.fileSystems[b.topology.routerMachine.ip] as FileNode,
        '/etc/snmp/snmpd.conf',
      );
      expect(confA?.content).toBe(confB?.content);
    });
  });

  describe('credential leak placement', () => {
    it('templates all have path and content with {{username}} and {{password}}', () => {
      credentialLeakTemplates.forEach((t) => {
        expect(t.path).toBeTruthy();
        expect(t.content).toContain('{{username}}');
        expect(t.content).toContain('{{password}}');
      });
    });

    it('templates use guest-readable system paths (not /home/ or /root/)', () => {
      credentialLeakTemplates.forEach((t) => {
        expect(t.path).not.toMatch(/^\/home\//);
        expect(t.path).not.toMatch(/^\/root\//);
        expect(t.path).toMatch(/^\/(etc|tmp|srv|var|opt|usr)\//);
      });
    });

    it('places credential leaks on ~30% of machines across many seeds', () => {
      let totalMachines = 0;
      let machinesWithLeaks = 0;

      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems, credentials } = buildTestData(`cred-leak-rate-${i}`);
        topology.machines.forEach((m) => {
          totalMachines++;
          const creds = credentials[m.ip] ?? [];
          const userCred = creds.find((c) => c.username !== 'root' && c.username !== 'guest');
          if (!userCred) return;

          const fs = fileSystems[m.ip];
          if (!fs) return;

          // Check if any credential leak template path exists
          const hasLeak = credentialLeakTemplates.some((t) => {
            const node = resolveNode(fs, t.path);
            return node?.type === 'file' && node.content?.includes(userCred.password);
          });
          if (hasLeak) machinesWithLeaks++;
        });
      }

      const rate = machinesWithLeaks / totalMachines;
      // ~30% chance — allow 15%-45% range for statistical variation
      expect(rate).toBeGreaterThan(0.15);
      expect(rate).toBeLessThan(0.45);
    });

    it('leaked credentials belong to a user-type account (never root or guest)', () => {
      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems, usersByMachine } = buildTestData(`cred-leak-user-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;

          const users = usersByMachine[m.ip] ?? [];
          const regularUsers = users.filter((u) => u.userType === 'user');

          credentialLeakTemplates.forEach((t) => {
            const node = resolveNode(fs, t.path);
            if (!node?.content) return;

            // If this file exists and has credential content, verify it's a regular user
            const containsUserCred = regularUsers.some((u) => node.content?.includes(u.username));
            if (containsUserCred) {
              // Must NOT contain root or guest usernames as the credential subject
              const rootUser = users.find((u) => u.userType === 'root');
              const guestUser = users.find((u) => u.userType === 'guest');
              // The file content should not have root/guest as the leaked credential
              // (they might appear in other template boilerplate like crontab "root" entries)
              if (rootUser) {
                expect(node.content).not.toContain(`pass = ${rootUser.username}`);
              }
              if (guestUser) {
                expect(node.content).not.toContain(`pass = ${guestUser.username}`);
              }
            }
          });
        });
      }
    });

    it('leaked files are guest-readable', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildTestData(`cred-leak-perms-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;

          credentialLeakTemplates.forEach((t) => {
            const node = resolveNode(fs, t.path);
            if (!node?.content) return;
            expect(node.permissions.read).toContain('guest');
          });
        });
      }
    });

    it('binary templates produce files that contain credentials extractable via strings', () => {
      const binaryTemplates = credentialLeakTemplates.filter((t) => t.binary);
      expect(binaryTemplates.length).toBeGreaterThanOrEqual(3);

      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems, credentials } = buildTestData(`cred-leak-binary-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;
          const creds = credentials[m.ip] ?? [];
          const userCred = creds.find((c) => c.username !== 'root' && c.username !== 'guest');
          if (!userCred) return;

          binaryTemplates.forEach((t) => {
            const node = resolveNode(fs, t.path);
            if (!node?.content) return;
            // Binary-wrapped files still contain the password (extractable with strings)
            expect(node.content).toContain(userCred.password);
          });
        });
      }
    });

    it('produces deterministic output for the same seed', () => {
      const a = buildTestData('cred-leak-deterministic');
      const b = buildTestData('cred-leak-deterministic');
      expect(a.fileSystems).toEqual(b.fileSystems);
    });
  });

  describe('HTTP entry credential placement', () => {
    const buildWithHttpEntry = (seed: string) => {
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium', { entryVariantOverride: 'http' });
      const { usersByMachine, credentials } = generateUsers(
        prng,
        topology.machines,
        topology.entryPoint,
      );
      const { objective } = buildMissionObjective({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        difficulty: 'medium',
      });
      const { fileSystems } = generateFileSystems({
        prng,
        machines: topology.machines,
        usersByMachine,
        credentials,
        objective,
        routerMachine: topology.routerMachine,
        natForwarding: topology.natForwarding,
        entryVariant: 'http',
        entryPoint: topology.entryPoint,
      });
      return { topology, fileSystems, credentials, usersByMachine };
    };

    it('entry machine has credential content in /var/www/html/ beyond index.html', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithHttpEntry(`http-entry-cred-${i}`);
        const entryFs = fileSystems[topology.entryPoint];
        const htmlDir = resolveNode(entryFs as FileNode, '/var/www/html');

        expect(htmlDir).toBeDefined();
        expect(htmlDir?.type).toBe('directory');

        // Should have more than just index.html
        const childNames = Object.keys(htmlDir?.children ?? {});
        expect(
          childNames.length,
          `seed http-entry-cred-${i}: expected >1 children in /var/www/html/, got ${childNames.join(', ')}`,
        ).toBeGreaterThan(1);
      }
    });

    it('credential files contain SSH credentials for a user-type account', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems, credentials } = buildWithHttpEntry(
          `http-entry-usercred-${i}`,
        );
        const entryFs = fileSystems[topology.entryPoint];
        const entryCreds = credentials[topology.entryPoint] ?? [];
        const userCred = entryCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
        if (!userCred) continue;

        // Collect all text content from /var/www/html/ (files + .headers sidecars)
        const htmlDir = resolveNode(entryFs as FileNode, '/var/www/html');
        const allContent = collectAllContent(htmlDir);

        // At least one file (body or sidecar) must contain the user's credentials
        const hasCredentials = allContent.some(
          (c) => c.includes(userCred.username) && c.includes(userCred.password),
        );
        expect(
          hasCredentials,
          `seed http-entry-usercred-${i}: no file in /var/www/html/ contains ${userCred.username}:${userCred.password}`,
        ).toBe(true);
      }
    });

    it('header-based templates produce .headers sidecar files', () => {
      let foundSidecar = false;
      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems } = buildWithHttpEntry(`http-entry-sidecar-${i}`);
        const entryFs = fileSystems[topology.entryPoint];
        const htmlDir = resolveNode(entryFs as FileNode, '/var/www/html');
        if (!htmlDir?.children) continue;

        const allFiles = collectAllFileNames(htmlDir);
        if (allFiles.some((name) => name.endsWith('.headers'))) {
          foundSidecar = true;
          break;
        }
      }
      expect(foundSidecar).toBe(true);
    });

    it('credential files are root-owned (not guest-readable)', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildWithHttpEntry(`http-entry-perms-${i}`);
        const entryFs = fileSystems[topology.entryPoint];
        const htmlDir = resolveNode(entryFs as FileNode, '/var/www/html');
        if (!htmlDir?.children) continue;

        // All non-index.html files placed by HTTP entry should be root-owned
        const credFiles = collectAllFiles(htmlDir).filter((f) => f.name !== 'index.html');
        credFiles.forEach((f) => {
          expect(f.owner).toBe('root');
          expect(f.permissions.read).not.toContain('guest');
        });
      }
    });

    it('non-entry machines do not get HTTP credential files', () => {
      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildWithHttpEntry(`http-entry-nonentry-${i}`);
        topology.machines
          .filter((m) => m.ip !== topology.entryPoint)
          .forEach((m) => {
            const fs = fileSystems[m.ip];
            const htmlDir = resolveNode(fs as FileNode, '/var/www/html');
            if (!htmlDir?.children) return;

            // Non-entry machines should only have index.html (no extra credential files)
            const childNames = Object.keys(htmlDir.children).filter((n) => !n.endsWith('.headers'));
            expect(childNames).toEqual(['index.html']);
          });
      }
    });

    it('produces deterministic output for the same seed', () => {
      const a = buildWithHttpEntry('http-entry-deterministic');
      const b = buildWithHttpEntry('http-entry-deterministic');
      expect(a.fileSystems).toEqual(b.fileSystems);
    });
  });
  describe('forensics pools', () => {
    it('has at least 5 calling card templates with {{handle}} in content', () => {
      expect(forensicsCallingCardTemplates.length).toBeGreaterThanOrEqual(5);
      for (const template of forensicsCallingCardTemplates) {
        expect(template.content).toContain('{{handle}}');
      }
    });

    it('has 3 log types', () => {
      expect(forensicsLogTypes).toEqual(['ssh', 'ftp', 'http']);
    });

    it('has noise IPs', () => {
      expect(forensicsNoiseIps.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('forensics evidence placement', () => {
    const buildForensics = (seed: string, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
      const prng = createPrng(seed);
      const topology = generateTopology(prng, difficulty);
      const { usersByMachine, credentials } = generateUsers(
        prng,
        topology.machines,
        topology.entryPoint,
      );
      const { objective } = buildMissionObjective({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        difficulty,
        objectiveTypeOverride: 'forensics',
      });
      const { fileSystems } = generateFileSystems({
        prng,
        machines: topology.machines,
        usersByMachine,
        credentials,
        objective,
        routerMachine: topology.routerMachine,
        natForwarding: topology.natForwarding,
        entryVariant: topology.entryVariant,
        entryPoint: topology.entryPoint,
        difficulty,
      });
      return { topology, fileSystems, objective, credentials };
    };

    it('places attacker IP in log files on at least one machine', () => {
      const { fileSystems, objective } = buildForensics('forensics-logs-1');
      const attackerIp = objective.attackerIp!;

      // Check all log types (auth.log, vsftpd.log, access.log)
      const allLogContent = Object.values(fileSystems).flatMap((fs) => {
        const logFiles = ['auth.log', 'vsftpd.log', 'access.log'];
        return logFiles
          .map((name) => resolveNode(fs, `/var/log/${name}`))
          .filter((node) => node?.type === 'file')
          .map((node) => node!.content ?? '');
      });
      const hasAttackerIp = allLogContent.some((c) => c.includes(attackerIp));

      expect(hasAttackerIp).toBe(true);
    });

    it('uses varied log types across seeds', () => {
      const logTypesFound = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { fileSystems } = buildForensics(`forensics-logtype-${i}`);
        for (const fs of Object.values(fileSystems)) {
          if (resolveNode(fs, '/var/log/auth.log')?.content) logTypesFound.add('ssh');
          if (resolveNode(fs, '/var/log/vsftpd.log')?.content) logTypesFound.add('ftp');
          if (resolveNode(fs, '/var/log/access.log')?.content) logTypesFound.add('http');
        }
        if (logTypesFound.size >= 3) break;
      }
      expect(logTypesFound.size).toBeGreaterThanOrEqual(2);
    });

    it('places attacker calling card file on a machine', () => {
      const { fileSystems, objective } = buildForensics('forensics-card-1');
      const handle = objective.attackerHandle!;

      const allContent = Object.values(fileSystems).flatMap((fs) => collectAllContent(fs));
      const hasCallingCard = allContent.some((c) => c.includes(handle));

      expect(hasCallingCard).toBe(true);
    });

    it('uses varied calling card placements across seeds', () => {
      const topDirs = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { fileSystems, objective } = buildForensics(`forensics-card-vary-${i}`);
        const handle = objective.attackerHandle!;
        // Find which top-level directory the calling card ended up in
        for (const fs of Object.values(fileSystems)) {
          for (const [dirName, child] of Object.entries(fs.children ?? {})) {
            if (dirName === 'var') continue; // skip log directories
            const files = collectAllFiles(child);
            if (files.some((f) => f.content?.includes(handle))) {
              topDirs.add(dirName);
            }
          }
        }
        if (topDirs.size >= 3) break;
      }
      expect(topDirs.size).toBeGreaterThanOrEqual(2);
    });

    it('includes noise log entries from non-attacker IPs', () => {
      const { fileSystems, objective } = buildForensics('forensics-noise-1');
      const attackerIp = objective.attackerIp!;

      // Collect all log file content
      const logContent = Object.values(fileSystems).flatMap((fs) => {
        return ['auth.log', 'vsftpd.log', 'access.log']
          .map((name) => resolveNode(fs, `/var/log/${name}`))
          .filter((node) => node?.type === 'file')
          .map((node) => node!.content ?? '');
      });

      // At least one log file should contain an IP that isn't the attacker's
      const allLines = logContent.flatMap((c) => c.split('\n'));
      const hasNoiseIp = allLines.some((line) => line.length > 0 && !line.includes(attackerIp));

      expect(hasNoiseIp).toBe(true);
    });

    it('hard difficulty has more noise entries than easy', () => {
      const countNoiseLines = (seed: string, difficulty: 'easy' | 'hard') => {
        const { fileSystems, objective } = buildForensics(seed, difficulty);
        const attackerIp = objective.attackerIp!;
        return Object.values(fileSystems)
          .flatMap((fs) =>
            ['auth.log', 'vsftpd.log', 'access.log']
              .map((name) => resolveNode(fs, `/var/log/${name}`))
              .filter((node) => node?.type === 'file')
              .flatMap((node) => (node!.content ?? '').split('\n')),
          )
          .filter((line) => line.length > 0 && !line.includes(attackerIp)).length;
      };

      // Average across several seeds to account for PRNG variance
      let easyTotal = 0;
      let hardTotal = 0;
      for (let i = 0; i < 20; i++) {
        easyTotal += countNoiseLines(`forensics-noise-easy-${i}`, 'easy');
        hardTotal += countNoiseLines(`forensics-noise-hard-${i}`, 'hard');
      }
      expect(hardTotal).toBeGreaterThan(easyTotal);
    });

    it('is deterministic', () => {
      const a = buildForensics('forensics-determ');
      const b = buildForensics('forensics-determ');
      expect(a.fileSystems).toEqual(b.fileSystems);
    });
  });

  describe('inner gateway filesystems', () => {
    it('inner gateways have /etc/iptables/rules.v4', () => {
      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildTestData(`gw-iptables-${i}`, 'hard');
        for (let j = 1; j < topology.layers.length; j++) {
          const gateway = topology.layers[j]!.gateway;
          const fs = fileSystems[gateway.ip];
          if (!fs) continue;
          const iptables = resolveNode(fs, '/etc/iptables/rules.v4');
          expect(iptables).toBeDefined();
          expect(iptables?.type).toBe('file');
        }
      }
    });

    it('forwarded inner gateways have populated iptables rules', () => {
      let found = false;
      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems } = buildTestData(`gw-nat-${i}`, 'medium');
        for (let j = 1; j < topology.layers.length; j++) {
          const layer = topology.layers[j]!;
          if (!layer.isForwarded) continue;
          const gateway = layer.gateway;
          const fs = fileSystems[gateway.ip];
          if (!fs) continue;
          const iptables = resolveNode(fs, '/etc/iptables/rules.v4');
          if (!iptables || iptables.type !== 'file' || !iptables.content) continue;
          // Forwarded gateways should have "forward" rules pointing to entry machine
          expect(iptables.content).toContain('forward');
          expect(iptables.content).toContain(layer.machines[0]!.ip);
          found = true;
          break;
        }
        if (found) break;
      }
      // Medium difficulty has 50% forwarded chance — should find at least one
      expect(found).toBe(true);
    });

    it('inner gateways with SNMP access variant have /etc/snmp/snmpd.conf', () => {
      let found = false;
      for (let i = 0; i < 200; i++) {
        const { topology, fileSystems, credentials } = buildTestData(`gw-snmp-${i}`, 'medium');
        for (let j = 1; j < topology.layers.length; j++) {
          const layer = topology.layers[j]!;
          const gateway = layer.gateway;
          if (gateway.accessVariant !== 'snmp') continue;

          const fs = fileSystems[gateway.ip];
          if (!fs) continue;
          const snmpConf = resolveNode(fs, '/etc/snmp/snmpd.conf');

          expect(snmpConf).toBeDefined();
          expect(snmpConf?.type).toBe('file');
          expect(snmpConf?.owner).toBe('root');

          const content = snmpConf?.content ?? '';
          // Must have community strings
          expect(content).toContain('rocommunity public');
          expect(content).toMatch(/rwcommunity \w+/);
          // Must have system info with gateway hostname
          expect(content).toContain('sysName');
          expect(content).toContain(gateway.hostname);
          // Must have firewall OIDs (initially deny)
          expect(content).toContain('firewallSSH deny');
          expect(content).toContain('firewallHTTP deny');
          // Must have leaked credentials via extend script
          const gatewayCreds = credentials[gateway.ip];
          const userCred = gatewayCreds?.find((c) => c.username !== 'root');
          if (userCred) {
            expect(content).toContain(userCred.username);
            expect(content).toContain(userCred.password);
          }

          found = true;
          break;
        }
        if (found) break;
      }
      expect(found).toBe(true);
    });

    it('inner gateway /etc/hosts lists only downstream machines', () => {
      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildTestData(`gw-hosts-${i}`, 'hard');
        for (let j = 1; j < topology.layers.length; j++) {
          const gateway = topology.layers[j]!.gateway;
          const downstreamMachines = topology.layers[j]!.machines;
          const fs = fileSystems[gateway.ip];
          if (!fs) continue;
          const hosts = resolveNode(fs, '/etc/hosts');
          if (!hosts || hosts.type !== 'file' || !hosts.content) continue;

          // Downstream machines should be in /etc/hosts
          downstreamMachines.forEach((m) => {
            expect(hosts.content).toContain(m.hostname);
          });

          // Machines from other layers (non-downstream) should NOT be listed
          const otherLayers = topology.layers.filter((_, idx) => idx !== j);
          otherLayers.forEach((layer) => {
            layer.machines.forEach((m) => {
              expect(hosts.content).not.toContain(m.ip);
            });
          });
        }
      }
    });
  });

  describe('script_auto data placement', () => {
    it('places stub script in automation location on target machine', () => {
      for (let i = 0; i < 50; i++) {
        const { fileSystems, objective } = buildTestDataWithOverride(
          `sa-stub-${i}`,
          'medium',
          'script_auto',
        );
        const targetFs = fileSystems[objective.targetMachine];
        const scriptFile = resolveNode(targetFs as FileNode, objective.targetPath);
        expect(scriptFile).toBeDefined();
        expect(scriptFile?.content).toBe(objective.targetContent);
        expect(objective.targetPath).toMatch(/\/(cron\.d|init\.d|network\/if-up\.d)\//);
      }
    });

    it('local flavor places data JSON file on target machine', () => {
      for (let i = 0; i < 100; i++) {
        const { fileSystems, objective } = buildTestDataWithOverride(
          `sa-local-fs-${i}`,
          'medium',
          'script_auto',
        );
        if (objective.scriptAutoFlavor !== 'local') continue;

        const targetFs = fileSystems[objective.targetMachine];
        const dataFile = resolveNode(targetFs as FileNode, objective.scriptAutoDataPath!);
        expect(dataFile).toBeDefined();
        expect(dataFile?.content).toBe(objective.scriptAutoDataContent);
        return;
      }
      throw new Error('No local script_auto found in 100 seeds');
    });

    it('remote flavor places API JSON on API machine', () => {
      for (let i = 0; i < 100; i++) {
        const { fileSystems, objective } = buildTestDataWithOverride(
          `sa-remote-fs-${i}`,
          'medium',
          'script_auto',
        );
        if (objective.scriptAutoFlavor !== 'remote') continue;

        const apiFs = fileSystems[objective.scriptAutoApiMachine!];
        const apiPath = `/var/www/api/${objective.scriptAutoDataPath}.json`;
        const apiFile = resolveNode(apiFs as FileNode, apiPath);
        expect(apiFile).toBeDefined();
        expect(apiFile?.content).toBe(objective.scriptAutoDataContent);
        return;
      }
      throw new Error('No remote script_auto found in 100 seeds');
    });
  });
});

// Recursively collects all text content from a FileNode tree.
const collectAllContent = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return node.content ? [node.content] : [];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllContent(child));
};

// Recursively collects all file names from a FileNode tree.
const collectAllFileNames = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return [node.name];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllFileNames(child));
};

// Recursively collects all file nodes from a FileNode tree.
const collectAllFiles = (node: FileNode | undefined): readonly FileNode[] => {
  if (!node) return [];
  if (node.type === 'file') return [node];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllFiles(child));
};
