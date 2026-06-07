/**
 * sessionsApi adapter — the signed client for the server-authoritative
 * `sessions` table over `/api/sessions`.
 *
 * `createServerSession` persists a pushed shell session (today only `su`);
 * `listServerSessions` reads the caller's OWN active sessions to rebuild the
 * hop chain on boot. Both speak the same signed envelope as `patchApi`, with
 * signing encapsulated by `signRequest`.
 *
 * Scope is the player's own workstation (su is same-machine): both calls send
 * `deps.machineId`. Cross-machine `ssh` listing/creation is a later epic.
 *
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { signRequest } from '../core/signedRequest/sign';
import { asEpochMs, asMachineId, asPlayerKeyHex, type MachineId } from '../core/types';
import type { Identity, PatchResult, Session } from '../core/commands/types';
import type { SessionSummary } from '../core/sessions/listSessions';

const DEFAULT_ENDPOINT = '/api/sessions';

export type SessionsClientDeps = {
  readonly identity: Identity;
  /** The player's own workstation id — the machine these sessions live on. */
  readonly machineId: MachineId;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
};

const post = async (
  deps: SessionsClientDeps,
  action: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const doFetch = deps.fetchImpl ?? fetch;
  const envelope = signRequest(deps.identity, action, fields);
  return doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
};

/** Map a write response to a PatchResult. 403 is the own-workstation rejection
 *  (no_session); anything else non-ok is a transport-level failure. */
const toResult = (response: Response): PatchResult => {
  if (response.ok) return { ok: true };
  if (response.status === 403) return { ok: false, error: 'no_session' };
  return { ok: false, error: 'network_error' };
};

/** Persist a pushed session. Fire-and-forget at the call site, but returns a
 *  PatchResult so callers can react if they choose. `parentSessionId` is the id
 *  of the session beneath it on the stack (null at the base login). */
export const createServerSession = async (
  deps: SessionsClientDeps,
  session: Session,
  parentSessionId: string | null,
): Promise<PatchResult> => {
  try {
    return toResult(
      await post(deps, 'createSession', {
        machine_id: deps.machineId,
        session_id: session.id,
        credentials: { username: session.username, userType: session.userType },
        kind: session.kind,
        parent_session_id: parentSessionId,
      }),
    );
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

const summaryToSession = (deps: SessionsClientDeps, row: SessionSummary): Session => ({
  id: row.session_id,
  playerKey: asPlayerKeyHex(deps.identity.publicKeyHex),
  machineId: asMachineId(row.machine_id),
  username: row.credentials.username,
  userType: row.credentials.userType,
  kind: row.kind,
  createdAt: asEpochMs(Date.parse(row.created_at)),
});

/** Read the caller's own active sessions. Returns `[]` on any failure so boot
 *  degrades to the base login rather than crashing the terminal. */
export const listServerSessions = async (
  deps: SessionsClientDeps,
): Promise<readonly Session[]> => {
  try {
    const response = await post(deps, 'listSessions', { machine_id: deps.machineId });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const rows = (body as { sessions?: readonly SessionSummary[] } | null)?.sessions ?? [];
    return rows.map((row) => summaryToSession(deps, row));
  } catch {
    return [];
  }
};
