import type { GeneratedMachine } from '../generation/types';
import { parseIptablesRules } from './iptablesParser';
import type { Port, RemoteMachine } from './types';
import { serviceForPort } from './wellKnownService';

// Cross-LAN forward synthesis for piece 2b. When Player B scans Player
// A's public IP, B sees the foreign router (returned by
// resolveForeignRouter) and wants the same view A's external port scan
// would expose: router's own ports PLUS the public ports that A's
// iptables forwards to internal targets. Real port scanners can't peek
// inside the LAN, so the internal side is best-effort:
//
//   - NPC-target forwards: cache.internalMachines has the regenerated
//     GeneratedMachine; we use the targeted port's real service +
//     version. Drops the forward if the internal port is closed
//     (matches buildMergedRouterView; defender can hide forwards by
//     stopping the service).
//
//   - Occupant-target forwards (the user's smoke case: A forwards to
//     A's workstation): we don't subscribe to A's workstation from
//     B's side, so the internal port's open/closed state is unknown.
//     Synthesize the forward as open with service inferred from the
//     well-known-port map (port 80 → 'http'). Version unknown until
//     B establishes foothold and the real pid-file overlay reaches them.
//
// Forwarded ports override router-own ports on collision (mirrors NAT
// PREROUTING semantics). Pure function — given the same inputs always
// returns the same output; safe to call once per nmap invocation.

export const mergeForeignRouterForwards = (
  router: RemoteMachine,
  internalMachines: readonly GeneratedMachine[],
  rulesV4Content: string | null,
): RemoteMachine => {
  if (rulesV4Content === null) return router;
  const rules = parseIptablesRules(rulesV4Content);
  if (rules.length === 0) return router;

  const forwardedPorts: Port[] = [];
  for (const rule of rules) {
    const internal = internalMachines.find((machine) => machine.ip === rule.internalIp);
    if (internal) {
      // NPC target: take the real port if it's open. Closed → drop the
      // forward (defender hid the service).
      const internalPort = internal.remoteMachine.ports.find(
        (port) => port.port === rule.internalPort && port.open,
      );
      if (internalPort) {
        forwardedPorts.push({ ...internalPort, port: rule.publicPort });
      }
      continue;
    }
    // Occupant / unknown target: synthesize using well-known service
    // inferred from the internal port number. Real port scanners do
    // the same /etc/services lookup. Version reads 'unknown' because
    // we can't tell what's actually running on A's workstation without
    // subscribing to A's pid files; Port.serviceVersion is required so
    // we surface the unknown explicitly rather than smuggling it via
    // an absent field.
    forwardedPorts.push({
      port: rule.publicPort,
      service: serviceForPort(rule.internalPort) ?? 'unknown',
      serviceVersion: 'unknown',
      open: true,
    });
  }

  // Dedup: forwarded ports override router-own ports on collision.
  const forwardedPortNumbers = new Set(forwardedPorts.map((port) => port.port));
  const routerOnlyPorts = router.ports.filter((port) => !forwardedPortNumbers.has(port.port));

  return { ...router, ports: [...routerOnlyPorts, ...forwardedPorts] };
};
