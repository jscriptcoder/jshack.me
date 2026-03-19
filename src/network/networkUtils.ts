import type { RemoteMachine } from './types';
import type { GeneratedMachine, NatForwardingRule } from '../generation/types';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import type { SshdPortOverride } from './sshdStateParser';
import type { FtpdPortOverride } from './ftpdStateParser';
import type { NcatPortOverride } from './ncatStateParser';

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
type DaemonOverride = SshdPortOverride | FtpdPortOverride | NcatPortOverride;

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
