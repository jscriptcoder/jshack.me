/**
 * sessionsApi adapter — the signed client for the server-authoritative
 * `sessions` table over `/api/sessions`.
 *
 * `createServerSession` persists a pushed shell session (today only `su`);
 * `listServerSessions` reads the caller's OWN active sessions to rebuild the
 * hop chain on boot. Both speak the same signed envelope as `patchApi`, with
 * signing encapsulated by `signRequest`.
 *
 * `createServerSession` is own-workstation scoped (su is same-machine) and
 * sends `deps.machineId`; `listServerSessions` sends NO machine filter — the
 * hop chain spans machines (ssh hops carry the remote host's id), and the
 * server scopes the read by the verified player_key alone.
 *
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { z } from 'zod';
import { signRequest } from '../core/signedRequest/sign';
import {
  asEpochMs,
  asMachineId,
  asPlayerKeyHex,
  type MachineId,
  type UserType,
} from '../core/types';
import type {
  Identity,
  InnerGatewayAuthParams,
  PatchResult,
  PublicAuthParams,
  PublicAuthResult,
  RemoteAuthParams,
  RemoteAuthResult,
  SameLanAuthParams,
  Session,
  SuElevateParams,
  HydraCrackParams,
  HydraCrackPublicParams,
  HydraCrackResult,
} from '../core/commands/types';
import type { SessionSummary } from '../core/sessions/listSessions';

const DEFAULT_ENDPOINT = '/api/sessions';

/** The crack response, validated at the trust boundary rather than cast: the
 *  cracked list drives what the player is told they can log in with. */
const crackResponseSchema = z.object({
  port: z.number().int(),
  cracked: z.array(z.object({ username: z.string(), password: z.string() })),
  wordlistFound: z.boolean(),
});

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

const isUserType = (value: unknown): value is UserType =>
  value === 'root' || value === 'user' || value === 'guest';

/** Authenticate an ssh login server-side: the server regenerates the remote host's
 *  filesystem, validates the password against its `/etc/passwd`, and on success
 *  persists the `kind:'ssh'` session row and returns the server-derived userType.
 *  401 → bad password OR unknown user (indistinguishable); 404 → the IP is not a
 *  reachable host. A 200 whose body lacks a valid userType is treated as a
 *  malformed response, never a successful login. */
