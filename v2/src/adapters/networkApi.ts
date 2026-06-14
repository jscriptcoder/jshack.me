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
import { workstationIdentityFields } from '../core/network/workstationIdentity';
import { deserializeTree, type SerializedDirectory } from '../core/filesystem/treeCodec';
import type { HomeNetworkAssignment } from '../core/network/homeNetwork';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import type { Directory } from '../core/filesystem/types';
import type { Identity, PublicScanResolution } from '../core/commands/types';
import type { MachineId } from '../core/types';

const DEFAULT_ENDPOINT = '/api/network';

export type NetworkClientDeps = {
  readonly identity: Identity;
  /** The player's own workstation id — registered as the machine the public IP
   *  forwards to (degenerate NAT). */
  readonly machineId: MachineId;
  /** The player's chosen workstation identity — shipped on join (hashed root
   *  password, never plaintext) so the server can reconstruct the box for a
   *  cross-player reader. */
  readonly gameConfig: GameConfig;
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
    await post(deps, 'registerNetwork', {
      essid,
      workstation_machine_id: deps.machineId,
      ...workstationIdentityFields(deps.gameConfig),
    });
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

/**
 * Fetch another identity's SERVER-served, tier-filtered filesystem for a
 * cross-player ssh hop (Story 2, slice 2c). Returns the materialized `Directory`
 * the server pruned to the caller's tier, or `null` on any non-ok / malformed /
 * thrown response so the caller can fall back rather than crash. The owner's box
 * can't be regenerated client-side (D1), so this is the only correct source for a
 * cross-player hop's `ls`/`cat`.
 */
export const resolveCrossPlayerFs = async (
  deps: NetworkClientDeps,
  machineId: string,
): Promise<Directory | null> => {
  try {
    const response = await post(deps, 'resolveCrossPlayerFs', { machine_id: machineId });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const resolved = body as { readonly ok?: boolean; readonly tree?: unknown };
    if (resolved.ok !== true) return null;
    // A missing or malformed tree throws inside deserializeTree and is caught below
    // (→ null, caller falls back), so every bad-tree shape funnels through one path.
    return deserializeTree(resolved.tree as SerializedDirectory);
  } catch {
    return null;
  }
};
