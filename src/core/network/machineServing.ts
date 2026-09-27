/**
 * `machineServing` — the ONE function that decides which machine a destination
 * port reaches behind a player's public IP (Story 5.1.2). The cross-player ssh
 * gate consults it after materializing the router: where `scanResult` answers
 * "what ports are exposed", this answers "ssh to <publicIp>:<port> — whose box?".
 *
 * A port the router itself listens on (its seeded `sshd:22`) reaches the ROUTER;
 * a port the parsed `/etc/iptables/rules.v4` forwards reaches the internal target
 * (`internalIp:internalPort`); anything else is served by no one. The router's own
 * port WINS over a forward mapped to the same public port — you can't shadow the
 * router's own service from inside. Pure: it reads only the materialized router FS
 * (`readOpenPorts` + the shared `readRulesV4`/`parseForwardRules`), no wiring.
 */

import type { Directory } from '../filesystem/types';
import { readOpenPorts } from '../services/pidfile';
import { parseForwardRules, readRulesV4 } from './iptablesRules';

/** Which machine serves a destination port behind the public IP: the router
 *  itself, an internal host reached through a NAT forward, or none. */
export type ServedMachine =
  | { readonly kind: 'router' }
  | { readonly kind: 'forward'; readonly internalIp: string; readonly internalPort: number }
  | { readonly kind: 'none' };

export type MachineServingArgs = {
  readonly routerFs: Directory;
  readonly port: number;
};

export const machineServing = ({ routerFs, port }: MachineServingArgs): ServedMachine => {
  if (readOpenPorts(routerFs).some((openPort) => openPort.port === port)) {
    return { kind: 'router' };
  }
  const forward = parseForwardRules(readRulesV4(routerFs)).find((rule) => rule.publicPort === port);
  return forward === undefined
    ? { kind: 'none' }
    : { kind: 'forward', internalIp: forward.internalIp, internalPort: forward.internalPort };
};
