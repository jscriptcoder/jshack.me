import type { RemoteMachine } from './types';
import type {
  GeneratedMachine,
  MissionNetwork,
  NatForwardingRule,
  SubnetLayer,
} from '../generation/types';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import type { AclRule } from './aclParser';
import { isPortDeniedByAcl } from './aclParser';
import type { SnmpAclOverride } from './snmpAclParser';
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
import { defaultServiceVersion } from '../generation/pools/vulnerabilities';

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
    serviceVersion: defaultServiceVersion(o.service),
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

// Collects gateway IPs across all world networks (each is a full
// MissionNetwork-shaped instance with one router + optional inner
// gateways). Used by NetworkContext to extend gatewayIps so iptables/
// SNMP/ACL parsers run on world routers too — without this, NAT
// resolution wouldn't work for forwarded ports on world machines.
export const collectWorldGatewayIps = (
  worldNetworks: ReadonlyArray<MissionNetwork>,
): readonly string[] => {
  const ips: string[] = [];
  worldNetworks.forEach((wn) => {
    ips.push(wn.routerMachine.ip);
    if (wn.layers.length > 1) {
      wn.layers.slice(1).forEach((layer) => ips.push(layer.gateway.ip));
    }
  });
  return ips;
};

// Builds the localhost-visible RemoteMachine view for each world
// network's router. Mirrors buildRouterRemoteView but iterates and
// pulls per-router rules / overrides from the gateway-keyed maps. Used
// by NetworkContext to surface world routers in the localhost view.
export const buildWorldRouterRemoteViews = (
  worldNetworks: ReadonlyArray<MissionNetwork>,
  allIptablesRules: ReadonlyMap<string, readonly NatForwardingRule[]>,
  allSnmpOverrides: ReadonlyMap<string, readonly SnmpFirewallOverride[]>,
): ReadonlyArray<RemoteMachine> =>
  worldNetworks.map((wn) =>
    buildRouterRemoteView(
      wn.routerMachine,
      wn.machines,
      allIptablesRules.get(wn.routerMachine.ip) ?? [],
      allSnmpOverrides.get(wn.routerMachine.ip) ?? [],
    ),
  );

// Searches every world network's machineConfigs and routerMachine for
// a matching IP. Used by findMachineByIp in NetworkContext so commands
// like `nmap`, `ssh`, and `curl` can resolve world machine IPs the
// same way they resolve mission/home IPs.
export const findMachineInWorldNetworks = (
  ip: string,
  worldNetworks: ReadonlyArray<MissionNetwork>,
): RemoteMachine | undefined => {
  for (const wn of worldNetworks) {
    const internal = Object.values(wn.networkConfig.machineConfigs)
      .flatMap((mc) => mc.machines)
      .find((m) => m.ip === ip);
    if (internal) return internal;
    if (wn.routerMachine.ip === ip) return wn.routerMachine.remoteMachine;
  }
  return undefined;
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
  readonly allAclRules: ReadonlyMap<string, readonly AclRule[]>;
  readonly allSnmpAclOverrides: ReadonlyMap<string, readonly SnmpAclOverride[]>;
  readonly missionMachines?: readonly GeneratedMachine[];
  readonly missionLayers?: readonly SubnetLayer[];
  readonly homeMachines?: readonly GeneratedMachine[];
  readonly homeLayers?: readonly SubnetLayer[];
  // World networks contribute machines + layers for daemon state
  // lookups + gateway NAT merging. Each network's full (machines,
  // layers) tuple is kept distinct so applyDynamicOverrides can resolve
  // a gateway to its own network's machines (avoiding false positives
  // from cross-network IP collisions).
  readonly worldNetworks?: ReadonlyArray<{
    readonly machines: readonly GeneratedMachine[];
    readonly layers: readonly SubnetLayer[];
  }>;
  readonly homeGatewayByAliasIp: ReadonlyMap<string, GeneratedMachine>;
  readonly readNode: NodeReader;
};

// Finds the switch gateway that controls access to a given machine IP.
// Checks both mission and home network layers for a switch gateway whose
// downstream subnet contains this machine.
const findSwitchGatewayForMachine = (
  machineIp: string,
  ctx: DynamicOverrideContext,
): string | undefined => {
  const checkLayers = (layers: readonly SubnetLayer[] | undefined): string | undefined => {
    if (!layers || layers.length <= 1) return undefined;
    const match = layers
      .slice(1)
      .find((layer) => layer.gatewayType === 'switch' && machineIp.startsWith(`${layer.subnet}.`));
    return match?.gateway.ip;
  };

  return checkLayers(ctx.missionLayers) ?? checkLayers(ctx.homeLayers);
};

