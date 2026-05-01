// Server-side helper that publishes an occupant-change HINT to the per-
// network broadcast channel. The hint carries only "something changed
// on this LAN" + "who triggered it" — receivers refetch via the anon
// SELECT listOccupants endpoint to obtain authoritative state.
//
// Mirrors patchRegistry/broadcast.ts. Same rationale: the broadcast
// channel is anon-publishable from the browser bundle, so any client
// could forge an `occupant_change` event. Shipping only
// `{ network_id, originator_key }` defangs forgery architecturally —
// there's no row content to inject, and a forged hint just causes a
// refetch that returns the actual table state.
//
// Fire-and-forget semantics: any error from the adapter is caught and
// logged. Broadcast is an optimization on top of the authoritative DB
// insert — a failed broadcast must not fail the join HTTP response,
// since the row is already persisted and the next mount of any
// subscriber will refetch via listOccupants anyway.
//
// originator_key is the verified Ed25519 pubkey of the joining player
// (server-stamped from verifySignedRequest, including the 'ed25519:'
// prefix as that's how it's stored on the row). Receivers compare it
// to their own pubkey to skip self-induced refetches; the join flow
// already materialized their occupant slot locally.

export type OccupantHintPayload = {
  readonly network_id: string;
  readonly originator_key: string;
};

export type BroadcastFn = (
  channel: string,
  event: string,
  payload: OccupantHintPayload,
) => Promise<void>;

const OCCUPANT_CHANGE_EVENT = 'occupant_change';

const channelForNetwork = (network_id: string): string => `occupants:${network_id}`;

export const publishOccupantChange = async (
  broadcast: BroadcastFn,
  network_id: string,
  originator_key: string,
): Promise<void> => {
  try {
    await broadcast(channelForNetwork(network_id), OCCUPANT_CHANGE_EVENT, {
      network_id,
      originator_key,
    });
  } catch (error) {
    console.error('[homeNetworks] broadcast error:', error);
  }
};
