import type { RemoteMachine } from './types';
import type { GeneratedMachine, NatForwardingRule, SubnetLayer } from '../generation/types';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import type { SshdPortOverride } from './sshdStateParser';
import type { FtpdPortOverride } from './ftpdStateParser';
import type { NcPortOverride } from './ncStateParser';
import { parseSshdState } from './sshdStateParser';
import { parseFtpdState } from './ftpdStateParser';
import { parseNcPidFiles } from './ncStateParser';
import type { FileNode } from '../filesystem/types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import { SSH_PID_FILE_PATH } from '../commands/sshd';
import { FTP_PID_FILE_PATH } from '../commands/vsftpd';

// Builds a merged view of the router that includes NAT-forwarded ports from
// internal machines, remapped to their public port numbers.
export const buildMergedRouterView = (
  routerMachine: GeneratedMachine,
  missionMachines: readonly GeneratedMachine[],
  rules: readonly NatForwardingRule[],
): RemoteMachine => {
  // Collect internal machines referenced by forwarding rules
  const forwardedIps = new Set(rules.map((r) => r.internalIp));
  const forwardedMachines = missionMachines.filter((m) => forwardedIps.has(m.ip));

  // Forwarded ports mapped to their public port numbers
  const forwardedPorts = rules
    .map((rule) => {
      const machine = forwardedMachines.find((m) => m.ip === rule.internalIp);
      const internalPort = machine?.remoteMachine.ports.find(
        (p) => p.port === rule.internalPort && p.open,
      );
      if (!internalPort) return undefined;
      return { ...internalPort, port: rule.publicPort };
    })
    .filter((p) => p !== undefined);

  // Deduplicate: forwarded ports override router ports on collision
  const forwardedPortNumbers = new Set(forwardedPorts.map((p) => p.port));
  const routerOnlyPorts = routerMachine.remoteMachine.ports.filter(
    (p) => !forwardedPortNumbers.has(p.port),
  );

  // Merge users: router's own + forwarded machines', deduplicated by username
  const allUsers = [
    ...routerMachine.remoteMachine.users,
    ...forwardedMachines.flatMap((m) => m.remoteMachine.users),
  ];
  const seenUsernames = new Set<string>();
  const uniqueUsers = allUsers.filter((u) => {
    if (seenUsernames.has(u.username)) return false;
    seenUsernames.add(u.username);
    return true;
  });

  return {
    ip: routerMachine.ip,
    hostname: routerMachine.hostname,
    ports: [...routerOnlyPorts, ...forwardedPorts],
    users: uniqueUsers,
  };
};

// Applies SNMP firewall overrides to the router's ports.
// When snmpset changes firewallSSH to "permit", port 22 opens dynamically.
export const applySnmpFirewallOverrides = (
  machine: RemoteMachine,
  overrides: readonly SnmpFirewallOverride[],
): RemoteMachine => {
  const overrideMap = new Map(overrides.map((o) => [o.port, o.open]));
  return {
    ...machine,
    ports: machine.ports.map((p) => {
      const overrideOpen = overrideMap.get(p.port);
      if (overrideOpen === undefined) return p;
      return { ...p, open: overrideOpen };
    }),
  };
};

// Applies daemon port overrides to a machine. When the player starts a daemon
// (sshd/ftpd) from an NC shell, it writes a pid file. This function either
// opens an existing closed port or adds a new port entry. Closed ports whose
// service is already handled by a daemon on a different port are removed to
// avoid showing duplicate services (e.g. closed port 22 + open port 2223).
type DaemonOverride = SshdPortOverride | FtpdPortOverride | NcPortOverride;

export const applyDaemonOverrides = (
  machine: RemoteMachine,
  overrides: readonly DaemonOverride[],
): RemoteMachine => {
  const overrideMap = new Map(overrides.map((o) => [o.port, o]));
  const overrideServices: ReadonlySet<string> = new Set(overrides.map((o) => o.service));
  const existingPorts = machine.ports
    .filter((p) => {
      // Remove closed ports whose service is handled by a daemon on a different port
      if (!p.open && overrideServices.has(p.service) && !overrideMap.has(p.port)) return false;
      return true;
    })
    .map((p) => {
      const override = overrideMap.get(p.port);
      if (!override) return p;
      overrideMap.delete(p.port);
      return {
        ...p,
        open: true,
        service: override.service,
        ...('owner' in override ? { owner: override.owner } : {}),
      };
    });
  // Add new ports that didn't exist in the machine's port list
  const newPorts = [...overrideMap.values()].map((o) => ({
    port: o.port,
    service: o.service,
    open: true as const,
    ...('owner' in o ? { owner: o.owner } : {}),
  }));
  return { ...machine, ports: [...existingPorts, ...newPorts] };
};

// ---------------------------------------------------------------------------
// Gateway IP collection & alias mapping
// ---------------------------------------------------------------------------

