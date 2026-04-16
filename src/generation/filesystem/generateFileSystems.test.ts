import { describe, it, expect } from 'vitest';
import { createPrng } from '../prng';
import { generateTopology } from '../topology';
import { generateUsers } from '../users';
import { buildMissionObjective } from '../attackChain';
import { generateFileSystems } from '.';
import { credentialLeakTemplates, crossMachineCredentialLeakTemplates } from '../pools';
import type { FileNode } from '../../filesystem/types';
import {
  buildTestData,
  buildTestDataWithOverride,
  resolveNode,
  collectAllContent,
  collectAllFileNames,
  collectAllFiles,
} from './testHelpers';

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

  it('machines with open SSH port have sshd.pid, closed SSH ports do not', () => {
    for (let i = 0; i < 20; i++) {
      const { topology, fileSystems } = buildTestData(`sshd-pid-${i}`);
      const allMachines = [...topology.machines, topology.routerMachine];
      allMachines.forEach((m) => {
        const sshPort = m.remoteMachine.ports.find((p) => p.service === 'ssh');
        const fs = fileSystems[m.ip];
        const pidFile = resolveNode(fs as FileNode, '/var/run/sshd.pid');
        if (sshPort?.open) {
          expect(pidFile, `${m.ip} has open SSH but no sshd.pid`).toBeDefined();
          expect(pidFile?.content).toMatch(/^sshd:port=\d+$/);
        } else if (sshPort && !sshPort.open) {
          expect(pidFile, `${m.ip} has closed SSH but sshd.pid exists`).toBeUndefined();
        }
      });
    }
  });

  it('machines with open FTP port have vsftpd.pid, closed FTP ports do not', () => {
    for (let i = 0; i < 20; i++) {
      const { topology, fileSystems } = buildTestData(`ftpd-pid-${i}`);
      const allMachines = [...topology.machines, topology.routerMachine];
      allMachines.forEach((m) => {
        const ftpPort = m.remoteMachine.ports.find((p) => p.service === 'ftp');
        const fs = fileSystems[m.ip];
        const pidFile = resolveNode(fs as FileNode, '/var/run/vsftpd.pid');
        if (ftpPort?.open) {
          expect(pidFile, `${m.ip} has open FTP but no vsftpd.pid`).toBeDefined();
          expect(pidFile?.content).toMatch(/^vsftpd:port=\d+$/);
        } else if (ftpPort && !ftpPort.open) {
          expect(pidFile, `${m.ip} has closed FTP but vsftpd.pid exists`).toBeUndefined();
        }
      });
    }
  });

  it('some inner gateways get basic rw SNMP config (statistical)', () => {
    let rwSnmpCount = 0;
    for (let i = 0; i < 200; i++) {
      const { topology, fileSystems } = buildTestData(`rw-snmp-gw-${i}`, 'hard');
      // Check inner gateways (non-SNMP-variant) for rw SNMP configs
      const innerGateways = topology.machines.filter(
        (m) => (m.role === 'router' || m.role === 'switch') && m.accessVariant !== 'snmp',
      );
      innerGateways.forEach((gw) => {
        const fs = fileSystems[gw.ip];
        if (!fs) return;
        const snmpConf = resolveNode(fs as FileNode, '/etc/snmp/snmpd.conf');
        if (snmpConf?.type === 'file' && snmpConf.content) {
          const hasRw = snmpConf.content.includes('rwcommunity');
          const hasFirewall =
            snmpConf.content.includes('firewallSSH') || snmpConf.content.includes('aclSSH');
          const hasCredLeak = snmpConf.content.includes('nsExtendArgs');
          // Basic rw: has rw community + firewall OIDs but no credential leaks
          if (hasRw && hasFirewall && !hasCredLeak) rwSnmpCount++;
        }
      });
    }
    expect(rwSnmpCount).toBeGreaterThan(0);
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

  describe('log file seeding — realistic per-destination layout', () => {
    it('every machine has auth.log, syslog, and kern.log', () => {
      const { topology, fileSystems } = buildTestData('seeding-universal');
      topology.machines.forEach((m) => {
        const root = fileSystems[m.ip];
        expect(resolveNode(root as FileNode, '/var/log/auth.log')?.content).toBeTruthy();
        expect(resolveNode(root as FileNode, '/var/log/syslog')?.content).toBeTruthy();
        expect(resolveNode(root as FileNode, '/var/log/kern.log')?.content).toBeTruthy();
      });
    });

    it('auth.log only contains authentication-related lines', () => {
      const { topology, fileSystems } = buildTestData('seeding-authlog');
      topology.machines.forEach((m) => {
        const root = fileSystems[m.ip];
        const content = resolveNode(root as FileNode, '/var/log/auth.log')?.content ?? '';
        // Auth.log must not contain kernel, postfix, CRON, dhclient, or systemd start/stop messages
        expect(content).not.toMatch(/kernel:/);
        expect(content).not.toMatch(/postfix\//);
        expect(content).not.toMatch(/CRON\[/);
        expect(content).not.toMatch(/dhclient\[/);
        expect(content).not.toMatch(/systemd\[1\]:/);
        // It must contain at least one auth-family entry (sshd, sudo, su, or systemd-logind)
        expect(content).toMatch(/(sshd\[|sudo:|su\[|systemd-logind\[)/);
      });
    });

    it('kern.log only contains kernel-related lines', () => {
      const { topology, fileSystems } = buildTestData('seeding-kernlog');
      topology.machines.forEach((m) => {
        const root = fileSystems[m.ip];
        const content = resolveNode(root as FileNode, '/var/log/kern.log')?.content ?? '';
        // kern.log must not contain userspace service lines
        expect(content).not.toMatch(/sshd\[/);
        expect(content).not.toMatch(/sudo:/);
        expect(content).not.toMatch(/CRON\[/);
        expect(content).not.toMatch(/postfix\//);
        // It must contain at least one kernel entry
        expect(content).toMatch(/kernel:/);
      });
    });

    it('syslog contains generic system messages and excludes auth lines', () => {
      const { topology, fileSystems } = buildTestData('seeding-syslog');
      topology.machines.forEach((m) => {
        const root = fileSystems[m.ip];
        const content = resolveNode(root as FileNode, '/var/log/syslog')?.content ?? '';
        expect(content).toBeTruthy();
        // Syslog should not contain sshd auth entries (those are in auth.log)
        expect(content).not.toMatch(/sshd\[.*(Accepted password|Failed password)/);
      });
    });

    it('webserver role machines have access.log with Apache Combined entries', () => {
      const { topology, fileSystems } = buildTestData('seeding-webserver');
      const webservers = topology.machines.filter((m) => m.role === 'webserver');
      // Test seed should produce at least one webserver
      expect(webservers.length).toBeGreaterThan(0);
      webservers.forEach((m) => {
        const root = fileSystems[m.ip];
        const content = resolveNode(root as FileNode, '/var/log/access.log')?.content ?? '';
        expect(content).toBeTruthy();
        // Apache Combined lines start with an IP and have a quoted HTTP request
        expect(content).toMatch(/\d+\.\d+\.\d+\.\d+ - - \[.*\] "[A-Z]+ .* HTTP\/1\.1" \d+ \d+/);
      });
    });

    it('fileserver role machines have vsftpd.log with vsftpd-format entries', () => {
      let found = false;
      for (let i = 0; i < 30 && !found; i++) {
        const { topology, fileSystems } = buildTestData(`seeding-fileserver-${i}`);
        const fileservers = topology.machines.filter((m) => m.role === 'fileserver');
        if (fileservers.length === 0) continue;
        found = true;
        fileservers.forEach((m) => {
          const root = fileSystems[m.ip];
          const content = resolveNode(root as FileNode, '/var/log/vsftpd.log')?.content ?? '';
          expect(content).toBeTruthy();
          // vsftpd lines look like "[YYYY-MM-DD HH:MM:SS] EVENT: ..."
          expect(content).toMatch(
            /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] (CONNECT|OK LOGIN|FAIL LOGIN|OK DOWNLOAD|OK UPLOAD):/,
          );
        });
      }
      expect(found).toBe(true);
    });

    it('database role machines have mysql.log when MySQL port is open', () => {
      let found = false;
      for (let i = 0; i < 30 && !found; i++) {
        const { topology, fileSystems } = buildTestData(`seeding-database-${i}`);
        const databasesWithMysql = topology.machines.filter(
          (m) =>
            m.role === 'database' &&
            m.remoteMachine.ports.some((p) => p.service === 'mysql' && p.open),
        );
        if (databasesWithMysql.length === 0) continue;
        found = true;
        databasesWithMysql.forEach((m) => {
          const root = fileSystems[m.ip];
          const content = resolveNode(root as FileNode, '/var/log/mysql.log')?.content ?? '';
          expect(content).toBeTruthy();
          // MySQL general log lines start with an ISO timestamp
          expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
      }
      expect(found).toBe(true);
    });

    it('mailserver role machines have mail.log with postfix entries', () => {
      // Force a mailserver by iterating many seeds until one shows up
      let found = false;
      for (let i = 0; i < 30 && !found; i++) {
        const { topology, fileSystems } = buildTestData(`seeding-mailserver-${i}`);
        const mailservers = topology.machines.filter((m) => m.role === 'mailserver');
        if (mailservers.length === 0) continue;
        found = true;
        mailservers.forEach((m) => {
          const root = fileSystems[m.ip];
          const content = resolveNode(root as FileNode, '/var/log/mail.log')?.content ?? '';
          expect(content).toBeTruthy();
          expect(content).toMatch(/postfix\/(smtpd|smtp)\[/);
        });
      }
      expect(found).toBe(true);
    });

    it('workstation role machines do NOT have access.log, vsftpd.log, mysql.log, or mail.log', () => {
      let checked = 0;
      for (let i = 0; i < 30 && checked < 3; i++) {
        const { topology, fileSystems } = buildTestData(`seeding-workstation-${i}`);
        const workstations = topology.machines.filter((m) => m.role === 'workstation');
        workstations.forEach((m) => {
          checked++;
          const root = fileSystems[m.ip];
          expect(resolveNode(root as FileNode, '/var/log/access.log')).toBeUndefined();
          expect(resolveNode(root as FileNode, '/var/log/vsftpd.log')).toBeUndefined();
          expect(resolveNode(root as FileNode, '/var/log/mysql.log')).toBeUndefined();
          expect(resolveNode(root as FileNode, '/var/log/mail.log')).toBeUndefined();
        });
      }
      expect(checked).toBeGreaterThan(0);
    });

    it('every machine has /var/lib/dpkg/status with an entry per unique running service', () => {
      const { topology, fileSystems } = buildTestData('dpkg-status-test');
      topology.machines.forEach((m) => {
        const root = fileSystems[m.ip];
        const statusFile = resolveNode(root as FileNode, '/var/lib/dpkg/status');
        expect(statusFile).toBeDefined();
        const content = statusFile?.content ?? '';
        // Every unique running service on the machine should be represented
        const uniqueServices = new Set(m.remoteMachine.ports.map((p) => p.service));
        uniqueServices.forEach((service) => {
          expect(content).toContain(`Package: ${service}`);
        });
      });
    });

    it('router machines have kern.log (replacing the old firewall.log) with iptables entries', () => {
      const { topology, fileSystems } = buildTestData('seeding-router');
      const root = fileSystems[topology.routerMachine.ip];
      const kernLog = resolveNode(root as FileNode, '/var/log/kern.log')?.content ?? '';
      expect(kernLog).toBeTruthy();
      // Should contain iptables-format entries alongside generic kernel lines
      expect(kernLog).toMatch(/kernel: \[iptables\] (ACCEPT|DROP)/);
      // The legacy firewall.log should no longer exist
      expect(resolveNode(root as FileNode, '/var/log/firewall.log')).toBeUndefined();
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
        const { topology, fileSystems, credentials } = buildTestData(`cred-leak-user-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;

          const creds = credentials[m.ip] ?? [];
          const rootCred = creds.find((c) => c.username === 'root');
          const guestCred = creds.find((c) => c.username === 'guest');

          credentialLeakTemplates.forEach((t) => {
            // Skip DB-themed templates (they use MySQL credentials, not system credentials)
            if (t.credentialType === 'mysql') return;
            const node = resolveNode(fs, t.path);
            if (!node?.content) return;

            // Verify root/guest passwords don't appear as the leaked credential.
            // Check passwords (not usernames) since "root" can appear in template boilerplate.
            if (rootCred) {
              expect(node.content).not.toContain(rootCred.password);
            }
            if (guestCred) {
              expect(node.content).not.toContain(guestCred.password);
            }
          });
        });
      }
    });

    it('same-machine leaked files are guest-readable', () => {
      for (let i = 0; i < 50; i++) {
        const { topology, fileSystems } = buildTestData(`cred-leak-perms-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;

          credentialLeakTemplates.forEach((t) => {
            const node = resolveNode(fs, t.path);
            if (!node?.content) return;
            // Only check files that are guest-owned (same-machine leaks).
            // Cross-machine credential files are root/user-owned and may land
            // at overlapping paths via findLeafDir merge.
            if (node.owner === 'guest') {
              expect(node.permissions.read).toContain('guest');
            }
          });
        });
      }
    });

    it('binary templates produce files that contain credentials extractable via strings', () => {
      const systemBinaryTemplates = credentialLeakTemplates.filter(
        (t) => t.binary && t.credentialType !== 'mysql',
      );
      expect(systemBinaryTemplates.length).toBeGreaterThanOrEqual(1);

      for (let i = 0; i < 100; i++) {
        const { topology, fileSystems, credentials } = buildTestData(`cred-leak-binary-${i}`);
        topology.machines.forEach((m) => {
          const fs = fileSystems[m.ip];
          if (!fs) return;
          const creds = credentials[m.ip] ?? [];
          const userCred = creds.find((c) => c.username !== 'root' && c.username !== 'guest');
          if (!userCred) return;

          systemBinaryTemplates.forEach((t) => {
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

    it('non-entry machines do not get HTTP entry credential files', () => {
      // Web credential webPaths that CAN appear on non-entry machines (~30% chance)
      const webCredPaths = new Set([
        '.env.bak',
        'config.php.bak',
        'api',
        'backup',
        'install.php',
        '.well-known',
        'metrics',
        'debug',
        'sitemap.xml',
      ]);

      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildWithHttpEntry(`http-entry-nonentry-${i}`);
        topology.machines
          .filter((m) => m.ip !== topology.entryPoint)
          .forEach((m) => {
            const fs = fileSystems[m.ip];
            const htmlDir = resolveNode(fs as FileNode, '/var/www/html');
            if (!htmlDir?.children) return;

            // Non-entry machines may have web credential files but not entry-only files.
            // Both sets share some top-level dirs (api, backup), so we check actual file
            // names/paths rather than just top-level dirs.
            const childNames = Object.keys(htmlDir.children).filter(
              (n) => n !== 'index.html' && !n.endsWith('.headers'),
            );
            for (const name of childNames) {
              // Must be a web credential path, not an entry-only path
              expect(
                webCredPaths.has(name),
                `Non-entry machine ${m.ip} has unexpected web file: ${name}`,
              ).toBe(true);
            }
          });
      }
    });

    it('produces deterministic output for the same seed', () => {
      const a = buildWithHttpEntry('http-entry-deterministic');
      const b = buildWithHttpEntry('http-entry-deterministic');
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

    it('border router /etc/hosts lists only layer 0 machines and first gateway', () => {
      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildTestData(`router-hosts-${i}`, 'hard');
        const routerFs = fileSystems[topology.routerMachine.ip];
        if (!routerFs) continue;
        const hosts = resolveNode(routerFs, '/etc/hosts');
        if (!hosts || hosts.type !== 'file' || !hosts.content) continue;

        // Layer 0 machines should be listed
        topology.layers[0]!.machines.forEach((m) => {
          expect(hosts.content).toContain(m.hostname);
        });

        // First inner gateway should be listed (if multi-layer)
        if (topology.layers.length > 1) {
          expect(hosts.content).toContain(topology.layers[1]!.gateway.hostname);
        }

        // Machines from deeper layers (1+) should NOT be listed
        topology.layers.slice(1).forEach((layer) => {
          layer.machines.forEach((m) => {
            expect(hosts.content).not.toContain(m.ip);
          });
        });
      }
    });

    it('gateway .1 alias IPs have filesystems matching their upstream IP', () => {
      for (let i = 0; i < 20; i++) {
        const { topology, fileSystems } = buildTestData(`gw-alias-${i}`, 'hard');

        // Border router: layer 0's .1 should alias the router filesystem
        const routerAliasIp = `${topology.layers[0]!.subnet}.1`;
        const routerFs = fileSystems[topology.routerMachine.ip];
        expect(fileSystems[routerAliasIp]).toBeDefined();
        expect(fileSystems[routerAliasIp]).toBe(routerFs);

        // Inner gateways: each layer's .1 should alias that gateway's filesystem
        for (let j = 1; j < topology.layers.length; j++) {
          const layer = topology.layers[j]!;
          const gatewayAliasIp = `${layer.subnet}.1`;
          const gatewayFs = fileSystems[layer.gateway.ip];
          expect(fileSystems[gatewayAliasIp]).toBeDefined();
          expect(fileSystems[gatewayAliasIp]).toBe(gatewayFs);
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

  describe('cross-machine credential placement', () => {
    it('cross-machine leak files reference a valid same-layer machine IP', () => {
      let foundCrossMachineLeak = false;
      for (let i = 0; i < 100 && !foundCrossMachineLeak; i++) {
        const { topology, fileSystems } = buildTestData(`xmachine-cred-${i}`, 'medium');
        const allIps = new Set(topology.machines.map((m) => m.ip));

        for (const machine of topology.machines) {
          const fs = fileSystems[machine.ip];
          if (!fs) continue;

          for (const t of crossMachineCredentialLeakTemplates) {
            // Template paths may contain {{owner}} — check all user variants
            const users = topology.machines
              .filter((m) => m.ip === machine.ip)
              .flatMap(() => ['root', 'user', 'guest']);
            const paths = [t.path, ...users.map((u) => t.path.replace('{{owner}}', u))];

            for (const path of paths) {
              const node = resolveNode(fs as FileNode, path);
              if (!node?.content) continue;

              // File should reference a valid network IP
              const ipMatch = node.content.match(/\d+\.\d+\.\d+\.\d+/);
              if (ipMatch && allIps.has(ipMatch[0]) && ipMatch[0] !== machine.ip) {
                foundCrossMachineLeak = true;
                // Cross-machine leaks are NOT guest-readable
                expect(node.permissions.read).not.toContain('guest');
              }
            }
          }
        }
      }
      expect(foundCrossMachineLeak).toBe(true);
    });

    it('cross-machine leaks are not placed on target machines', () => {
      for (let i = 0; i < 50; i++) {
        const { objective, fileSystems } = buildTestData(`xmachine-target-${i}`, 'medium');
        const targetFs = fileSystems[objective.targetMachine];
        if (!targetFs) continue;

        for (const t of crossMachineCredentialLeakTemplates) {
          const node = resolveNode(targetFs as FileNode, t.path);
          if (!node?.content) continue;
          // If a file exists at a cross-machine template path on the target,
          // it should not reference another machine (it was skipped)
          const ips = [...node.content.matchAll(/\d+\.\d+\.\d+\.\d+/g)].map((m) => m[0]);
          const referencesOther = ips.some((ip) => ip !== objective.targetMachine);
          // Cross-machine leaks on target should be suppressed, but same-machine
          // leaks may exist at overlapping paths. Just verify no cross-machine reference.
          if (referencesOther && node.owner !== 'guest') {
            // This would be a cross-machine leak on target — should not happen
            expect.unreachable(
              `Target machine ${objective.targetMachine} has cross-machine credential at ${t.path}`,
            );
          }
        }
      }
    });
  });

  describe('web credential placement on non-entry machines', () => {
    it('web-serving machines can have credential files in /var/www/html/', () => {
      let foundWebCred = false;
      for (let i = 0; i < 100 && !foundWebCred; i++) {
        const { topology, fileSystems } = buildTestData(`webcred-${i}`, 'medium');
        for (const machine of topology.machines) {
          const hasHttpPort = machine.remoteMachine.ports.some(
            (p) =>
              p.open && (p.service === 'http' || p.service === 'https' || p.service === 'http-alt'),
          );
          if (!hasHttpPort) continue;

          const fs = fileSystems[machine.ip];
          const htmlDir = resolveNode(fs as FileNode, '/var/www/html');
          if (!htmlDir?.children) continue;

          const extraFiles = Object.keys(htmlDir.children).filter(
            (n) => n !== 'index.html' && !n.endsWith('.headers'),
          );
          if (extraFiles.length > 0) {
            foundWebCred = true;
          }
        }
      }
      expect(foundWebCred).toBe(true);
    });

    it('header-based web credentials produce .headers sidecar files', () => {
      let foundHeaders = false;
      for (let i = 0; i < 100 && !foundHeaders; i++) {
        const { topology, fileSystems } = buildTestData(`webcred-header-${i}`, 'medium');
        for (const machine of topology.machines) {
          const fs = fileSystems[machine.ip];
          const htmlDir = resolveNode(fs as FileNode, '/var/www/html');
          if (!htmlDir?.children) continue;

          const headerFiles = collectAllFileNames(htmlDir).filter((n) => n.endsWith('.headers'));
          if (headerFiles.length > 0) {
            foundHeaders = true;
          }
        }
      }
      expect(foundHeaders).toBe(true);
    });
  });
});
