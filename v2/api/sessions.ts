import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleCreateSession, type SessionRow } from '../src/core/sessions/createSession';
import {
  handleAuthCreateSession,
  type AuthSessionRow,
} from '../src/core/sessions/authCreateSession';
import { handleAuthCreateSessionPublic } from '../src/core/sessions/authCreateSessionPublic';
import type { NatOccupantRow, ApNetworkLookup } from '../src/core/network/resolvePublicTarget';
import { computeApGatewayId } from '../src/core/identity/router';
import {
  handleAuthCreateSessionSameLan,
  type OccupantConnectRow,
} from '../src/core/sessions/authCreateSessionSameLan';
import type { LanLeaseRow } from '../src/core/network/lanAddress';
import { handleAuthCreateSessionInnerGateway } from '../src/core/sessions/authCreateSessionInnerGateway';
import { handleHydraCrack } from '../src/core/sessions/hydraCrack';
import { handleMysqlConnect } from '../src/core/sessions/mysqlConnect';
import { handleMysqlStatement } from '../src/core/sessions/mysqlStatement';
import { handleRedisConnect } from '../src/core/sessions/redisConnect';
import { handleRedisStatement } from '../src/core/sessions/redisStatement';
import { handleHydraCrackPublic } from '../src/core/sessions/hydraCrackPublic';
import { handleHydraCrackInnerGateway } from '../src/core/sessions/hydraCrackInnerGateway';
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs';
import {
  handleAuthElevateSession,
  type OccupantWorkstation,
  type SuSessionRow,
} from '../src/core/sessions/authElevateSession';
import {
  handleListSessions,
  type ListSessionsQuery,
  type SessionSummary,
} from '../src/core/sessions/listSessions';
import { handleEndSession, type EndSessionParams } from '../src/core/sessions/endSession';
import type { MachineLogReadQuery } from '../src/core/patches/appendMachineLog';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess';
import type { UserType } from '../src/core/types';
import type {
  ListPathPatchesResult,
  PathPatchRow,
  PatchRow,
} from '../src/core/patches/upsertPatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/sessions.
//
// Ten signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe. They span session creation (own machine, own LAN, same
// LAN, cross-player public, inner gateway), su elevation, the three credential
// sweeps (own LAN, public, deep), and the two session reads.
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands when
// cross-player flows need it). Same posture as /api/patches.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

const actionOf = (body: unknown): string | undefined => {
  const payload = (body as { payload?: unknown } | null)?.payload;
  if (typeof payload !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as { action?: string }).action
      : undefined;
  } catch {
    return undefined;
  }
};

// ---- One spelling per query ----
//
// Most of the ten actions need the same handful of supabase reads and writes, and an
// inline copy per action is a copy `tsc` cannot check: a column name is a string, so a
// journal read that drifts in one action ships green through every local gate and is
// caught only by whichever wire-check happens to cover it. Each factory below owns ONE
// query — its table, its columns, its ordering, its cast — so the column list is written
// once.
//
// Every failure logs as `[sessions] <label> error:`. The label is an argument rather than
// a casualty of the collapse: ten actions share one function log, and the label is the
// only thing in that line saying which of them failed.

type QuerySpec = {
  readonly supabase: SupabaseClient;
  readonly label: string;
};

const logFailure = (label: string, error: unknown) => {
  if (error) console.error(`[sessions] ${label} error:`, error);
};

/** Every row shape this endpoint persists into `sessions`. They differ in `kind` and in
 *  whether an `essid` rides along; the insert itself does not care, and each handler has
 *  already validated the row it hands over. */
type PersistedSessionRow = SessionRow | AuthSessionRow | SuSessionRow;

const insertSessionVia =
  ({ supabase, label }: QuerySpec) =>
  async (row: PersistedSessionRow) => {
    const { error } = await supabase.from('sessions').insert(row);
    logFailure(label, error);
    return { error };
  };

/** A machine's FULL shared journal — machine-scoped, in server order — so the caller
 *  materializes the box's REAL state before anything else happens to it. A `/boot`
 *  tombstone is why this read comes first: a bricked host reads as dark from inside the
 *  LAN and from the WAN alike, and the gate refuses the login before a password is ever
 *  checked. */
const findPatchesVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ machine_id }: { machine_id: string }) => {
    const { data, error } = await supabase
      .from('patches')
      .select('path, content, owner, permissions, node_type, updated_at, writer_key')
      .eq('machine_id', machine_id)
      .order('updated_at', { ascending: true })
      .order('writer_key', { ascending: true });
    logFailure(label, error);
    return { data: data as readonly OwnerPatchRow[] | null, error };
  };

/** The read half of a system-written log append. Every auth.log line is a
 *  read-modify-write that bypasses L1/L2 — the service records it, not the player — so
 *  the appender reads what is already at the path before writing the appended line.
 *  WHICH key it reads under is the calling action's decision (the machine owner's for a
 *  shared box, the caller's own on the deep paths), not this query's. */
const readAuthLogVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
    const { data, error } = await supabase
      .from('patches')
      .select('content')
      .eq('writer_key', writer_key)
      .eq('machine_id', machine_id)
      .eq('path', path)
      .maybeSingle();
    logFailure(label, error);
    return { data, error };
  };

/** The write half of that append. The conflict target is named explicitly rather than
 *  left to PostgREST's primary-key default: `patches` is keyed on exactly
 *  `(machine_id, path, writer_key)`, so spelling it out documents the dependency instead
 *  of relying on it silently. */
const upsertPatchVia =
  ({ supabase, label }: QuerySpec) =>
  async (row: PatchRow) => {
    const { error } = await supabase
      .from('patches')
      .upsert(row, { onConflict: 'machine_id,path,writer_key' });
    logFailure(label, error);
    return { error };
  };

/** What a public IP resolves to: the AP that bears it. The gateway is the access point's
 *  own infrastructure, so it answers whether or not anyone is on the WiFi and its id
 *  derives from the ESSID — there is no gateway row to miss. A public IP nobody bears
 *  resolves to `null` without being an error. */
const findNetworkByPublicIpVia =
  ({ supabase, label }: QuerySpec) =>
  async (publicIp: string) => {
    const network = await supabase
      .from('network_public_ips')
      .select('essid')
      .eq('public_ip', publicIp)
      .maybeSingle();
    if (network.error) {
      logFailure(label, network.error);
      return { data: null, error: network.error };
    }
    const essid = (network.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };
    const resolved: ApNetworkLookup = {
      router_machine_id: computeApGatewayId(essid),
      essid,
    };
    return { data: resolved, error: null };
  };

/** One network's public address, by ESSID. The address belongs to the AP and is shared
 *  by every occupant, so this answers "what does traffic from that network look like
 *  from outside" without asking who owns it — which is what a trace needs when the actor
 *  is operating from a box they do not own. An ESSID nobody has been allocated an
 *  address for resolves to `null` without being an error. */
const findPublicIpByEssidVia =
  ({ supabase, label }: QuerySpec) =>
  async (essid: string) => {
    const { data, error } = await supabase
      .from('network_public_ips')
      .select('public_ip')
      .eq('essid', essid)
      .maybeSingle();
    logFailure(label, error);
    return { data: data as { public_ip: string } | null, error };
  };

/** The caller's own home public IP — the truthful source address for a trace they leave
 *  from their own workstation, server-derived from their verified owner key and never the
 *  client's claimed `source_ip`. One player may carry rows for several APs they have
 *  joined; the most-recently-updated is their current network ("one network at a time").
 *  `owner_key` is not the PK, hence the order+limit. Two reads, so two labels: the
 *  occupancy that names their network, then the same ESSID lookup above. */
const findHomeNetworkByOwnerKeyVia =
  ({
    supabase,
    occupancyLabel,
    lookupLabel,
  }: {
    readonly supabase: SupabaseClient;
    readonly occupancyLabel: string;
    readonly lookupLabel: string;
  }) =>
  async (ownerKey: string) => {
    const occupancy = await supabase
      .from('home_network_occupants')
      .select('essid')
      .eq('owner_key', ownerKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (occupancy.error) {
      logFailure(occupancyLabel, occupancy.error);
      return { data: null, error: occupancy.error };
    }
    const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };
    return findPublicIpByEssidVia({ supabase, label: lookupLabel })(essid);
  };

