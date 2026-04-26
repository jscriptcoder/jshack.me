import type { EndSessionParams, EndSessionResult } from './types.js';

// Adapter for ending a session, with cascade-end of all active descendants.
//
// Strategy: app-level recursion (vs a recursive CTE in SQL). Pros: plain
// TypeScript, easy to reason about, reuses existing UPDATE adapter. Cons:
// N+1 round trips for the tree (acceptable — typical session trees are
// 1-3 hops deep), and a small race window where new child sessions
// created mid-cascade could be orphaned. The orphan is still a valid
// session; a periodic sweeper or a future RPC-based atomic cascade can
// fix it if real load shows it matters.
//
// SQL effectively (per node):
//   UPDATE sessions SET ended_at = NOW(), end_reason = $reason
//    WHERE session_id = $session_id AND player_key = $player_key
//      AND ended_at IS NULL
//    RETURNING session_id;
//
//   SELECT session_id FROM sessions
//    WHERE parent_session_id = $session_id AND ended_at IS NULL;
//
// The named session ends with the caller's reason; cascaded descendants
// always end with reason='cascade'. player_key is part of the WHERE on
// every UPDATE — defense in depth, even though all sessions in a tree
// belong to the same player by construction.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type EndSessionRowFn = (params: EndSessionParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly session_id: string }> | null;
  readonly error: RowError;
}>;

// Returns active (ended_at IS NULL) children of the given parent.
export type FindActiveChildrenFn = (parent_session_id: string) => Promise<{
  readonly data: ReadonlyArray<{ readonly session_id: string }> | null;
  readonly error: RowError;
}>;

export const createSupabaseEndSession =
  (endRow: EndSessionRowFn, findChildren: FindActiveChildrenFn) =>
  async (params: EndSessionParams): Promise<EndSessionResult> => {
    // 1. End the named session with the caller's reason.
    const { data, error } = await endRow(params);
    if (error) return { ok: false };
    const namedAffected = data?.length ?? 0;

    // No row matched (not found / not yours / already ended) — nothing to
    // cascade from. The handler maps this to 404.
    if (namedAffected === 0) return { ok: true, affected: 0 };

    // 2. Recursively cascade to active descendants.
    const cascade = await cascadeChildren(params.session_id, params.player_key, endRow, findChildren);
    if (!cascade.ok) return { ok: false };

    return { ok: true, affected: namedAffected + cascade.affected };
  };

const cascadeChildren = async (
  parent_session_id: string,
  player_key: string,
  endRow: EndSessionRowFn,
  findChildren: FindActiveChildrenFn,
): Promise<{ readonly ok: true; readonly affected: number } | { readonly ok: false }> => {
  const { data: children, error } = await findChildren(parent_session_id);
  if (error) return { ok: false };

  let affected = 0;
  for (const child of children ?? []) {
    // End the child with reason='cascade' (overrides whatever the named
    // session was ended with — these terminations are tagged for audit).
    const { data, error: endErr } = await endRow({
      session_id: child.session_id,
      player_key,
      reason: 'cascade',
    });
    if (endErr) return { ok: false };
    affected += data?.length ?? 0;

    // Recurse into the child's subtree before moving to the next sibling.
    const sub = await cascadeChildren(child.session_id, player_key, endRow, findChildren);
    if (!sub.ok) return { ok: false };
    affected += sub.affected;
  }

  return { ok: true, affected };
};
