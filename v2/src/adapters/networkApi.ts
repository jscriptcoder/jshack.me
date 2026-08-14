/**
 * networkApi adapter — the signed `/api/network` client for the cross-player
 * walking skeleton (Story 1).
 *
 *   - `joinHomeNetwork` backs `env.homeNetwork.join`: on connect it registers the
 *     player's network server-side (so a DIFFERENT identity can later resolve it by
 *     public IP) and returns the LAN address the server LEASED. Registration is no
 *     longer best-effort: it is what issues the address, so a failure leaves the player
 *     with nothing to be addressed with unless this network was already joined once —
 *     in which case the remembered address stands and the reconnect works offline.
 *   - `resolvePublic` backs `env.scan.resolvePublic`: it resolves an
 *     `nmap <public IP>` server-side, degrading to host-down on any
 *     non-ok/thrown response so a server hiccup reads as "down" rather than
 *     crashing the scan.
 *
 * Mirrors `patchApi`: `signRequest` encapsulates the Ed25519 envelope, and
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { z } from 'zod';
import { signRequest } from '../core/signedRequest/sign';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import { workstationIdentityFields } from '../core/network/workstationIdentity';
import { noLanLeaseCache, type LanLeaseCache } from '../core/network/lanLeaseCache';
import { deserializeTree, type SerializedDirectory } from '../core/filesystem/treeCodec';
import type { HomeNetworkAssignment } from '../core/network/homeNetwork';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import type { Directory } from '../core/filesystem/types';
import type {
  Identity,
  PublicFetchParams,
  PublicFetchResult,
  PublicSweepOutcome,
  PublicSweepParams,
  PublicSweepResult,
  PublicScanResolution,
} from '../core/commands/types';
import type { OccupantProjection } from '../core/network/resolveOccupants';
import type { Ipv4 } from '../core/network/interfaces';
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
  /** The client's copy of the addresses this player has been leased, so a reconnect
   *  survives an unreachable server. Absent, every join must reach the server. */
  readonly leaseCache?: LanLeaseCache;
};

/** The join response the client actually depends on: the LAN address the server
 *  leased. Validated rather than trusted — a malformed body is a join that issued
 *  no address, not an address-shaped fragment of one. */
