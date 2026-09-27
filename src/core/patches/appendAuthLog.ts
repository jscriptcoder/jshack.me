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
 * target is the caller's OWN workstation → server-stamp writer_key from the
 * VERIFIED pubkey → read-modify-write the auth.log row (keyed on the owner's own
 * `(machine_id, AUTH_LOG_PATH, writer_key)` in the shared journal). The payload
 * schema rejects a client-supplied player_key/writer_key outright; any client
 * `time`/`pid` field is simply never read.
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
  formatSessionOpenedLine,
  formatSuAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type AuthLogContentQuery = {
  readonly writer_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type AppendAuthLogDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  readonly readAuthLog: (query: AuthLogContentQuery) => Promise<{
    readonly data: { readonly content: string | null } | null;
    readonly error: unknown;
  }>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// The server always stamps the writer, so a client-supplied player_key/writer_key is a
// forged provenance and rejected outright — shared by both shapes below.
const noStampedKeys = (payload: Record<string, unknown>): boolean =>
  !('player_key' in payload) && !('writer_key' in payload);

// A `su` user-switch — the original shape. `kind` is OPTIONAL here so an envelope that
// predates the discriminant still routes here (absent kind reads as a su switch); the
// `sessionOpened` shape below carries its own required kind. Loose so the always-present
// envelope fields (action/ts/nonce) pass through; any client `time`/`pid` is ignored.
const suSwitchSchema = z
  .looseObject({
    action: z.literal('appendAuthLog'),
    kind: z.literal('suSwitch').optional(),
    machine_id: z.string().min(1),
    target_user: z.string().min(1),
    from_user: z.string().min(1),
    outcome: z.enum(['success', 'failure']),
    hostname: z.string().min(1),
  })
  .refine(noStampedKeys);

// A session opened with NO authentication before it — the trace a `--local` shell success
// leaves (decision 69). It carries only the user the shell landed as; the server formats
// the ordinary `login` session-opened line, whose whole tell is the password line NOT
// before it.
const sessionOpenedSchema = z
  .looseObject({
    action: z.literal('appendAuthLog'),
    kind: z.literal('sessionOpened'),
    machine_id: z.string().min(1),
    user: z.string().min(1),
    hostname: z.string().min(1),
  })
  .refine(noStampedKeys);

// `sessionOpened` first, so a payload carrying that discriminant is matched by its own
// shape rather than falling through to the su schema (which would reject it for missing
// su fields); a su envelope fails the `sessionOpened` kind literal and routes on.
const appendAuthLogSchema = z.union([sessionOpenedSchema, suSwitchSchema]);

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
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: AUTH_LOG_PATH,
  });
  if (existing.error) {
    return { status: 500, body: { error: 'read_failed' } };
  }
  const current = existing.data?.content ?? '';

  const stamp = deps.now();
  const line =
    payload.kind === 'sessionOpened'
      ? formatSessionOpenedLine({
          user: payload.user,
          hostname: payload.hostname,
          time: asGameTime(stamp),
          pid: derivePid(stamp),
        })
      : formatSuAuthLine({
          outcome: payload.outcome,
          targetUser: payload.target_user,
          fromUser: payload.from_user,
          hostname: payload.hostname,
          time: asGameTime(stamp),
          pid: derivePid(stamp),
        });

  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
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
