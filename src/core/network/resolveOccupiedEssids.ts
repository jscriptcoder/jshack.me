/**
 * handleResolveOccupiedEssids — the organic-discovery read (Story 7).
 *
 * Answers "which ESSIDs does anyone currently occupy?" to ANY verified identity.
 * It is the counterpart to the occupant-list read, with two deliberate inversions:
 *
 *  - UNGATED. The occupant-list read gates on the caller holding a live row for
 *    the ESSID (you must be on the LAN to enumerate it). Discovery is the opposite
 *    problem — a player learns a network EXISTS before joining it — so this read
 *    has no occupancy gate. A signed envelope is still required (the wire is the
 *    threat surface), but any valid identity is served.
 *
 *  - NAME-ONLY. It returns occupied ESSID strings and nothing else — no owner key,
 *    workstation id, or LAN IP. The names feed a stranger's scan injection so an
 *    occupied network can surface as a crackable AP, without leaking WHO is on it.
 *
 * Names are de-duplicated here rather than relying on the query: several players
 * can occupy one ESSID, but it is one network and surfaces once.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';

/** One occupied-ESSID row — name-only by construction (no occupant identity). */
export type OccupiedEssidRow = {
  readonly essid: string;
};

export type ResolveOccupiedEssidsDeps = {
  readonly nonceStore: NonceStore;
  /** Every ESSID with at least one live occupant (rows may repeat a name when
   *  several players share it; the handler de-duplicates). */
  readonly listAllOccupiedEssids: () => Promise<{
    readonly data: readonly OccupiedEssidRow[] | null;
    readonly error: unknown;
  }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity — the caller IS the verified pubkey.
// No `essid` param: the read is global (discovery spans every occupied network).
const resolveOccupiedEssidsSchema = z
  .looseObject({
    action: z.literal('resolveOccupiedEssids'),
  })
  .refine((payload) => !('owner_key' in payload) && !('player_key' in payload));

export const handleResolveOccupiedEssids = async (
  body: unknown,
  deps: ResolveOccupiedEssidsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupiedEssidsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const occupied = await deps.listAllOccupiedEssids();
  if (occupied.error) {
    return { status: 500, body: { error: 'occupied_essids_lookup_failed' } };
  }

  const essids = [...new Set((occupied.data ?? []).map((row) => row.essid))];
  return { status: 200, body: { ok: true, essids } };
};
