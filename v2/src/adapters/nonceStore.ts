/**
 * createSupabaseNonceStore — the Supabase-backed NonceStore (replay dedupe).
 *
 * Atomic dedupe via INSERT ... ON CONFLICT (nonce) DO NOTHING ... RETURNING: if
 * the row was actually inserted (RETURNING yields it) the nonce is FRESH; a
 * conflict (RETURNING empty) means we've already seen it → replay. supabase-js
 * spells this `.upsert(row, { ignoreDuplicates: true }).select()`, where `select`
 * adds the RETURNING so the inserted-rows count is observable.
 *
 * The verifier checks the timestamp window before the nonce, so this only ever
 * needs to retain nonces within REPLAY_WINDOW_MS (pruning is Slice 7.2.0b).
 *
 * Fail-open on a DB error: if the dedupe insert itself errors we return `fresh`
 * so a nonces-table outage degrades to timestamp-window-only protection (the
 * prior accepted posture) rather than rejecting every signed write game-wide.
 *
 * Depends on a NARROW structural slice of the Supabase client (just the single
 * `.from().upsert().select()` it issues), not the whole `SupabaseClient` — the
 * real client satisfies it structurally, and a trivial fake makes the store
 * unit-testable (mirrors the `fetchImpl` seam on the client adapters).
 */

import type { NonceStore } from '../core/signedRequest/nonceStore';

type NonceUpsertResult = {
  readonly data: readonly unknown[] | null;
  readonly error: unknown;
};

export type NonceDb = {
  readonly from: (table: string) => {
    readonly upsert: (
      values: { readonly nonce: string },
      options: { readonly onConflict: string; readonly ignoreDuplicates: boolean },
    ) => {
      readonly select: (columns: string) => PromiseLike<NonceUpsertResult>;
    };
  };
};

export const createSupabaseNonceStore = (supabase: NonceDb): NonceStore => {
  return async (nonce) => {
    const { data, error } = await supabase
      .from('nonces')
      .upsert({ nonce }, { onConflict: 'nonce', ignoreDuplicates: true })
      .select('nonce');
    if (error) {
      console.error('[nonces] dedupe insert error:', error);
      return { fresh: true };
    }
    return { fresh: (data?.length ?? 0) === 1 };
  };
};
