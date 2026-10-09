/**
 * handleAppendAuthLog — the pure appendAuthLog endpoint logic (no Vercel, no
 * Supabase). Records an auth event on the caller's OWN box — an `su` user-switch, a
 * session opened with no authentication, or a login through one of its own doors —
 * with a timestamp the SERVER stamps from its own UTC clock.
 *
 * The client sends only the EVENT — never a time. The server reads the current log content, formats the syslog line via
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
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { isOwnWorkstation } from '../identity/workstation.js';
import { asGameTime } from '../types.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSessionOpenedLine,
  formatSuAuthLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { SERVICE_CATALOG, formatLoginLines, type SweepLog } from '../services/serviceCatalog.js';
import { SERVICE_BY_DOOR } from '../sessions/authCreateSession.js';
import type { PatchRow } from './upsertPatch.js';
import {
  logAsReadersSeeIt,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog.js';

export type AppendAuthLogDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  /** Every writer's copy of the log on the caller's machine — an intruder with root
   *  may have wiped it, and the owner's next line must not bring the wiped lines back. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
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
// leaves. It carries only the user the shell landed as; the server formats
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

// A login through a door on the caller's own box, which the client answers itself. The
// address must be one, because it is written into the line verbatim: anything else
// could carry a line of its own.
const doorLoginSchema = z
  .looseObject({
    action: z.literal('appendAuthLog'),
    kind: z.literal('doorLogin'),
    door: z.enum(['ssh', 'scp', 'ftp']),
    machine_id: z.string().min(1),
    user: z.string().min(1),
    from_ip: z.ipv4(),
    outcome: z.enum(['success', 'failure']),
    hostname: z.string().min(1),
  })
  .refine(noStampedKeys);

// The discriminated shapes first, so a payload carrying a discriminant is matched by its
// own shape rather than falling through to the su schema (which would reject it for
// missing su fields); a su envelope fails both kind literals and routes on.
const appendAuthLogSchema = z.union([sessionOpenedSchema, doorLoginSchema, suSwitchSchema]);

type AppendAuthLogPayload = z.infer<typeof appendAuthLogSchema>;

/** Where the event's line goes and what it says. A door's line is the one its daemon
 *  writes — the same catalog column a login or a sweep against that service records
 *  through, so the own box cannot keep its evidence anywhere a stranger's box would not. */
const lineFor = (
  payload: AppendAuthLogPayload,
  stamp: number,
): { readonly log: Pick<SweepLog, 'path' | 'owner' | 'permissions'>; readonly line: string } => {
  const time = asGameTime(stamp);
  const pid = derivePid(stamp);
  const authLog = { path: AUTH_LOG_PATH, owner: AUTH_LOG_OWNER, permissions: AUTH_LOG_PERMISSIONS };
  if (payload.kind === 'doorLogin') {
    const sweepLog = SERVICE_CATALOG[SERVICE_BY_DOOR[payload.door]].sweepLog;
    return {
      log: sweepLog,
      line: formatLoginLines(sweepLog, {
        outcome: payload.outcome,
        user: payload.user,
        fromIp: payload.from_ip,
        hostname: payload.hostname,
        time,
        pid,
      }),
    };
  }
  if (payload.kind === 'sessionOpened') {
    return {
      log: authLog,
      line: formatSessionOpenedLine({ user: payload.user, hostname: payload.hostname, time, pid }),
    };
  }
  return {
    log: authLog,
    line: formatSuAuthLine({
      outcome: payload.outcome,
      targetUser: payload.target_user,
      fromUser: payload.from_user,
      hostname: payload.hostname,
      time,
      pid,
    }),
  };
};

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

  const { log, line } = lineFor(payload, deps.now());
  const existing = await deps.readAuthLog({ machine_id: payload.machine_id, path: log.path });
  if (existing.error) {
    return { status: 500, body: { error: 'read_failed' } };
  }
  const current = logAsReadersSeeIt(existing.data);

  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: log.path,
    content: `${current}${line}\n`,
    owner: log.owner,
    permissions: log.permissions,
    node_type: 'file',
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