/** Every occupant currently ON an ESSID, with the identity fields that rebuild each box
 *  and the hostname its trace line carries. This is the AUTH projection — it includes the
 *  root hash, is server-internal, and is never sent to a client (distinct from the lean
 *  `resolveOccupants` read, which omits the hash). Occupancy doubles as the reachability
 *  test: a machine whose owner ran `nmcli disconnect` has no row, so nothing reaches it.
 *  Callers name the row type they expect, since the same projection answers both the
 *  cross-player and the same-LAN paths. */
const listOccupantsByEssidVia =
  <Row>({ supabase, label }: QuerySpec) =>
  async (essid: string) => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .select(
        'owner_key, workstation_machine_id, workstation_machine_name, workstation_username, workstation_root_hash',
      )
      .eq('essid', essid);
    logFailure(label, error);
    return { data: data as readonly Row[] | null, error };
  };

/** Every lease on an ESSID in ONE read — where each occupant answers, so the public gate
 *  and the same-LAN path resolve one box to one address, and a caller's trace carries the
 *  source address it was really sent from. */
const listLeasesByEssidVia =
  ({ supabase, label }: QuerySpec) =>
  async (essid: string) => {
    const { data, error } = await supabase
      .from('network_lan_leases')
      .select('owner_key, octet')
      .eq('essid', essid);
    logFailure(label, error);
    return { data: data as readonly LanLeaseRow[] | null, error };
  };

/** Whether the caller currently stands on the machine they named — their own workstation
 *  bypasses this inside the handler, anything else needs a live ssh session there. Same
 *  query and same shape the patch endpoints use, so a sweep and a write from one shell
 *  agree about where the player is. */
const findActiveSessionVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ player_key, machine_id }: ActiveSessionQuery): Promise<FindActiveSessionResult> => {
    const { data, error } = await supabase
      .from('sessions')
      .select('credentials, essid')
      .eq('player_key', player_key)
      .eq('machine_id', machine_id)
      .is('ended_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    logFailure(label, error);
    if (data === null) return { data: null, error };
    const row = data as { credentials: { username: string; userType: UserType }; essid: string };
    return {
      data: { username: row.credentials.username, userType: row.credentials.userType, essid: row.essid },
      error,
    };
  };

/** Every writer's rows at one path on one machine. Machine-scoped, NOT writer-scoped: the
 *  file belongs to the box, so what a sweep reads is what the last writer left there — the
 *  same file `cat` shows on that machine. The sort keys come back with the rows; the
 *  handler picks the row a reader materializes, so ordering lives in core, not SQL. */
const listPathPatchesVia =
  ({ supabase, label }: QuerySpec) =>
  async ({
    machine_id,
    path,
  }: {
    readonly machine_id: string;
    readonly path: string;
  }): Promise<ListPathPatchesResult> => {
    const { data, error } = await supabase
      .from('patches')
      .select('content, updated_at, writer_key')
      .eq('machine_id', machine_id)
      .eq('path', path);
    logFailure(label, error);
    return { data: data as readonly PathPatchRow[] | null, error };
  };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (actionOf(req.body) === 'listSessions') {
    // No machine filter: the hop chain spans machines (su rows carry the own
    // workstation id, ssh rows the remote host's), and player_key scoping is
    // the boundary — handleListSessions stamps it from the verified pubkey.
    const listSessions = async ({ player_key }: ListSessionsQuery) => {
      const { data, error } = await supabase
        .from('sessions')
        .select(
          'session_id, machine_id, credentials, parent_session_id, source_ip, kind, created_at',
        )
        .eq('player_key', player_key)
        .is('ended_at', null)
        .order('created_at', { ascending: true });
      logFailure('list', error);
      return { data: data as readonly SessionSummary[] | null, error };
    };
    const { status, body } = await handleListSessions(req.body, {
      nonceStore: noopNonceStore,
      listSessions,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'endSession') {
    // Scope the update to the verified player_key so a caller can only end
    // their OWN sessions; a non-owned session_id matches zero rows (no-op).
    const endSession = async ({ session_id, player_key, reason }: EndSessionParams) => {
      const { error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: reason })
        .eq('session_id', session_id)
        .eq('player_key', player_key);
      logFailure('end', error);
      return { error };
    };
    const { status, body } = await handleEndSession(req.body, {
      nonceStore: noopNonceStore,
      endSession,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSession') {
    // Cross-machine ssh session on the player's OWN LAN: the handler regenerates the
    // remote FS and validates the password server-side before the insert ever runs. The
    // sshd auth.log line lands on the REMOTE host.
    const { status, body } = await handleAuthCreateSession(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      insertSession: insertSessionVia({ supabase, label: 'auth insert' }),
      findPatches: findPatchesVia({ supabase, label: 'own-lan boot-state lookup' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'ssh auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'ssh auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionPublic') {
    // Cross-PLAYER login at whichever door the caller knocked on (`kind`): resolve the
    // target PUBLIC IP to its AP, then the handler
    // materializes the ESSID's shared GATEWAY and routes by destination port — port 22
    // lands on the gateway itself (validated against its ESSID-seeded admin password),
    // a NAT-forwarded port on whichever occupant LEASES the address that forward names.
    // A reachable attempt leaves an auth.log trace on the machine it reached, written
    // under the key that owns that machine's logs so multi-attacker rows don't collide,
    // at the attacker's server-derived home address rather than anything they claimed.
    const { status, body } = await handleAuthCreateSessionPublic(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findNetworkByPublicIp: findNetworkByPublicIpVia({ supabase, label: 'public-ip lookup' }),
      findPatches: findPatchesVia({ supabase, label: 'public auth boot-state lookup' }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'public auth occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'public auth lan-lease list' }),
      insertSession: insertSessionVia({ supabase, label: 'public auth insert' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'public auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'public auth-log upsert' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'public auth source-ip occupancy',
        lookupLabel: 'public auth source-ip lookup',
      }),
      // A door that names the box it was run from gets the honest address: the network
      // that box is on, which is what the target actually saw.
      findPublicIpByEssid: findPublicIpByEssidVia({
        supabase,
        label: 'public auth vantage-ip lookup',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'public auth active-session' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionSameLan') {
    // Same-WiFi LAN ssh login: B reaches a fellow occupant A's workstation DIRECTLY
    // over the shared LAN (no router/NAT). The handler reads the ESSID's occupancy
    // (the LAN-boundary gate + LAN-IP match), materializes A's box, and validates the
    // password server-side before the insert runs. The trace on A's workstation is
    // written under A's owner key, source = B's server-derived LAN IP.
    const { status, body } = await handleAuthCreateSessionSameLan(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      listOccupantsByEssid: listOccupantsByEssidVia<OccupantConnectRow>({
        supabase,
        label: 'same-lan occupants lookup',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'same-lan lan-lease list' }),
      findPatches: findPatchesVia({ supabase, label: 'same-lan boot-state lookup' }),
      insertSession: insertSessionVia({ supabase, label: 'same-lan auth insert' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'same-lan auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'same-lan auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionInnerGateway') {
    // ssh THROUGH a NAT forward on the player's OWN inner gateway onto a deep Layer-2
    // host. The handler regenerates the gateway from the verified key + essid, replays
    // its journal (to read the forward + boot state), and routes the forwarded port to
    // the deep NPC — validating the password against ITS /etc/passwd before the insert.
    // Own-keyed + private: no network lookup, no occupancy. The trace accretes under the
    // CALLER's own key, matching the other two deep writers (see the shared-row note in
    // docs/conventions-and-gotchas.md §9 — these boxes are ESSID-shared, not per-viewer).
    const { status, body } = await handleAuthCreateSessionInnerGateway(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'inner-gateway boot-state lookup' }),
      insertSession: insertSessionVia({
        supabase,
        label: 'inner-gateway auth insert',
      }),
      readAuthLog: readAuthLogVia({ supabase, label: 'inner-gateway auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'inner-gateway auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'mysqlConnect') {
    // A database login. NO session row is created — a database connection has none,
    // and the credential is re-validated on every statement instead. The handler
    // READS the target's journal (its real datadir, and what it is actually running)
    // and WRITES one line to its own /var/log/mysql.log, the trace an accepted and a
    // refused connection both leave.
    //
    // The target may be on the caller's own LAN, behind one of their gateways, or on
    // a PUBLIC address belonging to somebody else's access point — the door decides
    // from the address, server-side. The cross-player lookups below are what that last
    // route resolves through: which network bears the address, who leases the box the
    // forward names, and the attacker's own address for the line the defender reads.
    const { status, body } = await handleMysqlConnect(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'mysql target journal lookup' }),
      readMysqlLog: readAuthLogVia({ supabase, label: 'mysql log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'mysql log upsert' }),
      findNetworkByPublicIp: findNetworkByPublicIpVia({
        supabase,
        label: 'mysql connect public-ip lookup',
      }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'mysql connect occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'mysql connect lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'mysql connect source-ip occupancy',
        lookupLabel: 'mysql connect source-ip lookup',
      }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'mysqlStatement') {
    // One statement against a database — own-LAN, deep, or another player's box across
    // the world; the reach is the login door's, shared, so the two cannot disagree.
    // Every row this writes on another player's box lands under THEIR key: the datadir
    // is one file however many people are editing it, and their logs are the system's. The credential is re-sent
    // and re-validated here because the connection minted no session row to trust
    // instead. The handler READS the target's journal (its real datadir, and what it
    // is actually running); a statement that CHANGES the database writes the datadir
    // back, and the daemon records what changed -- or who was refused a change -- in
    // its own /var/log/mysql.log. A session of reads still writes neither. What comes
    // back is rendered text only -- rows would hand the client what the account could
    // not select.
    const { status, body } = await handleMysqlStatement(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'mysql statement journal lookup' }),
      readMysqlLog: readAuthLogVia({ supabase, label: 'mysql statement log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'mysql datadir + log upsert' }),
      findNetworkByPublicIp: findNetworkByPublicIpVia({
        supabase,
        label: 'mysql statement public-ip lookup',
      }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'mysql statement occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'mysql statement lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'mysql statement source-ip occupancy',
        lookupLabel: 'mysql statement source-ip lookup',
      }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'redisConnect') {
    // Opening a key-value store. NO credential arrives with it and NO session row is
    // created: a store answers to one secret or to none, the secret belongs to the
    // service rather than to a person, and a row minted for a connection that proved
    // nothing would hand `listPatches` and `upsertPatch` to anyone who reaches 6379.
    //
    // The handler READS the target's journal (what it is actually running) and WRITES
    // one line to its own /var/log/redis.log. One line, not two: the database door
    // sends its credential in the handshake and so records the arrival and the verdict
    // together, while nothing was attempted here.
    //
    // The reach is the database door's, shared — same four vantages, same boot gate,
    // same pidfile check, asked about a different daemon.
    const { status, body } = await handleRedisConnect(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'redis target journal lookup' }),
      readRedisLog: readAuthLogVia({ supabase, label: 'redis log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'redis log upsert' }),
      findNetworkByPublicIp: findNetworkByPublicIpVia({
        supabase,
        label: 'redis connect public-ip lookup',
      }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'redis connect occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'redis connect lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'redis connect source-ip occupancy',
        lookupLabel: 'redis connect source-ip lookup',
      }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'redisStatement') {
    // One statement against a store. The reach is re-established here rather than
    // trusted from the connection, and that repeat IS the eviction mechanism: with no
    // session row to invalidate, a player shut out by `systemctl stop redis` can only
    // discover it by asking again.
    //
    // The handler READS the target's journal — the store somebody may have edited as
    // root — and writes for two: a judged `AUTH`, and a statement that actually changed
    // the store, which lands the whole document back at the datadir and one line saying
    // who changed it. Reads never append, which is real Redis's behaviour and the
    // database door's rule both, and neither does a write that turned out to write
    // nothing.
    const { status, body } = await handleRedisStatement(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'redis statement journal lookup' }),
      readRedisLog: readAuthLogVia({ supabase, label: 'redis statement log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'redis statement upsert' }),
      findNetworkByPublicIp: findNetworkByPublicIpVia({
        supabase,
        label: 'redis statement public-ip lookup',
      }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'redis statement occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'redis statement lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'redis statement source-ip occupancy',
        lookupLabel: 'redis statement source-ip lookup',
      }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'hydraCrack') {
    // Credential sweep against a host on the caller's own LAN — a generated sibling, or
    // a FELLOW OCCUPANT of the WiFi, who is a real player's box at a real lease and
    // outranks the sibling the seed put on that octet. No session is created. The handler
    // READS the target's journal (to see its real passwd and what it is actually
    // running) and the caller's own wordlist patch — the wordlist exists solely as
    // a patch (apt wrote it; no base FS carries it), so that one row IS the file,
    // and reading it beats trusting a list the client could have posted. The one
    // WRITE is the trace it leaves on the target: a sweep is the noisiest thing a
    // player can do to a box, and the box's occupant reads it back from auth.log.
    const { status, body } = await handleHydraCrack(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession: findActiveSessionVia({ supabase, label: 'hydra active-session lookup' }),
      findPatches: findPatchesVia({ supabase, label: 'hydra target journal lookup' }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'hydra same-lan occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'hydra same-lan lease list' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'hydra wordlist read' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'hydra auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'hydra auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'hydraCrackPublic') {
    // CROSS-PLAYER credential sweep. The target is a PUBLIC IP, so it names an access
    // point rather than a machine: the shared resolver materializes that AP's gateway
    // and routes by destination port, which is the same resolution `ssh` authenticates
    // through — so a password this reports is one `ssh` then accepts. No session is
    // created. The one WRITE is the trace, and it lands on whichever box was reached,
    // under the key that owns THAT machine's logs, at the server-derived address of the
    // network the caller is STANDING on rather than anything the client claimed.
    const { status, body } = await handleHydraCrackPublic(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findNetworkByPublicIp: findNetworkByPublicIpVia({
        supabase,
        label: 'hydra public-ip lookup',
      }),
      findPatches: findPatchesVia({ supabase, label: 'hydra public target journal' }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'hydra public occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'hydra public lan-lease list' }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'hydra public active-session' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'hydra public wordlist read' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'hydra public source-ip occupancy',
        lookupLabel: 'hydra public source-ip lookup',
      }),
      findPublicIpByEssid: findPublicIpByEssidVia({
        supabase,
        label: 'hydra public vantage-ip lookup',
      }),
      readAuthLog: readAuthLogVia({ supabase, label: 'hydra public auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'hydra public auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'hydraCrackInnerGateway') {
    // DEEP credential sweep: a NAT forward on one of the caller's OWN inner gateways,
    // the only way to address a box on the layer behind it. The chain is regenerated
    // from the ESSID and each gateway's journal — no occupant or lease lookup — through
    // the same walk `ssh` authenticates by, so a password this reports is one `ssh` then
    // accepts. No session is created. The one WRITE is the trace on the box that was
    // reached, at the fronting gateway's address, which is all NAT ever shows it.
    const { status, body } = await handleHydraCrackInnerGateway(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'hydra deep gateway journal' }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'hydra deep active-session' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'hydra deep wordlist read' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'hydra deep auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'hydra deep auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'suElevate') {
    // Cross-PLAYER su-to-root: B (already ssh'd into A) escalates. Resolve A's
    // registered workstation by the machine_id B is standing on, then the handler
    // rebuilds A's box from the persisted identity and validates the typed password
    // before the insert runs (a root-tier `kind:'su'` row that makes B's later writes
    // authorize at root). A resolved attempt leaves a su auth.log trace on A's shared
    // workstation record, under the OWNER's writer_key.
    //
    // Whose box B is standing on comes from occupancy — which carries the identity fields
    // su needs AND says the machine is still on a WiFi, so a `su` into a box whose owner
    // has disconnected resolves to nothing rather than elevating on an unreachable
    // machine. One player on N APs has N rows with the SAME workstation_machine_id, so
    // `.limit(1)` picks any.
    const findOccupantWorkstationByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, essid, workstation_username, workstation_machine_name, workstation_root_hash',
        )
        .eq('workstation_machine_id', machineId)
        .limit(1)
        .maybeSingle();
      logFailure('su-elevate occupant lookup', error);
      return { data: data as OccupantWorkstation | null, error };
    };
    const { status, body } = await handleAuthElevateSession(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findOccupantWorkstationByMachineId,
      insertSession: insertSessionVia({ supabase, label: 'su-elevate insert' }),
      readAuthLog: readAuthLogVia({ supabase, label: 'su auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'su auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  const { status, body } = await handleCreateSession(req.body, {
    nonceStore: noopNonceStore,
    insertSession: insertSessionVia({ supabase, label: 'insert' }),
  });
  res.status(status).json(body);
}
