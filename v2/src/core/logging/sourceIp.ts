/**
 * Source-IP resolution for the line a scan/connection leaves on a TARGET
 * machine. Mirrors how a real network records the source of an incoming packet,
 * ported from legacy `src/logging/utils.ts:resolveLogSourceIP`:
 *
 * - Operating from a remote session (e.g. an ssh box): the target sees that
 *   box's IP, so the session machine IP passes through.
 * - Own workstation, target on the same /24: the LAN IP. Same-LAN traffic
 *   doesn't traverse a NAT, so the target records our real LAN IP — which is
 *   also how a LAN-sharing defender sees the actual attacker (load-bearing
 *   realism, `feedback_log_source_ip_realism`).
 * - Own workstation, target on a different network: the home router's public
 *   IP, since traffic NATs through the gateway.
 * - Off-network with no home network connected: LAN IP fallback (no public IP).
 *
 * Pure: framework-agnostic core/, no I/O. `ownWorkstationId` is passed in
 * explicitly (rather than comparing against a literal 'localhost') so the
 * own-vs-remote check stays correct as workstation identity evolves.
 */

import type { Ipv4 } from '../network/interfaces';

/** The /24 subnet prefix of an IP (`192.168.1.50` → `192.168.1`). */
const subnet = (ip: Ipv4): string => ip.split('.').slice(0, 3).join('.');

export type LogSourceOptions = {
  /** Machine id of the session the command runs in (the own workstation id for
   *  a local command, a remote box's id/IP when operating from an ssh session). */
  readonly sessionMachine: string;
  readonly ownWorkstationId: string;
  readonly targetIp: Ipv4;
  readonly localIp: Ipv4;
  /** The home router's public IP, or null when no home network is connected. */
  readonly publicIp: Ipv4 | null;
};

export const resolveLogSourceIP = ({
  sessionMachine,
  ownWorkstationId,
  targetIp,
  localIp,
  publicIp,
}: LogSourceOptions): Ipv4 => {
  if (sessionMachine !== ownWorkstationId) return sessionMachine;
  if (subnet(localIp) === subnet(targetIp)) return localIp;
  return publicIp ?? localIp;
};
