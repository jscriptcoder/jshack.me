import type { PatchSummary } from './types.js';

// Server-side helper that publishes a patch-change event to the
// per-machine broadcast channel. Wraps a thin Supabase-agnostic
// `broadcast` adapter so the module stays testable without a live
// Realtime connection — the actual REST/WebSocket plumbing lives in
// the Vercel function (api/patches.ts).
//
// Channel naming: `patches:<machine_id>`. Subscribers join the channel
// for any machine they want live updates on. Event name is constant
// (`patch_change`) so all mutations on a machine flow through one
// listener.
//
// Fire-and-forget semantics: any error from the adapter is caught and
// logged. Broadcast is an optimization on top of the authoritative DB
// write — a failed broadcast must not fail the upsertPatch /
// removePatch HTTP response, since the row is already persisted and
// the next mount of any subscriber will rehydrate via
// listPatchesForMachines anyway.
//
// See memory: project_multiplayer_cross_player_visibility.md.

export type BroadcastFn = (
  channel: string,
  event: string,
  payload: Record<string, unknown>,
) => Promise<void>;

const PATCH_CHANGE_EVENT = 'patch_change';

const channelForMachine = (machine_id: string): string => `patches:${machine_id}`;

export const publishPatchChange = async (
  broadcast: BroadcastFn,
  machine_id: string,
  payload: PatchSummary,
): Promise<void> => {
  try {
    await broadcast(channelForMachine(machine_id), PATCH_CHANGE_EVENT, payload);
  } catch (error) {
    console.error('[patches] broadcast error:', error);
  }
};