// Applies ACL-based port filtering for machines behind a switch gateway.
// When a switch has deny rules for a port to the machine's subnet, that
// port appears closed. SNMP ACL overrides (allow) take precedence over
// static ACL deny rules.
const applyAclFiltering = (
  machine: RemoteMachine,
  switchGatewayIp: string,
  ctx: DynamicOverrideContext,
): RemoteMachine => {
  const aclRules = ctx.allAclRules.get(switchGatewayIp) ?? [];
  const snmpAclOverrides = ctx.allSnmpAclOverrides.get(switchGatewayIp) ?? [];

  // Also check the .1 alias for the switch gateway (home networks use aliases)
  const aliasAclRules =
    aclRules.length === 0
      ? ([...ctx.allAclRules.entries()].find(
          ([ip]) => ctx.homeGatewayByAliasIp.get(ip)?.ip === switchGatewayIp,
        )?.[1] ?? [])
      : aclRules;
  const aliasSnmpAclOverrides =
    snmpAclOverrides.length === 0
      ? ([...ctx.allSnmpAclOverrides.entries()].find(
          ([ip]) => ctx.homeGatewayByAliasIp.get(ip)?.ip === switchGatewayIp,
        )?.[1] ?? [])
      : snmpAclOverrides;

  if (aliasAclRules.length === 0 && aliasSnmpAclOverrides.length === 0) return machine;

  // Build SNMP override map: port → allowed
  const snmpAllowedMap = new Map(aliasSnmpAclOverrides.map((o) => [o.port, o.allowed]));

  return {
    ...machine,
    ports: machine.ports.map((p) => {
      // SNMP ACL override takes precedence
      const snmpAllowed = snmpAllowedMap.get(p.port);
      if (snmpAllowed !== undefined) return { ...p, open: snmpAllowed };
      // Static ACL check
      if (isPortDeniedByAcl(aliasAclRules, machine.ip, p.port)) return { ...p, open: false };
      return p;
    }),
  };
};

// Applies all dynamic overrides to a visible machine. Pipeline order:
// 1. Gateway NAT merge (topology — show forwarded ports to upstream machines)
// 2. Daemon state (what's running — sshd, ftpd, nc listeners from PID files)
// 3. SNMP firewall overrides (can block running daemons)
// 4. ACL filtering (switch gateways can block running daemons)
// Firewall/ACL rules apply AFTER daemon state so they can block a running daemon.
export const applyDynamicOverrides = (
  machine: RemoteMachine,
  ctx: DynamicOverrideContext,
): RemoteMachine => {
  let result = machine;

  // 1. Gateway NAT merged view: show forwarded ports to upstream machines.
  // Preserve the original visible IP — buildMergedRouterView uses the
  // GeneratedMachine's primary IP, which may differ from the .1 alias
  // that machines inside the network actually see.
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
        const merged = buildMergedRouterView(homeGateway, ctx.homeMachines, gatewayRules);
        result = { ...merged, ip: machine.ip };
      } else {
        // Search world networks. Each tuple is searched independently
        // so a gateway resolves against its own network's machines —
        // no cross-network leakage.
        for (const wn of ctx.worldNetworks ?? []) {
          const worldGateway = wn.machines.find((m) => m.ip === machine.ip);
          if (worldGateway) {
            result = buildMergedRouterView(worldGateway, wn.machines, gatewayRules);
            break;
          }
        }
      }
    }
  }

  // 2. Daemon state: PID files determine what services are running.
  // Applied before firewall/ACL so that firewalls can block running daemons.
  // For daemon-backed services (ssh, ftp), absence of PID file = port closed.
  // Only applies to the machine's own ports (not NAT-forwarded ports from step 1).
  const ownPorts: ReadonlySet<number> = new Set(machine.ports.map((p) => p.port));

  const sshdNode = ctx.readNode(machine.ip, SSH_PID_FILE_PATH, '/');
  const sshdRunning = sshdNode?.type === 'file' && !!sshdNode.content;
  if (sshdRunning) {
    const overrides = parseSshdState(sshdNode.content!);
    if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
  }

  const ftpdNode = ctx.readNode(machine.ip, FTP_PID_FILE_PATH, '/');
  const ftpdRunning = ftpdNode?.type === 'file' && !!ftpdNode.content;
  if (ftpdRunning) {
    const overrides = parseFtpdState(ftpdNode.content!);
    if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
  }

  const varRunNode = ctx.readNode(machine.ip, '/var/run', '/');
  const ncOverrides = parseNcPidFiles(varRunNode);
  if (ncOverrides.length > 0) result = applyDaemonOverrides(result, ncOverrides);

  // Close daemon-backed ports when their PID file is absent (daemon not running).
  // Only close ports that were in the machine's original port list — NAT-forwarded
  // ports from gateways are controlled by the internal machine's daemon state.
  const daemonClosures: ReadonlySet<string> = new Set([
    ...(sshdRunning ? [] : ['ssh']),
    ...(ftpdRunning ? [] : ['ftp']),
  ]);
  if (daemonClosures.size > 0) {
    const hasPortsToClose = result.ports.some(
      (p) => daemonClosures.has(p.service) && ownPorts.has(p.port),
    );
    if (hasPortsToClose) {
      result = {
        ...result,
        ports: result.ports.map((p) =>
          daemonClosures.has(p.service) && ownPorts.has(p.port) ? { ...p, open: false } : p,
        ),
      };
    }
  }

  // 3. SNMP firewall overrides (can block ports opened by daemons)
  const snmpOverrides = ctx.allSnmpOverrides.get(machine.ip);
  if (snmpOverrides && snmpOverrides.length > 0) {
    result = applySnmpFirewallOverrides(result, snmpOverrides);
  }

  // 4. ACL filtering: switch gateway deny rules (can block ports opened by daemons)
  const switchGatewayIp = findSwitchGatewayForMachine(machine.ip, ctx);
  if (switchGatewayIp) {
    result = applyAclFiltering(result, switchGatewayIp, ctx);
  }

  return result;
};
