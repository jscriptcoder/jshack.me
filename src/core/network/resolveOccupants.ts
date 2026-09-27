/**
 * handleResolveOccupants — the same-LAN occupant-list read (Story 7, slice 7.2a).
 *
 * Answers "who else is on ESSID X?" to a VERIFIED occupant. Where the AP's public IP
 * keys on `public_ip` (last-writer-wins on a shared AP), occupancy keys on
 * `(essid, owner_key)` so every occupant coexists — this read is the cross-player
 * state the rest of Story 7 renders (the `nmap` merge, the same-LAN front door).
 *
 * LAN boundary (decision D11): real WiFi means you must be ON the LAN to enumerate
 * it. The caller must hold a live occupancy row for the ESSID (checked against the
 * verified pubkey, never a client claim) — a non-occupant is refused before any list
 * crosses the wire, blocking global occupant enumeration / cross-LAN framing.
 *
 * The caller is always excluded from its own result. Each occupant's LAN IP comes from
 * the LEASE that occupant holds on the ESSID, read once per request. This used to be
 * re-derived from `assignHomeNetwork(owner_key, essid)` on the argument that an address
 * which is a pure function of identity + AP is cheaper to recompute than to store — but
 * a pure function of the identity cannot know what OTHER identities were issued, so two
 * occupants could be handed one address. The lease is now the address of record, and
 * re-deriving would be the drift. Forgery-safe via the broadcast-hint + signed-refetch
 * lineage (`project_realtime_publish_authorization`).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress';
import type { Ipv4 } from './interfaces';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The narrow occupancy projection the gate + merge need: whose row it is (for the
 *  LAN-boundary check + self-exclusion + lease lookup), the workstation the
 *  caller will later reach, and its display name (the HOSTNAME column of a fellow
 *  occupant's `nmap`). The auth field (`workstation_root_hash`) is NOT read here —
 *  only the same-LAN connect handler needs it. */
export type OccupantListRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_machine_name: string;
};

/** What a fellow occupant learns about another: the machine to reach, where to reach
 *  it, and its display name for the scan host list. No owner key, username, or hash
 *  crosses the wire. */
export type OccupantProjection = {
  readonly workstation_machine_id: string;
  readonly localIp: Ipv4;
  readonly machineName: string;
};

export type ResolveOccupantsDeps = {
  readonly nonceStore: NonceStore;
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly OccupantListRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity — the caller IS the verified pubkey,
// so an owner_key/player_key in the payload is a forgery attempt.
const resolveOccupantsSchema = z
  .looseObject({
    action: z.literal('resolveOccupants'),
    essid: z.string().min(1),
  })
  .refine((payload) => !('owner_key' in payload) && !('player_key' in payload));

export const handleResolveOccupants = async (
  body: unknown,
  deps: ResolveOccupantsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupantsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const occupants = await deps.listOccupantsByEssid(payload.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const rows = occupants.data ?? [];

  // LAN boundary: only a live occupant may enumerate the LAN.
  if (!rows.some((row) => row.owner_key === publicKey)) {
    return { status: 403, body: { error: 'not_an_occupant' } };
  }

  // ONE lease read for the whole ESSID, behind the LAN boundary so no address reaches
  // a non-occupant. A failure is a clean 500: an address that cannot be looked up is
  // never guessed at, which is exactly what the derivation used to do.
  const leases = await deps.listLeasesByEssid(payload.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(payload.essid, leases.data ?? []);

  // An occupant holding no lease holds no address on this LAN, so there is nothing to
  // route to and it is omitted. The join allocates the lease BEFORE writing the
  // occupancy row, so this is unreachable in practice — it is the shape of "no address"
  // rather than a fallback.
  const others: readonly OccupantProjection[] = rows
    .filter((row) => row.owner_key !== publicKey)
    .flatMap((row) => {
      const localIp = addresses.get(row.owner_key);
      return localIp === undefined
        ? []
        : [
            {
              workstation_machine_id: row.workstation_machine_id,
              localIp,
              machineName: row.workstation_machine_name,
            },
          ];
    });

  return { status: 200, body: { ok: true, occupants: others } };
};
