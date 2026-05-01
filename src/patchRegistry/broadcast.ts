import type { PatchHint } from './types.js';

// Server-side helper that publishes a patch-change HINT to the per-
// machine broadcast channel. The hint carries only "something changed"
// + "who changed it" — receivers refetch via the signed
// listPatchesForMachines path to obtain authoritative state.
//
// Why a hint, not the full patch payload: the broadcast channel is
// anon-publishable from the browser bundle, so any client could forge
// a `patch_change` event with fake content under the prior design.
// Shipping only `{ machine_id, originator_key }` defangs forgery
// architecturally — there's no content to inject, and a forged hint
// just causes a refetch that returns server truth. See
// project_realtime_publish_authorization memory for the full threat
// model and the comparison with the previously-attempted Realtime RLS
// approach (PR #91, reverted).
//
// Fire-and-forget semantics: any error from the adapter is caught and
// logged. Broadcast is an optimization on top of the authoritative DB
// write — a failed broadcast must not fail the upsertPatch /
// removePatch HTTP response, since the row is already persisted and
// the next mount of any subscriber will rehydrate via
// listPatchesForMachines anyway.
//
// originator_key is the verified Ed25519 pubkey of the writer (server-
// stamped from verifySignedRequest). Receivers compare it to their
// own pubkey to skip self-induced refetches; their local optimistic
// apply (and BroadcastChannel cross-tab fan-out for same-identity
// tabs) already covered the change.

export type BroadcastFn = (channel: string, event: string, payload: PatchHint) => Promise<void>;

const PATCH_CHANGE_EVENT = 'patch_change';

const channelForMachine = (machine_id: string): string => `patches:${machine_id}`;

export const publishPatchChange = async (
  broadcast: BroadcastFn,
  machine_id: string,
  originator_key: string,
): Promise<void> => {
  try {
    await broadcast(channelForMachine(machine_id), PATCH_CHANGE_EVENT, {
      machine_id,
      originator_key,
    });
  } catch (error) {
    console.error('[patches] broadcast error:', error);
  }
};
