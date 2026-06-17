/**
 * `/etc/iptables/rules.v4` — the SINGLE parsed source of truth for a router's
 * NAT port forwards (Story 5.1). The owner edits this file (via `nano`) to opt a
 * workstation port in; the scan/ssh paths parse it to decide what the public IP
 * exposes. There is no separate registry `forward_table` — the file IS the table.
 *
 * Grammar is deliberately simplified (NOT real iptables-save), ported from legacy
 * `src/network/iptablesParser.ts`:
 *   `forward <public_port> to <internal_ip>:<internal_port>`
 * Parsing is LENIENT — comments (`#`), blank lines, and malformed lines are
 * skipped rather than failing the whole file — and rejects out-of-range ports.
 */

import type { Directory } from '../filesystem/types';

/** One parsed NAT forward: a public port DNAT'd to `internalIp:internalPort`.
 *  Distinct from the registry's `{ publicPort, targetMachineId }` shape — this
 *  is what a `rules.v4` line denotes. */
export type NatForward = {
  readonly publicPort: number;
  readonly internalIp: string;
  readonly internalPort: number;
};

/** The router's `/etc/iptables/rules.v4` content, or '' when absent (missing
 *  `/etc`, the `iptables` dir, or the file). Walks the tree the way the port
 *  readers do — this layer has no path resolver. Shared by `scanResult` and
 *  `machineServing` so the NAT table is read exactly one way and the scan and
 *  ssh-routing paths can never disagree on what it says. */
export const readRulesV4 = (routerFs: Directory): string => {
  const etc = routerFs.entries.get('etc');
  if (etc?.kind !== 'directory') return '';
  const iptables = etc.entries.get('iptables');
  if (iptables?.kind !== 'directory') return '';
  const rules = iptables.entries.get('rules.v4');
  return rules?.kind === 'file' ? rules.content : '';
};

const FORWARD_RULE_RE = /^forward\s+(\d+)\s+to\s+([\d.]+):(\d+)$/;

const inPortRange = (port: number): boolean => port >= 1 && port <= 65535;

const parseForwardLine = (line: string): NatForward | null => {
  const match = FORWARD_RULE_RE.exec(line);
  if (match === null) return null;

  const publicPort = Number(match[1]);
  const internalIp = match[2]!;
  const internalPort = Number(match[3]);

  if (!inPortRange(publicPort) || !inPortRange(internalPort)) return null;

  return { publicPort, internalIp, internalPort };
};

export const parseForwardRules = (content: string): readonly NatForward[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const rule = parseForwardLine(line);
      return rule === null ? [] : [rule];
    });
