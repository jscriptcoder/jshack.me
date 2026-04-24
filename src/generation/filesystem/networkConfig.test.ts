import { describe, it, expect } from 'vitest';
import { createPrng } from '../prng';
import { generateTopology } from '../topology';
import { generateUsers } from '../users';
import { buildMissionObjective } from '../attackChain';
import { generateFileSystems } from '.';
import { generateBasicRwSnmpConfig } from './networkConfig';
import type { FileNode } from '../../filesystem/types';
import { resolveNode } from './testHelpers';

describe('iptables rules file on router', async () => {
  const buildWithRouter = async (seed: string) => {
    const prng = createPrng(seed);
    const topology = await generateTopology(prng, 'medium');
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

  it('forwarded mode: router has /etc/iptables/rules.v4 with forward rules', async () => {
    const { topology, fileSystems } = await buildWithRouter('iptables-forwarded-forwarded');
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

  it('forwarded mode: rules match NAT forwarding exactly', async () => {
    // Use explicit forwarded seed to guarantee forwarded mode
    for (let i = 0; i < 50; i++) {
      const data = await buildWithRouter(`iptables-fwd-exact-${i}-forwarded`);
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

  it('router-first mode: rules file exists but has no forward lines', async () => {
    for (let i = 0; i < 50; i++) {
      const data = await buildWithRouter(`iptables-routerfirst-${i}-router-first`);
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

  it('iptables file is root-owned', async () => {
    const data = await buildWithRouter('iptables-owner-test-forwarded');
    const routerFs = data.fileSystems[data.topology.routerMachine.ip];
    const rulesFile = resolveNode(routerFs as FileNode, '/etc/iptables/rules.v4');

    expect(rulesFile).toBeDefined();
    expect(rulesFile?.owner).toBe('root');
    // mkFile('root') produces ['root', 'root'] — only root can write
    expect(rulesFile?.permissions.write).toEqual(['root', 'root']);
  });
});

describe('SNMP config file on router', async () => {
  const buildWithSnmpRouter = async (seed: string) => {
    const prng = createPrng(seed);
    const topology = await generateTopology(prng, 'hard', { entryVariantOverride: 'snmp' });
    const { usersByMachine, credentials } = generateUsers(
      prng,
      topology.machines,
      topology.entryPoint,
    );
    // Generate router users separately (same pattern as generateMissionNetwork)
    const { usersByMachine: routerUsersByMachine, credentials: routerCredentials } = generateUsers(
      prng,
      [topology.routerMachine],
      '',
    );
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

  it('SNMP router has /etc/snmp/snmpd.conf with community strings and OID data', async () => {
    const { topology, fileSystems, credentials } = await buildWithSnmpRouter('snmp-fs-test');
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

  it('snmpd.conf is deterministic for the same seed', async () => {
    const a = await buildWithSnmpRouter('snmp-determ');
    const b = await buildWithSnmpRouter('snmp-determ');
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

describe('basic read-write SNMP config on inner gateways', async () => {
  it('has rw community, firewall/ACL OIDs, but no credential leaks', async () => {
    const config = generateBasicRwSnmpConfig(
      createPrng('rw-snmp-test'),
      'gateway01',
      '10.0.0.50',
      '10.0.1.1',
      false,
    );
    expect(config).toContain('rocommunity public');
    expect(config).toMatch(/rwcommunity \w+/);
    expect(config).toContain('firewallSSH deny');
    expect(config).toContain('firewallHTTP deny');
    expect(config).toContain('ifAddr.1 10.0.0.50');
    expect(config).toContain('ifAddr.2 10.0.1.1');
    // No credential leaks
    expect(config).not.toContain('nsExtendArgs');
  });

  it('uses ACL OIDs for switch gateways', async () => {
    const config = generateBasicRwSnmpConfig(
      createPrng('rw-snmp-switch'),
      'switch01',
      '10.0.0.50',
      '10.0.1.1',
      true,
    );
    expect(config).toContain('aclSSH deny');
    expect(config).toContain('aclHTTP deny');
    expect(config).not.toContain('firewallSSH');
  });

  it('uses Cisco sysDescr for switch gateways', async () => {
    const config = generateBasicRwSnmpConfig(
      createPrng('rw-snmp-switch-desc'),
      'switch01',
      '10.0.0.50',
      '10.0.1.1',
      true,
    );
    expect(config).toContain('Cisco IOS L3 Switch');
    expect(config).toContain('GigabitEthernet0/1');
  });
});