// Collects all gateway IPs for iptables/SNMP parsing. Home network gateways
// are reachable at both their primary IP and their internal .1 alias, so both
// are included to ensure lookups work from any viewer.
export const collectGatewayIps = (
  missionRouterMachine: GeneratedMachine | undefined,
  missionLayers: readonly SubnetLayer[] | undefined,
  homeNetwork: HomeNetwork | null | undefined,
): readonly string[] => {
  const ips: string[] = [];
  if (missionRouterMachine) ips.push(missionRouterMachine.ip);
  if (missionLayers && missionLayers.length > 1) {
    missionLayers.slice(1).forEach((layer) => ips.push(layer.gateway.ip));
  }
  if (homeNetwork) {
    ips.push(homeNetwork.routerMachine.ip);
    ips.push(homeNetwork.router.internalIp);
    if (homeNetwork.layers.length > 1) {
      homeNetwork.layers.slice(1).forEach((layer) => {
        ips.push(layer.gateway.ip);
        ips.push(`${layer.subnet}.1`);
      });
    }
  }
  return ips;
};

// Maps gateway .1 alias IPs to their GeneratedMachine. The border router and
// inner gateways are visible at .1 IPs from inside the network, but their
// GeneratedMachine uses the primary IP. This bridges the gap for merged views.
export const buildGatewayAliasMap = (
  homeNetwork: HomeNetwork | null | undefined,
): ReadonlyMap<string, GeneratedMachine> => {
  if (!homeNetwork) return new Map();
  const map = new Map<string, GeneratedMachine>();
  map.set(homeNetwork.router.internalIp, homeNetwork.routerMachine);
  if (homeNetwork.layers.length > 1) {
    homeNetwork.layers.slice(1).forEach((layer) => {
      map.set(`${layer.subnet}.1`, layer.gateway);
    });
  }
  return map;
};

// ---------------------------------------------------------------------------
// Mission router view (iptables + SNMP applied)
// ---------------------------------------------------------------------------

// Builds the final RemoteMachine view for the mission router by applying
// iptables NAT merge and SNMP firewall overrides. Used when making the
// mission router visible from localhost.
export const buildRouterRemoteView = (
  routerMachine: GeneratedMachine,
  missionMachines: readonly GeneratedMachine[],
  iptablesRules: readonly NatForwardingRule[],
  snmpOverrides: readonly SnmpFirewallOverride[],
): RemoteMachine => {
  const base =
    iptablesRules.length > 0
      ? buildMergedRouterView(routerMachine, missionMachines, iptablesRules)
      : routerMachine.remoteMachine;
  return snmpOverrides.length > 0 ? applySnmpFirewallOverrides(base, snmpOverrides) : base;
};

// ---------------------------------------------------------------------------
// Per-machine dynamic overrides
// ---------------------------------------------------------------------------

type NodeReader = (machineId: string, path: string, cwd: string) => FileNode | null;

export type DynamicOverrideContext = {
  readonly allIptablesRules: ReadonlyMap<string, readonly NatForwardingRule[]>;
  readonly allSnmpOverrides: ReadonlyMap<string, readonly SnmpFirewallOverride[]>;
  readonly missionMachines?: readonly GeneratedMachine[];
  readonly homeMachines?: readonly GeneratedMachine[];
  readonly homeGatewayByAliasIp: ReadonlyMap<string, GeneratedMachine>;
  readonly readNode: NodeReader;
};

// Applies all dynamic overrides to a visible machine: gateway NAT merge,
// SNMP firewall, and daemon state (sshd, ftpd, nc listeners).
export const applyDynamicOverrides = (
  machine: RemoteMachine,
  ctx: DynamicOverrideContext,
): RemoteMachine => {
  let result = machine;

  // Gateway NAT merged view: show forwarded ports to upstream machines.
  const gatewayRules = ctx.allIptablesRules.get(machine.ip);
  if (gatewayRules && gatewayRules.length > 0) {
    const missionGateway = ctx.missionMachines?.find((m) => m.ip === machine.ip);
    if (missionGateway) {
      result = buildMergedRouterView(missionGateway, ctx.missionMachines!, gatewayRules);
    } else {
      const homeGateway =
        ctx.homeMachines?.find((m) => m.ip === machine.ip) ??
        ctx.homeGatewayByAliasIp.get(machine.ip);
      if (homeGateway && ctx.homeMachines) {
        result = buildMergedRouterView(homeGateway, ctx.homeMachines, gatewayRules);
      }
    }
  }

  // SNMP firewall overrides
  const snmpOverrides = ctx.allSnmpOverrides.get(machine.ip);
  if (snmpOverrides && snmpOverrides.length > 0) {
    result = applySnmpFirewallOverrides(result, snmpOverrides);
  }

  // Daemon state: sshd
  const sshdNode = ctx.readNode(machine.ip, SSH_PID_FILE_PATH, '/');
  if (sshdNode?.type === 'file' && sshdNode.content) {
    const overrides = parseSshdState(sshdNode.content);
    if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
  }

  // Daemon state: ftpd
  const ftpdNode = ctx.readNode(machine.ip, FTP_PID_FILE_PATH, '/');
  if (ftpdNode?.type === 'file' && ftpdNode.content) {
    const overrides = parseFtpdState(ftpdNode.content);
    if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
  }

  // Daemon state: nc listeners
  const varRunNode = ctx.readNode(machine.ip, '/var/run', '/');
  const ncOverrides = parseNcPidFiles(varRunNode);
  if (ncOverrides.length > 0) result = applyDaemonOverrides(result, ncOverrides);

  return result;
};
