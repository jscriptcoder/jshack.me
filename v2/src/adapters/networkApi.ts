/**
 * networkApi adapter — the signed `/api/network` client for the cross-player
 * walking skeleton (Story 1).
 *
 *   - `joinHomeNetwork` backs `env.homeNetwork.join`: on connect it registers the
 *     player's network server-side (so a DIFFERENT identity can later resolve it by
 *     public IP) and returns the local, deterministic LAN assignment. Registration
 *     is best-effort — a failure must never stop the player connecting, since the
 *     LAN itself is local-deterministic; it only forgoes cross-player discovery.
 *   - `resolvePublic` backs `env.scan.resolvePublic`: it resolves an
 *     `nmap <public IP>` against the registry, degrading to host-down on any
 *     non-ok/thrown response so a server hiccup reads as "down" rather than
 *     crashing the scan.
 *
 * Mirrors `patchApi`: `signRequest` encapsulates the Ed25519 envelope, and
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { signRequest } from '../core/signedRequest/sign';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import type { HomeNetworkAssignment } from '../core/network/homeNetwork';
import type { Identity, PublicScanResolution } from '../core/commands/types';
import type { MachineId } from '../core/types';

const DEFAULT_ENDPOINT = '/api/network';

export type NetworkClientDeps = {
  readonly identity: Identity;
  /** The player's own workstation id — registered as the machine the public IP
   *  forwards to (degenerate NAT). */
  readonly machineId: MachineId;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
};

const post = async (
  deps: NetworkClientDeps,
  action: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const doFetch = deps.fetchImpl ?? fetch;
  const envelope = signRequest(deps.identity, action, fields);
  return doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
};

export const joinHomeNetwork = async (
  deps: NetworkClientDeps,
  essid: string,
): Promise<HomeNetworkAssignment> => {
  try {
    await post(deps, 'registerNetwork', { essid, workstation_machine_id: deps.machineId });
  } catch {
    // best-effort: registration enables cross-player discovery, but a failure must
    // not stop the player connecting (the LAN address is local-deterministic).
  }
  return assignHomeNetwork(deps.identity.publicKeyHex, essid);
};

export const resolvePublic = async (
  deps: NetworkClientDeps,
  target: string,
): Promise<PublicScanResolution> => {
  try {
    const response = await post(deps, 'resolvePublicScan', { target });
    if (!response.ok) return { found: false, ports: [] };
    // A null / malformed body throws on the property access and is caught below
    // (→ host down), so no optional-chaining guard is needed here.
    const body: unknown = await response.json();
    const resolved = body as Partial<PublicScanResolution>;
    return { found: resolved.found === true, ports: resolved.ports ?? [] };
  } catch {
    return { found: false, ports: [] };
  }
};
