import type { GeneratedMachine } from '../generation/types';
import { parseIptablesRules } from './iptablesParser';

const IPTABLES_PATH = '/etc/iptables/rules.v4';
const MAX_PORT = 65535;

export type BackdoorForwardDeps = {
  readonly readIptables: (gatewayIp: string) => string | null;
  readonly writeIptables: (gatewayIp: string, content: string) => void;
};

export type BackdoorForwardRule = {
  readonly gatewayIp: string;
  readonly publicPort: number;
  readonly internalIp: string;
  readonly internalPort: number;
};

export type BackdoorForwardResult = {
  readonly rules: readonly BackdoorForwardRule[];
  // The port advertised on the public-edge gateway (last element of the chain).
  // Players use this with the edge's public IP to reach the backdoor from outside.
  readonly publicEdgePort: number | null;
};

// Installs chained NAT forward rules from each gateway down to the backdoored
// machine. Each gateway tries `internalPort` first; if already forwarded, picks
// the next free port on that gateway. Rules are written as plain text lines
// appended to /etc/iptables/rules.v4 — the existing iptables parser picks them
// up on the next connection.
//
// No-op (empty result) when the gateway chain is empty — that's the signal
// from findGatewayChainFor that the machine isn't in a mission layer.
export const chainForwardBackdoor = (opts: {
  readonly machineIp: string;
  readonly internalPort: number;
  readonly gatewayChain: readonly GeneratedMachine[];
  readonly deps: BackdoorForwardDeps;
}): BackdoorForwardResult => {
  const { machineIp, internalPort, gatewayChain, deps } = opts;
  if (gatewayChain.length === 0) return { rules: [], publicEdgePort: null };

  const rules = gatewayChain.map((gateway) => {
    const currentContent = deps.readIptables(gateway.ip) ?? '';
    const existing = parseIptablesRules(currentContent);
    const publicPort = pickFreePort(internalPort, existing);
    const newLine = `forward ${publicPort} to ${machineIp}:${internalPort}`;
    const nextContent = appendRuleLine(currentContent, newLine);
    deps.writeIptables(gateway.ip, nextContent);
    return { gatewayIp: gateway.ip, publicPort, internalIp: machineIp, internalPort };
  });

  const edge = rules[rules.length - 1];
  return { rules, publicEdgePort: edge?.publicPort ?? null };
};

const pickFreePort = (
  preferred: number,
  existing: readonly { readonly publicPort: number }[],
): number => {
  const used = new Set(existing.map((r) => r.publicPort));
  for (let p = preferred; p <= MAX_PORT; p++) {
    if (!used.has(p)) return p;
  }
  // Preferred fallback: if somehow every port is taken (unrealistic), collide
  // on the preferred port. Game state this degenerate is itself a bug worth
  // surfacing.
  return preferred;
};

const appendRuleLine = (content: string, line: string): string => {
  const trimmed = content.replace(/\n+$/, '');
  return trimmed === '' ? line : `${trimmed}\n${line}`;
};

export { IPTABLES_PATH };