const joinResponseSchema = z.object({ local_ip: z.string().min(1) });

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
): Promise<HomeNetworkAssignment | null> => {
  // The hostname stays a pure derivation — only the ADDRESS is leased.
  const { hostname } = assignHomeNetwork(deps.identity.publicKeyHex, essid);
  const cache = deps.leaseCache ?? noLanLeaseCache;

  const issued = await (async (): Promise<Ipv4 | null> => {
    try {
      const response = await post(deps, 'registerNetwork', {
        essid,
        workstation_machine_id: deps.machineId,
        ...workstationIdentityFields(deps.gameConfig),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const parsed = joinResponseSchema.safeParse(body);
      return parsed.success ? parsed.data.local_ip : null;
    } catch {
      return null;
    }
  })();

  if (issued !== null) return { localIp: issued, hostname };

  // The server said nothing usable. A network we already hold a lease on is still
  // joinable at the address it issued; a network we have never joined is NOT — the
  // client cannot allocate its own address, so connecting fails rather than putting
  // the player on an address that may belong to someone else.
  const cached = cache.recall(essid);
  return cached === null ? null : { localIp: cached, hostname };
};

/**
 * Leave a home network (backs `env.homeNetwork.leave`, fired by `nmcli disconnect`):
 * a fire-and-forget signed `unregisterOccupant` that removes the player's occupancy
 * row server-side. Best-effort by design — disconnect is a local state change, so a
 * failed cleanup (offline, server hiccup) must never surface to the player; a stale
 * row is harmless (overwritten on next join, removed on the next disconnect).
 */
export const leaveHomeNetwork = (deps: NetworkClientDeps, essid: string): void => {
  void post(deps, 'unregisterOccupant', { essid }).catch(() => {
    // swallowed: occupancy cleanup must not fail or block the disconnect.
  });
};

/**
 * Fetch the current ESSID's other occupants for a same-LAN `nmap` (backs
 * `env.scan.resolveOccupants`). The server gates on the caller's own live occupancy
 * row and excludes the caller. Additive by design: it degrades to an EMPTY list on any
 * non-ok (incl. 403 not-an-occupant) / malformed / thrown response, so a server hiccup
 * — or a not-yet-occupant scan — simply shows the viewer's own LAN with no fellow
 * players, never a crash.
 */
export const resolveOccupants = async (
  deps: NetworkClientDeps,
  essid: string,
): Promise<readonly OccupantProjection[]> => {
  try {
    const response = await post(deps, 'resolveOccupants', { essid });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const resolved = body as {
      readonly ok?: boolean;
      readonly occupants?: readonly OccupantProjection[];
    };
    if (resolved.ok !== true) return [];
    return resolved.occupants ?? [];
  } catch {
    return [];
  }
};

/**
 * Fetch the ESSID names anyone currently occupies for organic discovery (backs
 * `env.scan.resolveOccupiedEssids`). Global and name-only — no occupant identity
 * crosses the wire. Additive by design: it degrades to an EMPTY list on any
 * non-ok / malformed / thrown response, so a server hiccup simply means a scan
 * with nothing to discover, never a crash.
 */
export const resolveOccupiedEssids = async (
  deps: NetworkClientDeps,
): Promise<readonly string[]> => {
  try {
    const response = await post(deps, 'resolveOccupiedEssids', {});
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const resolved = body as { readonly ok?: boolean; readonly essids?: readonly string[] };
    if (resolved.ok !== true) return [];
    return resolved.essids ?? [];
  } catch {
    return [];
  }
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
 * Fetch one page from a machine behind another player's public IP (backs
 * `env.remote.fetchPublic`).
 *
 * The three outcomes are kept apart on purpose, because they are three different
 * sentences to the player. A refusal from the TARGET (dark, bricked, unforwarded,
 * nothing serving the web) is `host_unreachable`. A reached server's 404 is
 * `not_found`. Anything else — a 500, an unverifiable envelope, a malformed body, a
 * thrown request — is `network_error`: OUR side failed to complete the round-trip, and
 * reporting that as a refusal would blame the target for our own outage.
 */
export const fetchPublicPage = async (
  deps: NetworkClientDeps,
  params: PublicFetchParams,
): Promise<PublicFetchResult> => {
  try {
    const response = await post(deps, 'resolveHttpFetch', { ...params });
    const body: unknown = await response.json();
    if (!response.ok) {
      const failed = body as { readonly error?: string };
      if (failed.error === 'not_found') return { ok: false, error: 'not_found' };
      if (failed.error === 'host_unreachable') return { ok: false, error: 'host_unreachable' };
      return { ok: false, error: 'network_error' };
    }
    const resolved = body as { readonly ok?: boolean; readonly content?: string };
    // A 200 we cannot read is not a page. Reporting it as an empty one would print a
    // blank response as though the target had served it.
    if (resolved.ok !== true || typeof resolved.content !== 'string') {
      return { ok: false, error: 'network_error' };
    }
    return { ok: true, content: resolved.content };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/**
 * Sweep a path list against a machine behind another player's public IP (backs
 * `env.remote.sweepPublic`).
 *
 * One round-trip for the whole run: the words never leave this machine (the server
 * reads the list off the box named in `callerMachineId`), and every path it asked
 * about lands on the target as one append. A request per word would scatter the
 * defender's whole tell across as many timestamps.
 *
 * Two outcomes rather than the fetch's three: a sweep has no 404 of its own, because a
 * path that answers nothing is an ordinary result inside a run that succeeded. A
 * refusal from the TARGET stays `host_unreachable`; anything we cannot read is
 * `network_error`, since blaming the target for our own outage is a lie the player
 * would act on.
 */
export const sweepPublicPaths = async (
  deps: NetworkClientDeps,
  params: PublicSweepParams,
): Promise<PublicSweepResult> => {
  try {
    const response = await post(deps, 'resolveHttpSweep', {
      target: params.target,
      port: params.port,
      caller_machine_id: params.callerMachineId,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const failed = body as { readonly error?: string };
      return failed.error === 'host_unreachable'
        ? { ok: false, error: 'host_unreachable' }
        : { ok: false, error: 'network_error' };
    }
    const resolved = body as {
      readonly ok?: boolean;
      readonly dirlistFound?: boolean;
      readonly results?: readonly PublicSweepOutcome[];
    };
    // A 200 we cannot read is not a sweep. Reporting it as an empty one would print
    // "0 found" as though the target had answered nothing.
    if (resolved.ok !== true || !Array.isArray(resolved.results)) {
      return { ok: false, error: 'network_error' };
    }
    return {
      ok: true,
      dirlistFound: resolved.dirlistFound === true,
      results: resolved.results,
    };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/**
 * Resolve the player's OWN-LAN `nmap` of an inner gateway server-side (backs
 * `env.scan.resolveInnerGateway`): the gateway's own ports PLUS any live NAT forward
 * to the deep layer behind it, read from its journal at the `external` vantage. The
 * forward lives server-side (a `nano rules.v4` edit on the gateway's journal), so —
 * unlike a sibling NPC — it can't be computed from the client's static world. Mirrors
 * `resolvePublic`: it degrades to host-down on any non-ok / malformed / thrown
 * response so a server hiccup reads as "down" rather than crashing the scan.
 */
export const resolveInnerGateway = async (
  deps: NetworkClientDeps,
  essid: string,
  target: string,
): Promise<PublicScanResolution> => {
  try {
    const response = await post(deps, 'resolveInnerGatewayScan', { essid, target });
    if (!response.ok) return { found: false, ports: [] };
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
