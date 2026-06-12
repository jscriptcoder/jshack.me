/**
 * handleAppendAuthLog — the pure appendAuthLog endpoint logic (no Vercel, no
 * Supabase). Records an `su` user-switch to the caller's OWN `/var/log/auth.log`
 * with a timestamp the SERVER stamps from its own UTC clock.
 *
 * The client sends only the su EVENT (target/from/outcome/hostname) — never a
 * time. The server reads the current log content, formats the syslog line via
 * the shared `core/logging/authLog` formatter using `deps.now()` (UTC), appends,
 * and upserts. This is the single source of truth for game time: a crafted
 * request cannot dictate the clock, which is what the future CVE time-gating
 * relies on (services age into vulnerability by SERVER time, not client claims).
 *
 * Flow mirrors `handleUpsertPatch`: verify the signed envelope → confirm the
 * target is the caller's OWN workstation → server-stamp player_key from the
 * VERIFIED pubkey → read-modify-write the auth.log row. The payload schema
 * rejects a client-supplied player_key outright; any client `time`/`pid` field
 * is simply never read.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { isOwnWorkstation } from '../identity/workstation';
import { asGameTime } from '../types';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSuAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type AuthLogContentQuery = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type AppendAuthLogDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  readonly readAuthLog: (
    query: AuthLogContentQuery,
  ) => Promise<{ readonly data: { readonly content: string | null } | null; readonly error: unknown }>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key (the server stamps it). Any
// client `time`/`pid` is ignored — the server clock is authoritative.
const appendAuthLogSchema = z
  .looseObject({
    action: z.literal('appendAuthLog'),
    machine_id: z.string().min(1),
    target_user: z.string().min(1),
    from_user: z.string().min(1),
    outcome: z.enum(['success', 'failure']),
    hostname: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleAppendAuthLog = async (
  body: unknown,
  deps: AppendAuthLogDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, appendAuthLogSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const existing = await deps.readAuthLog({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: AUTH_LOG_PATH,
  });
  if (existing.error) {
    return { status: 500, body: { error: 'read_failed' } };
  }
  const current = existing.data?.content ?? '';

  const stamp = deps.now();
  const line = formatSuAuthLine({
    outcome: payload.outcome,
    targetUser: payload.target_user,
    fromUser: payload.from_user,
    hostname: payload.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });

  const { error } = await deps.upsertPatch({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: AUTH_LOG_PATH,
    content: `${current}${line}\n`,
    owner: AUTH_LOG_OWNER,
    permissions: AUTH_LOG_PERMISSIONS,
    node_type: 'file',
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