export const authCreateServerSession = async (
  deps: SessionsClientDeps,
  params: RemoteAuthParams,
): Promise<RemoteAuthResult> => {
  try {
    const response = await post(deps, 'authCreateSession', {
      session_id: params.sessionId,
      essid: params.essid,
      target_ip: params.targetIp,
      username: params.username,
      password: params.password,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const userType = (body as { userType?: unknown } | null)?.userType;
      return isUserType(userType) ? { ok: true, userType } : { ok: false, error: 'network_error' };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_credentials' };
    if (response.status === 404) return { ok: false, error: 'host_unreachable' };
    return { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Authenticate a CROSS-PLAYER ssh login server-side (Story 2): the server resolves
 *  the target PUBLIC IP to its AP, rebuilds the owner's workstation, validates
 *  the password against its `/etc/passwd`, and on success persists the `kind:'ssh'`
 *  session on the owner's REAL machine id (returned as `machineId` for the prompt
 *  + the hop chain). 401 → bad password/unknown user; 404 → the IP isn't registered.
 *  A 200 missing a valid userType OR machine_id is treated as malformed, never a
 *  login (we must never land a session with no target id). */
export const authCreateServerSessionPublic = async (
  deps: SessionsClientDeps,
  params: PublicAuthParams,
): Promise<PublicAuthResult> => {
  try {
    const response = await post(deps, 'authCreateSessionPublic', {
      session_id: params.sessionId,
      target: params.target,
      username: params.username,
      password: params.password,
      port: params.port,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const userType = (body as { userType?: unknown } | null)?.userType;
      const machineId = (body as { machine_id?: unknown } | null)?.machine_id;
      return isUserType(userType) && typeof machineId === 'string'
        ? { ok: true, userType, machineId }
        : { ok: false, error: 'network_error' };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_credentials' };
    if (response.status === 404) return { ok: false, error: 'host_unreachable' };
    return { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Authenticate a SAME-WiFi LAN ssh login server-side (Story 7): the server resolves
 *  the target LAN IP through the ESSID occupancy, rebuilds the fellow occupant's
 *  workstation, validates the password against its `/etc/passwd`, and on success
 *  persists the `kind:'ssh'` session on the owner's REAL machine id (returned as
 *  `machineId` for the prompt + hop chain). 401 → bad password/unknown user; 404 → the
 *  LAN IP is no occupant's box (or the box is dark / not serving sshd); 403 (caller not
 *  an occupant) collapses to network_error like any other non-ok. A 200 missing a valid
 *  userType OR machine_id is malformed, never a login. */
export const authCreateServerSessionSameLan = async (
  deps: SessionsClientDeps,
  params: SameLanAuthParams,
): Promise<PublicAuthResult> => {
  try {
    const response = await post(deps, 'authCreateSessionSameLan', {
      session_id: params.sessionId,
      essid: params.essid,
      target_ip: params.targetIp,
      username: params.username,
      password: params.password,
      port: params.port,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const userType = (body as { userType?: unknown } | null)?.userType;
      const machineId = (body as { machine_id?: unknown } | null)?.machine_id;
      return isUserType(userType) && typeof machineId === 'string'
        ? { ok: true, userType, machineId }
        : { ok: false, error: 'network_error' };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_credentials' };
    if (response.status === 404) return { ok: false, error: 'host_unreachable' };
    return { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Authenticate an ssh login THROUGH a NAT forward on the player's OWN inner gateway
 *  onto a deep Layer-2 host: the server regenerates the gateway from the verified key +
 *  essid, routes the forwarded port via `machineServing`, validates the password against
 *  the deep host's `/etc/passwd`, and on success persists the `kind:'ssh'` session on the
 *  DEEP HOST's machine id (returned as `machineId` for the prompt + hop chain). 401 → bad
 *  password/unknown user; 404 → no forward / a dark target / a bricked gateway. A 200
 *  missing a valid userType OR machine_id is malformed, never a login. */
export const authCreateServerSessionInnerGateway = async (
  deps: SessionsClientDeps,
  params: InnerGatewayAuthParams,
): Promise<PublicAuthResult> => {
  try {
    const response = await post(deps, 'authCreateSessionInnerGateway', {
      session_id: params.sessionId,
      essid: params.essid,
      target: params.target,
      username: params.username,
      password: params.password,
      port: params.port,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const userType = (body as { userType?: unknown } | null)?.userType;
      const machineId = (body as { machine_id?: unknown } | null)?.machine_id;
      return isUserType(userType) && typeof machineId === 'string'
        ? { ok: true, userType, machineId }
        : { ok: false, error: 'network_error' };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_credentials' };
    if (response.status === 404) return { ok: false, error: 'host_unreachable' };
    return { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Elevate a session B ALREADY holds on a registered FOREIGN workstation to root
 *  (Story 4): the server resolves the box by its `machine_id`, rebuilds the owner's
 *  tree, validates the password against its `/etc/passwd`, and on success persists a
 *  root-tier `kind:'su'` row and returns the server-derived userType. 401 → bad
 *  password/unknown user; 404 → the machine isn't registered. A 200 missing a valid
 *  userType is treated as malformed, never a successful elevation. */
export const authElevateServerSession = async (
  deps: SessionsClientDeps,
  params: SuElevateParams,
): Promise<RemoteAuthResult> => {
  try {
    const response = await post(deps, 'suElevate', {
      session_id: params.sessionId,
      machine_id: params.machineId,
      username: params.username,
      password: params.password,
      from_user: params.fromUser,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const userType = (body as { userType?: unknown } | null)?.userType;
      return isUserType(userType) ? { ok: true, userType } : { ok: false, error: 'network_error' };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_credentials' };
    if (response.status === 404) return { ok: false, error: 'host_unreachable' };
    return { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Mark a pushed session ended (the player `exit`ed it) so it no longer
 *  rehydrates. Fire-and-forget at the call site; the server scopes the update
 *  to the verified player_key, so naming a session_id you don't own is a no-op. */
export const endServerSession = async (
  deps: SessionsClientDeps,
  sessionId: string,
): Promise<PatchResult> => {
  try {
    return toResult(await post(deps, 'endSession', { session_id: sessionId }));
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
export const listServerSessions = async (deps: SessionsClientDeps): Promise<readonly Session[]> => {
  try {
    const response = await post(deps, 'listSessions', {});
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const rows = (body as { sessions?: readonly SessionSummary[] } | null)?.sessions ?? [];
    return rows.map((row) => summaryToSession(deps, row));
  } catch {
    return [];
  }
};

/**
 * Crack account passwords on a network service — the signed `hydraCrack`
 * round-trip behind `env.hydra.crack`.
 *
 * The response carries only what the caller's own wordlist could already have
 * produced, so nothing here needs hiding from the player. Errors are passed
 * through by name rather than collapsed: `hydra` tells the player which of "no
 * route", "nothing listening" and "no wordlist" happened, because they are three
 * different things to go and fix.
 */
export const crackCredentials = async (
  deps: SessionsClientDeps,
  params: HydraCrackParams,
): Promise<HydraCrackResult> => {
  try {
    const response = await post(deps, 'hydraCrack', {
      essid: params.essid,
      target_ip: params.target,
      service: params.service,
      ...(params.username === undefined ? {} : { username: params.username }),
      caller_machine_id: params.callerMachineId,
      source_ip: params.sourceIp,
    });
    return await crackOutcome(response);
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/**
 * Crack account passwords behind a PUBLIC IP — the signed `hydraCrackPublic`
 * round-trip behind `env.hydra.crackPublic`.
 *
 * Deliberately carries no source address. The target here belongs to somebody
 * else, so the line their `auth.log` records is evidence, and the server derives
 * it from the verified key instead of believing this request.
 */
export const crackCredentialsPublic = async (
  deps: SessionsClientDeps,
  params: HydraCrackPublicParams,
): Promise<HydraCrackResult> => {
  try {
    const response = await post(deps, 'hydraCrackPublic', {
      essid: params.essid,
      target: params.target,
      service: params.service,
      ...(params.port === undefined ? {} : { port: params.port }),
      ...(params.username === undefined ? {} : { username: params.username }),
      caller_machine_id: params.callerMachineId,
    });
    return await crackOutcome(response);
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Both crack actions answer in the same shape, and both pass an error through by
 *  NAME rather than collapsing it: `hydra` tells the player which of "no route",
 *  "nothing listening" and "no wordlist" happened, because they are three different
 *  things to go and fix. */
const crackOutcome = async (response: Response): Promise<HydraCrackResult> => {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof error === 'string' ? error : 'network_error' };
  }
  const parsed = crackResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'network_error' };
  return {
    ok: true,
    port: parsed.data.port,
    cracked: parsed.data.cracked,
    wordlistFound: parsed.data.wordlistFound,
  };
};
