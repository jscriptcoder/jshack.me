import type { Prng } from '../prng';
import type { GeneratedMachine, NatForwarding } from '../types';
import { snmpRwCommunities } from '../pools';

// Generates the content for /etc/switch/acl.conf on managed switches.
// Deny rules block SSH and HTTP traffic to the downstream subnet.
// Players must clear these rules (via nano or snmpset) to access downstream machines.
export const generateAclContent = (downstreamSubnet: string): string => {
  const lines = [
    '# Access Control List',
    '# Syntax: <action> <proto> any <subnet> port <port>',
    `deny tcp any ${downstreamSubnet}.0/24 port 22`,
    `deny tcp any ${downstreamSubnet}.0/24 port 80`,
  ];
  return lines.join('\n');
};

// Generates the content for /etc/iptables/rules.v4 on the router.
// Forwarded mode: pre-populated with forward rules matching NAT config.
// Router-first mode (no NAT): only comments and an empty template.
export const generateIptablesContent = (natForwarding?: NatForwarding): string => {
  const lines = [
    '# Port Forwarding Rules',
    '# forward <public_port> to <internal_ip>:<port>',
    ...(natForwarding
      ? natForwarding.rules.map(
          (rule) => `forward ${rule.publicPort} to ${rule.internalIp}:${rule.internalPort}`,
        )
      : []),
  ];

  return lines.join('\n');
};

// Generates /etc/snmp/snmpd.conf content for SNMP-variant routers.
// Contains community strings, system OIDs, interface data, extend script args
// with leaked credentials, and firewall OIDs (initially deny).
export const generateSnmpConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  secondaryIp?: string,
): string => {
  const rwCommunity = prng.pick(snmpRwCommunities);
  const userCred = machineCreds.find((c) => c.username !== 'root') ?? machineCreds[0];

  const lines = [
    '# SNMP Daemon Configuration',
    '# net-snmp 5.9.1',
    '',
    '# Community strings',
    'rocommunity public',
    `rwcommunity ${rwCommunity}`,
    '',
    '# System information',
    `sysDescr Linux ${machine.hostname} 5.4.0-generic #1 SMP`,
    `sysName ${machine.hostname}`,
    `sysContact netops@corp.local`,
    '',
    '# Interfaces',
    'ifDescr.1 eth0',
    'ifDescr.2 eth1',
    `ifAddr.1 ${machine.ip}`,
    ...(secondaryIp ? [`ifAddr.2 ${secondaryIp}`] : []),
    '',
    '# Extend scripts',
    ...(userCred
      ? [`nsExtendArgs.backup --user ${userCred.username} --pass ${userCred.password}`]
      : []),
    '',
    '# Firewall OIDs',
    'firewallSSH deny',
    'firewallHTTP deny',
  ];

  return lines.join('\n');
};

// Generates /etc/snmp/snmpd.conf content for SNMP-variant managed switches.
// Contains community strings, system OIDs, interface data, extend script args
// with leaked credentials, and ACL OIDs (initially deny).
export const generateSwitchSnmpConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  secondaryIp?: string,
): string => {
  const rwCommunity = prng.pick(snmpRwCommunities);
  const userCred = machineCreds.find((c) => c.username !== 'root') ?? machineCreds[0];

  const lines = [
    '# SNMP Daemon Configuration',
    '# net-snmp 5.9.1',
    '',
    '# Community strings',
    'rocommunity public',
    `rwcommunity ${rwCommunity}`,
    '',
    '# System information',
    `sysDescr Cisco IOS L3 Switch ${machine.hostname} 15.2(4)E`,
    `sysName ${machine.hostname}`,
    `sysContact netadmin@corp.local`,
    '',
    '# Interfaces',
    'ifDescr.1 GigabitEthernet0/1',
    'ifDescr.2 GigabitEthernet0/2',
    `ifAddr.1 ${machine.ip}`,
    ...(secondaryIp ? [`ifAddr.2 ${secondaryIp}`] : []),
    '',
    '# Extend scripts',
    ...(userCred
      ? [`nsExtendArgs.backup --user ${userCred.username} --pass ${userCred.password}`]
      : []),
    '',
    '# ACL OIDs',
    'aclSSH deny',
    'aclHTTP deny',
  ];

  return lines.join('\n');
};

// Generates a lightweight /etc/snmp/snmpd.conf for non-SNMP-variant gateways.
// Read-only public community, system info, and interface data only — no rw community,
// no credential leaks, no firewall/ACL OIDs. Allows players to discover dual-homed
// gateways via snmpwalk with public community.
export const generateBasicSnmpConfig = (
  hostname: string,
  primaryIp: string,
  secondaryIp: string,
  isSwitch: boolean,
): string => {
  const sysDescr = isSwitch
    ? `Cisco IOS L3 Switch ${hostname} 15.2(4)E`
    : `Linux ${hostname} 5.4.0-generic #1 SMP`;
  const ifNames = isSwitch ? ['GigabitEthernet0/1', 'GigabitEthernet0/2'] : ['eth0', 'eth1'];

  const lines = [
    '# SNMP Daemon Configuration',
    '# net-snmp 5.9.1',
    '',
    '# Community strings',
    'rocommunity public',
    '',
    '# System information',
    `sysDescr ${sysDescr}`,
    `sysName ${hostname}`,
    `sysContact netops@corp.local`,
    '',
    '# Interfaces',
    `ifDescr.1 ${ifNames[0]}`,
    `ifDescr.2 ${ifNames[1]}`,
    `ifAddr.1 ${primaryIp}`,
    `ifAddr.2 ${secondaryIp}`,
  ];

  return lines.join('\n');
};
