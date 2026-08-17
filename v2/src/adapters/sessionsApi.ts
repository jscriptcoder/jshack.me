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
  NcConnectParams,
  NcConnectResult,
  NcInnerGatewayParams,
  NcPublicParams,
  NcPublicResult,
  NcSameLanParams,
  PublicDoorAuthParams,
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
  HydraCrackInnerGatewayParams,
  HydraCrackPublicParams,
  HydraCrackResult,
} from '../core/commands/types';
import type { SessionSummary } from '../core/sessions/listSessions';
import type { EndReason } from '../core/sessions/endSession';
import type { DoorKind } from '../core/sessions/authCreateSession';

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
  kind: DoorKind = 'ssh',
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
      kind,
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

/** Authenticate a CROSS-PLAYER login server-side, at whichever door `kind` names: the
 *  server resolves the target PUBLIC IP to its AP, rebuilds the owner's workstation,
 *  validates the password against its `/etc/passwd`, and on success persists the session
 *  on the owner's REAL machine id (returned as `machineId` for the prompt + the hop
 *  chain). 401 → bad password/unknown user; 404 → the IP isn't registered, or nothing
 *  answers that door on the port reached. A 200 missing a valid userType OR machine_id
 *  is treated as malformed, never a login (we must never land a session with no target
 *  id). */
export const authCreateServerSessionPublic = async (
  deps: SessionsClientDeps,
  params: PublicAuthParams | PublicDoorAuthParams,
  kind: DoorKind = 'ssh',
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
      kind,
      // Only a door that knows where it is being run from names one. `ssh` does not, so
      // its trace keeps carrying the address the caller owns — unchanged, and the
      // pivot-aware half of that is tracked as its own slice.
      ...('callerMachineId' in params ? { caller_machine_id: params.callerMachineId } : {}),
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

/** Mark a session ended so it no longer rehydrates. Fire-and-forget at the call
 *  site; the server scopes the update to the verified player_key, so naming a
 *  session_id you don't own is a no-op. `reason` separates the player closing a
 *  session themselves from boot closing one on a lost terminal's behalf — the two
 *  are indistinguishable in the row otherwise, and only one of them is a bug when
 *  it starts happening often. */
export const endServerSession = async (
  deps: SessionsClientDeps,
  sessionId: string,
  reason: EndReason = 'user_exit',
): Promise<PatchResult> => {
  try {
    return toResult(await post(deps, 'endSession', { session_id: sessionId, reason }));
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

/**
 * Crack account passwords on a box behind a NAT forward on one of the player's own
 * inner gateways — the signed `hydraCrackInnerGateway` round-trip behind
 * `env.hydra.crackInnerGateway`.
 *
 * Carries no source address: NAT means the deep box is shown the fronting gateway's
 * `.1` whoever is behind it, so the server derives it from the route it walked.
 */
export const crackCredentialsInnerGateway = async (
  deps: SessionsClientDeps,
  params: HydraCrackInnerGatewayParams,
): Promise<HydraCrackResult> => {
  try {
    const response = await post(deps, 'hydraCrackInnerGateway', {
      essid: params.essid,
      target: params.target,
      service: params.service,
      port: params.port,
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

/** Open a door that asks for nothing, at whichever gate the address decided.
 *
 * The four functions below are the ssh adapters minus the credential: the payload
 * carries where the knock is aimed and nothing about who is knocking, because the
 * pidfile on the far side already says who it admits. What comes back therefore
 * includes the USERNAME as well as the tier — the caller never knew it, which is the
 * whole difference from a password door.
 *
 * A 401 cannot happen here (there is no credential to reject), so anything that is
 * not a 200 with a usable body collapses to the two facts netcat can actually report:
 * the door was not there, or the wire failed.
 */

/** The half of a door's answer every arm shares. Null for a body that is missing
 *  either half — never a session with no user or no tier. */
const openedDoor = (body: unknown): { username: string; userType: UserType } | null => {
  const username = (body as { username?: unknown } | null)?.username;
  const userType = (body as { userType?: unknown } | null)?.userType;
  return typeof username === 'string' && username.length > 0 && isUserType(userType)
    ? { username, userType }
    : null;
};

const doorFailure = (
  status: number,
): { readonly ok: false; readonly error: 'host_unreachable' | 'network_error' } =>
  status === 404 ? { ok: false, error: 'host_unreachable' } : { ok: false, error: 'network_error' };

export const ncConnectServer = async (
  deps: SessionsClientDeps,
  params: NcConnectParams,
): Promise<NcConnectResult> => {
  try {
    const response = await post(deps, 'authCreateSession', {
      session_id: params.sessionId,
      essid: params.essid,
      target_ip: params.targetIp,
      port: params.port,
      parent_session_id: params.parentSessionId,
      source_ip: params.sourceIp,
      kind: 'nc',
    });
    if (!response.ok) return doorFailure(response.status);
    const opened = openedDoor(await response.json());
    return opened === null ? { ok: false, error: 'network_error' } : { ok: true, ...opened };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** The three arms that land on a box whose id only the server can resolve. They differ
 *  only in the action they post and the address field it names, so they share the
 *  body parse — a 200 missing the machine id is malformed, never a landing. */
const ncConnectVia = async (
  deps: SessionsClientDeps,
  action: string,
  payload: Record<string, unknown>,
): Promise<NcPublicResult> => {
  try {
    const response = await post(deps, action, { ...payload, kind: 'nc' });
    if (!response.ok) return doorFailure(response.status);
    const body: unknown = await response.json();
    const opened = openedDoor(body);
    const machineId = (body as { machine_id?: unknown } | null)?.machine_id;
    return opened !== null && typeof machineId === 'string'
      ? { ok: true, ...opened, machineId }
      : { ok: false, error: 'network_error' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

export const ncConnectServerPublic = (
  deps: SessionsClientDeps,
  params: NcPublicParams,
): Promise<NcPublicResult> =>
  ncConnectVia(deps, 'authCreateSessionPublic', {
    session_id: params.sessionId,
    target: params.target,
    port: params.port,
    parent_session_id: params.parentSessionId,
    source_ip: params.sourceIp,
    caller_machine_id: params.callerMachineId,
  });

export const ncConnectServerSameLan = (
  deps: SessionsClientDeps,
  params: NcSameLanParams,
): Promise<NcPublicResult> =>
  ncConnectVia(deps, 'authCreateSessionSameLan', {
    session_id: params.sessionId,
    essid: params.essid,
    target_ip: params.targetIp,
    port: params.port,
    parent_session_id: params.parentSessionId,
    source_ip: params.sourceIp,
  });

export const ncConnectServerInnerGateway = (
  deps: SessionsClientDeps,
  params: NcInnerGatewayParams,
): Promise<NcPublicResult> =>
  ncConnectVia(deps, 'authCreateSessionInnerGateway', {
    session_id: params.sessionId,
    essid: params.essid,
    target: params.target,
    port: params.port,
    parent_session_id: params.parentSessionId,
    source_ip: params.sourceIp,
  });
