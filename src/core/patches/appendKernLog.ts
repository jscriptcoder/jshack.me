/**
 * handleAppendKernLog — the pure appendKernLog endpoint logic (no Vercel, no
 * Supabase). Records a `msfconsole --local` MISS crash to the caller's OWN
 * `/var/log/kern.log` with a timestamp the SERVER stamps from its own UTC clock.
 *
 * The client sends only the crash EVENT (command + library it faulted in, plus
 * the display hostname) — never a time. The server reads the current log content,
 * formats the segfault line via the shared `core/logging/kernLog` formatter using
 * `deps.now()` (UTC), appends, and upserts. Same single-source-of-truth-for-time
 * posture as `handleAppendAuthLog`: a crafted request cannot dictate the clock.
 *
 * Flow mirrors `handleAppendAuthLog`: verify the signed envelope → confirm the
 * target is the caller's OWN workstation → server-stamp writer_key from the
 * VERIFIED pubkey → read-modify-write the kern.log row (keyed on the owner's own
 * `(machine_id, KERN_LOG_PATH, writer_key)` in the shared journal). The payload
 * schema rejects a client-supplied player_key/writer_key outright; any client
 * `time`/`pid` field is simply never read.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { isOwnWorkstation } from '../identity/workstation';
import { asGameTime } from '../types';
import {
  KERN_LOG_OWNER,
  KERN_LOG_PATH,
  KERN_LOG_PERMISSIONS,
  formatSegfaultLine,
} from '../logging/kernLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type KernLogContentQuery = {
  readonly writer_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type AppendKernLogDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  readonly readKernLog: (query: KernLogContentQuery) => Promise<{
    readonly data: { readonly content: string | null } | null;
    readonly error: unknown;
  }>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key/writer_key (the server stamps
// the writer). Any client `time`/`pid` is ignored — the server clock is authoritative.
const appendKernLogSchema = z
  .looseObject({
    action: z.literal('appendKernLog'),
    machine_id: z.string().min(1),
    command: z.string().min(1),
    library: z.string().min(1),
    hostname: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

export const handleAppendKernLog = async (
  body: unknown,
  deps: AppendKernLogDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, appendKernLogSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const existing = await deps.readKernLog({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: KERN_LOG_PATH,
  });
  if (existing.error) {
    return { status: 500, body: { error: 'read_failed' } };
  }
  const current = existing.data?.content ?? '';

  const stamp = deps.now();
  const line = formatSegfaultLine({
    command: payload.command,
    library: payload.library,
    hostname: payload.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });

  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: KERN_LOG_PATH,
    content: `${current}${line}\n`,
    owner: KERN_LOG_OWNER,
    permissions: KERN_LOG_PERMISSIONS,
    node_type: 'file',
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
