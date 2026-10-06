import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleCreateSession, type SessionRow } from '../src/core/sessions/createSession.js';
import { derivedPublicIpByEssid } from '../src/core/logging/crossPlayerSourceIp.js';
import {
  handleAuthCreateSession,
  type AuthSessionRow,
} from '../src/core/sessions/authCreateSession.js';
import { handleAuthCreateSessionPublic } from '../src/core/sessions/authCreateSessionPublic.js';
import {
  handleExploitCreateSession,
  type ExploitSessionRow,
} from '../src/core/sessions/exploitCreateSession.js';
import { handleExploitLocalElevate } from '../src/core/sessions/exploitLocalElevate.js';
import {
  derivedNetworkByPublicIp,
  type NatOccupantRow,
} from '../src/core/network/resolvePublicTarget.js';
import {
  handleAuthCreateSessionSameLan,
  type OccupantConnectRow,
} from '../src/core/sessions/authCreateSessionSameLan.js';
import type { LanLeaseRow } from '../src/core/network/lanAddress.js';
import { handleAuthCreateSessionInnerGateway } from '../src/core/sessions/authCreateSessionInnerGateway.js';
import { handleHydraCrack } from '../src/core/sessions/hydraCrack.js';
// (hydraCrackPublic/hydraCrackInnerGateway folded into the single hydraCrack reach)
import { handleMysqlConnect } from '../src/core/sessions/mysqlConnect.js';
import { handleMysqlStatement } from '../src/core/sessions/mysqlStatement.js';
import { handleRedisConnect } from '../src/core/sessions/redisConnect.js';
import { handleRedisStatement } from '../src/core/sessions/redisStatement.js';
import { handleSnmpSet } from '../src/core/sessions/snmpSet.js';
import { handleSnmpWalk } from '../src/core/sessions/snmpWalk.js';
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs.js';
import {
  handleAuthElevateSession,
  type OccupantWorkstation,
  type SuSessionRow,
} from '../src/core/sessions/authElevateSession.js';
import {
  handleListSessions,
  type ListSessionsQuery,
  type SessionSummary,
} from '../src/core/sessions/listSessions.js';
import { handleEndSession, type EndSessionParams } from '../src/core/sessions/endSession.js';
import {
  handleRebootMachine,
  type EndMachineSessionsParams,
  type WriteBootIdParams,
} from '../src/core/sessions/rebootMachine.js';
import type {
  EndedSession,
  EndSessionsAboveParams,
  FindEndedSessionsQuery,
} from '../src/core/sessions/upstreamLost.js';
import {
  BOOT_ID_OWNER,
  BOOT_ID_PATH,
  BOOT_ID_PERMISSIONS,
} from '../src/core/boot/bootId.js';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess.js';
import type { UserType } from '../src/core/types.js';
import type {
  ListPathPatchesResult,
  PathPatchRow,
  PatchRow,
} from '../src/core/patches/upsertPatch.js';
import type { NonceStore } from '../src/core/signedRequest/nonceStore.js';

// Vercel adapter for POST /api/sessions.
//
// Nineteen signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe. They span session creation (own machine, own LAN, same
// LAN, cross-player public, inner gateway), the exploit door that asks for no
// credential at all, su elevation, the three credential sweeps (own LAN, public,
// deep), the database, store and agent conversations, and the two session reads.
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
type PersistedSessionRow = SessionRow | AuthSessionRow | SuSessionRow | ExploitSessionRow;

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

/** The write half of a system-written log append. The conflict target is named
 *  explicitly rather than left to PostgREST's primary-key default: `patches` is keyed on exactly
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

/** The caller's own home public IP — the truthful source address for a trace they leave
 *  from their own workstation, server-derived from their verified owner key and never the
 *  client's claimed `source_ip`. One player may carry rows for several APs they have
 *  joined; the most-recently-updated is their current network ("one network at a time").
 *  `owner_key` is not the PK, hence the order+limit. The occupancy names their network,
 *  and the network's address is its place in the world. */
const findHomeNetworkByOwnerKeyVia =
  ({
    supabase,
    occupancyLabel,
  }: {
    readonly supabase: SupabaseClient;
    readonly occupancyLabel: string;
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
    return derivedPublicIpByEssid(essid);
  };

/** Where the caller's OWN workstation stands: the network it currently occupies and the
 *  lease octet it holds there, both read by the verified owner key. The own-LAN login
 *  doors derive their vantage from this when the caller names no hop. One player may
 *  carry rows for several APs; the most-recently-updated is their current network ("one
 *  network at a time"). A `null` result means they occupy no network; a null octet means
 *  they occupy one but hold no lease, so the box they reach sees them as `unknown`. */
const findHomeVantageVia =
  ({ supabase, label }: QuerySpec) =>
  async (ownerKey: string) => {
    const occupancy = await supabase
      .from('home_network_occupants')
      .select('essid')
      .eq('owner_key', ownerKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (occupancy.error) {
      logFailure(`${label} occupancy`, occupancy.error);
      return { data: null, error: occupancy.error };
    }
    const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };

    const lease = await supabase
      .from('network_lan_leases')
      .select('octet')
      .eq('essid', essid)
      .eq('owner_key', ownerKey)
      .maybeSingle();
    if (lease.error) {
      logFailure(`${label} lease`, lease.error);
      return { data: null, error: lease.error };
    }
    const octet = (lease.data as { octet: number } | null)?.octet ?? null;
    return { data: { essid, octet }, error: null };
  };

/** The lease held on `essid` by whoever's workstation `machineId` is, read through their
 *  occupancy of that network — the address a box sees a caller arrive from when the
 *  caller is in a shell on that player's workstation. Null when no occupant of `essid`
 *  owns that box (an NPC box, or a player who has left), or they hold no lease. */
const findWorkstationLeaseVia =
  ({ supabase, label }: QuerySpec) =>
  async (essid: string, machineId: string) => {
    const occupant = await supabase
      .from('home_network_occupants')
      .select('owner_key')
      .eq('essid', essid)
      .eq('workstation_machine_id', machineId)
      .maybeSingle();
    if (occupant.error) {
      logFailure(`${label} workstation occupant`, occupant.error);
      return { data: null, error: occupant.error };
    }
    const ownerKey = (occupant.data as { owner_key: string } | null)?.owner_key ?? null;
    if (ownerKey === null) return { data: null, error: null };

    const lease = await supabase
      .from('network_lan_leases')
      .select('octet')
      .eq('essid', essid)
      .eq('owner_key', ownerKey)
      .maybeSingle();
    if (lease.error) {
      logFailure(`${label} workstation lease`, lease.error);
      return { data: null, error: lease.error };
    }
    return { data: (lease.data as { octet: number } | null)?.octet ?? null, error: null };
  };

/** One rung of a broken chain: close this player's open rows standing on any of
 *  `parent_ids`, answering with the ids it closed so the next rung can start there.
 *  Scoped to the player because every first hop names the same parent and a session
 *  id is whatever its client minted. */
const endSessionsAboveVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ player_key, parent_ids, reason }: EndSessionsAboveParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('player_key', player_key)
      .in('parent_session_id', [...parent_ids])
      .is('ended_at', null)
      .select('session_id');
    logFailure(label, error);
    const rows = data as readonly { session_id: string }[] | null;
    return { data: rows?.map((row) => row.session_id) ?? null, error };
  };

/** Which of `session_ids` name a row of this player's that has ended. */
const findEndedSessionsVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ player_key, session_ids }: FindEndedSessionsQuery) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('session_id')
      .eq('player_key', player_key)
      .in('session_id', [...session_ids])
      .not('ended_at', 'is', null);
    logFailure(label, error);
    const rows = data as readonly { session_id: string }[] | null;
    return { data: rows?.map((row) => row.session_id) ?? null, error };
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
          'session_id, machine_id, credentials, parent_session_id, source_ip, kind, created_at, essid',
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
      findEndedSessions: findEndedSessionsVia({ supabase, label: 'list ended parents' }),
      endSessionsAbove: endSessionsAboveVia({ supabase, label: 'list orphan cascade' }),
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
        .eq('player_key', player_key)
        // Only rows still open. A reboot ends the machine's rows FIRST and the
        // client then pops the hop chain it was holding, which sends an ordinary
        // exit for each — without this, those arrive late and rewrite `rebooted`
        // into `user_exit`, erasing the record that the player was thrown off.
        .is('ended_at', null);
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

  if (actionOf(req.body) === 'rebootMachine') {
    // Machine-scoped and nothing else: a reboot ends EVERY open row on that box —
    // the caller's, including ones no hop chain on their screen is standing on, and
    // every stranger's. The missing `player_key` filter is the feature. What keeps
    // it from being a weapon anyone can point anywhere is the handler's own
    // authority check, which runs before this is ever called.
    const endMachineSessions = async ({ machine_id, reason }: EndMachineSessionsParams) => {
      const { data, error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: reason })
        .eq('machine_id', machine_id)
        .is('ended_at', null)
        .select('session_id, player_key');
      logFailure('reboot', error);
      return { data: data as readonly EndedSession[] | null, error };
    };
    // The marker the box comes back carrying, and the only thing that can reach a
    // shell already standing on it. Written under the CALLER's writer key, which is
    // enough here for a reason worth writing down: the journal replays in
    // `updated_at` order and the last write to a path wins, so whoever rebooted most
    // recently is the id the box shows, whether or not they own it. That is exactly
    // the answer wanted. The stable-writer rule earns its keep where lines ACCRETE —
    // the kernel-log trace — not for a single value the newest reboot should replace.
    const writeBootId = async ({ machine_id, player_key, boot_id }: WriteBootIdParams) =>
      upsertPatchVia({ supabase, label: 'reboot boot-id upsert' })({
        writer_key: player_key,
        machine_id,
        path: BOOT_ID_PATH,
        content: `${boot_id}\n`,
        owner: BOOT_ID_OWNER,
        permissions: BOOT_ID_PERMISSIONS,
        node_type: 'file',
      });
    // Whose box went down — the row that decides which journal key the kernel log
    // accretes under. Occupancy is also what a `nmcli disconnect` removes, so a box
    // whose owner has gone dark answers nothing here and the line falls back to the
    // stable key the handler picks.
    const findOccupantWorkstationByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select('owner_key, workstation_username, workstation_root_hash')
        .eq('workstation_machine_id', machineId)
        .limit(1)
        .maybeSingle();
      logFailure('reboot occupant lookup', error);
      return { data: data as OccupantWorkstation | null, error };
    };
    const { status, body } = await handleRebootMachine(req.body, {
      nonceStore: noopNonceStore,
      // The authority for a box that is not the caller's own: their live row on it,
      // read at the tier the target granted. Same query the patch endpoints use.
      findActiveSession: findActiveSessionVia({ supabase, label: 'reboot active-session' }),
      endMachineSessions,
      endSessionsAbove: endSessionsAboveVia({ supabase, label: 'reboot cascade' }),
      writeBootId,
      // The trace the defender comes back to. Every lookup behind it is server-side:
      // whose log this is, which address ordered the reboot, and the clock it is
      // stamped with — none of it reported by the caller, because a log a visitor can
      // author is not evidence.
      now: () => Date.now(),
      findOccupantWorkstationByMachineId,
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'reboot trace occupancy',
      }),
      readLog: listPathPatchesVia({ supabase, label: 'reboot kern-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'reboot kern-log upsert' }),
      // Unguessable on purpose: a caller able to predict the next id could keep a
      // session alive across the reboot meant to end it.
      newBootId: () => randomUUID(),
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
      readAuthLog: listPathPatchesVia({ supabase, label: 'ssh auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'ssh auth-log upsert' }),
      // Where the caller stands — read off the hop they hold, or their own occupancy —
      // so the server names the network and the source address rather than trusting them.
      findActiveSession: findActiveSessionVia({ supabase, label: 'ssh vantage active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'ssh vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'ssh vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'exploitCreateSession') {
    // A CVE fired at a generated host on the caller's own LAN, at the layer behind an
    // inner gateway, or at a public address — which reaches the ACCESS POINT itself on a
    // port it serves, and the box of whoever leases the address behind one of its
    // forwards on a port it does not. No credential is sent or asked for: the handler
    // recomputes the game day from THIS clock, resolves the target through the same
    // resolver the login doors use, reads its manifest, and decides what is published
    // there and what it grants. The break-in lands in that daemon's own log on the
    // remote host, under the key that owns that machine's logs.
    const { status, body } = await handleExploitCreateSession(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      insertSession: insertSessionVia({ supabase, label: 'exploit insert' }),
      findPatches: findPatchesVia({ supabase, label: 'exploit boot-state lookup' }),
      readLog: listPathPatchesVia({ supabase, label: 'exploit trace read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'exploit trace upsert' }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'exploit lan-lease list' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'exploit occupant list',
      }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'exploit source-ip occupancy',
      }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'exploitLocalElevate') {
    // Cross-PLAYER `msfconsole --local`: B, standing on A's box, fires a library CVE on it
    // with NO password. Occupancy resolves A — its identity AND its reachability — while the
    // caller's OWN open session on that machine is the whole authorization (never a
    // credential). The handler regenerates A's real box (so A's `apt upgrade` history and any
    // tool B carried in both count), confirms the tool B ran is really there, recomputes the
    // winning library CVE from A's own manifest, applies the effect at the tier it grants,
    // and writes A's traces under A's own key. The shape of the occupant lookup mirrors
    // `suElevate` — one player on N APs has N rows with the same workstation id, so
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
      logFailure('local-exploit occupant lookup', error);
      return { data: data as OccupantWorkstation | null, error };
    };
    const { status, body } = await handleExploitLocalElevate(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findOccupantWorkstationByMachineId,
      findActiveSession: findActiveSessionVia({ supabase, label: 'local-exploit active-session' }),
      findPatches: findPatchesVia({ supabase, label: 'local-exploit boot-state lookup' }),
      insertSession: insertSessionVia({ supabase, label: 'local-exploit insert' }),
      readLog: listPathPatchesVia({ supabase, label: 'local-exploit trace read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'local-exploit trace upsert' }),
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
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPatches: findPatchesVia({ supabase, label: 'public auth boot-state lookup' }),
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'public auth occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'public auth lan-lease list' }),
      insertSession: insertSessionVia({ supabase, label: 'public auth insert' }),
      readAuthLog: listPathPatchesVia({ supabase, label: 'public auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'public auth-log upsert' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'public auth source-ip occupancy',
      }),
      // A door that names the box it was run from gets the honest address: the network
      // that box is on, which is what the target actually saw.
      findPublicIpByEssid: derivedPublicIpByEssid,
      findActiveSession: findActiveSessionVia({ supabase, label: 'public auth active-session' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionSameLan') {
    // Same-WiFi LAN ssh login: B reaches an occupant A's workstation DIRECTLY over the
    // shared LAN (no router/NAT). The handler places B on the LAN (home, or a box B is
    // in a shell on — the LAN-boundary gate), matches the LAN IP through the ESSID's
    // occupancy, materializes A's box, and validates the password server-side before
    // the insert runs. The trace on A's workstation is written under A's owner key,
    // source = where B stands on the LAN, server-derived.
    const { status, body } = await handleAuthCreateSessionSameLan(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession: findActiveSessionVia({ supabase, label: 'same-lan active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'same-lan vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'same-lan vantage' }),
      listOccupantsByEssid: listOccupantsByEssidVia<OccupantConnectRow>({
        supabase,
        label: 'same-lan occupants lookup',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'same-lan lan-lease list' }),
      findPatches: findPatchesVia({ supabase, label: 'same-lan boot-state lookup' }),
      insertSession: insertSessionVia({ supabase, label: 'same-lan auth insert' }),
      readAuthLog: listPathPatchesVia({ supabase, label: 'same-lan auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'same-lan auth-log upsert' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionInnerGateway') {
    // ssh THROUGH a NAT forward on an inner gateway onto a deep Layer-2 host. The
    // handler places the caller first — at home, or in a shell on a box they name — and
    // refuses a network they are not standing on. It then regenerates the gateway from
    // the essid, replays its journal (to read the forward + boot state), and routes the
    // forwarded port to the deep NPC, validating the password against ITS /etc/passwd.
    // The trace accretes under the network's own key: these boxes are ESSID-shared.
    const { status, body } = await handleAuthCreateSessionInnerGateway(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession: findActiveSessionVia({ supabase, label: 'inner-gateway active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'inner-gateway vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'inner-gateway vantage' }),
      findPatches: findPatchesVia({ supabase, label: 'inner-gateway boot-state lookup' }),
      insertSession: insertSessionVia({
        supabase,
        label: 'inner-gateway auth insert',
      }),
      readAuthLog: listPathPatchesVia({ supabase, label: 'inner-gateway auth-log read' }),
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
      readMysqlLog: listPathPatchesVia({ supabase, label: 'mysql log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'mysql log upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'mysql connect occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'mysql connect lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'mysql connect source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'mysql connect active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'mysql connect vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'mysql connect vantage' }),
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
      readMysqlLog: listPathPatchesVia({ supabase, label: 'mysql statement log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'mysql datadir + log upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'mysql statement occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'mysql statement lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'mysql statement source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'mysql statement active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'mysql statement vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'mysql statement vantage' }),
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
      readRedisLog: listPathPatchesVia({ supabase, label: 'redis log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'redis log upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'redis connect occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'redis connect lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'redis connect source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'redis connect active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'redis connect vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'redis connect vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'snmpWalk') {
    // Reading a network device. NO account is named and NO session row is created:
    // an agent answers to a community string, which belongs to the device rather than
    // to a person, and a row minted here would hand `listPatches` and `upsertPatch` to
    // anyone who can reach 161.
    //
    // The handler READS the target's journal (whether its agent is actually up) and
    // its `/etc/snmp/snmpd.conf`, then WRITES two lines to its own
    // /var/log/snmpd.log — an arrival and a verdict, in one append. Both are written
    // whether or not the community was accepted: this log is the ONLY tell a device's
    // owner ever gets, because a walk costs no login and leaves no session.
    //
    // A refused community comes back as `host_unreachable`, word for word what an
    // absent device returns. Told apart, a sweep could sort devices into
    // worth-cracking and not before spending one word of a wordlist.
    const { status, body } = await handleSnmpWalk(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'snmp target journal lookup' }),
      readSnmpdLog: listPathPatchesVia({ supabase, label: 'snmpd log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'snmpd log upsert' }),
      findPublicIpByEssid: derivedPublicIpByEssid,
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'snmp walk occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'snmp walk lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'snmp walk source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'snmp walk active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'snmp walk vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'snmp walk vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'snmpSet') {
    // WRITING to a network device. Same door as the walk and the same absence of a
    // session: the community is re-read and re-judged here, on this request, so
    // `systemctl stop snmpd` shuts the door with nothing to invalidate.
    //
    // The handler READS the target's journal — its agent's state file, and the
    // `rules.v4` or `acl.conf` it actually routes by — and WRITES for two: the port
    // table with one line changed in it, and the device's own /var/log/snmpd.log. That
    // second write is the only tell the owner gets, because nothing else about this
    // request leaves a mark anywhere.
    //
    // The port table is edited as TEXT and stored back under the DEVICE's writer key,
    // so the file stays the one file the scan path and the ssh router already read, and
    // a box keeps one table however many callers set on it.
    //
    // A refused community comes back as `host_unreachable`, word for word what an
    // absent device returns. A refusal AFTER the community was accepted comes back as a
    // 200 carrying the agent's reason: the caller proved the string, so silence there
    // would leave them unable to tell a bad value from a working one.
    const { status, body } = await handleSnmpSet(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'snmp set target journal lookup' }),
      readSnmpdLog: listPathPatchesVia({ supabase, label: 'snmpd set log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'snmpd set upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'snmp set occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'snmp set lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'snmp set source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'snmp set active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'snmp set vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'snmp set vantage' }),
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
      readRedisLog: listPathPatchesVia({ supabase, label: 'redis statement log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'redis statement upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'redis statement occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'redis statement lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'redis statement source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'redis statement active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'redis statement vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'redis statement vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'hydraCrack') {
    // Credential sweep against any reachable box: a generated sibling or a FELLOW
    // OCCUPANT on the caller's own LAN, a box on a deep layer behind one of their
    // gateways, or whatever answers behind a PUBLIC access point — the one door resolves
    // every target through the SAME reach `ssh` and the data doors use, so a password
    // this reports is one `ssh` then accepts and a box dark to one tool is dark to all.
    // No session is created. The handler READS the target's journal (its real passwd and
    // what it is actually running) and the caller's own wordlist patch — the wordlist
    // exists solely as a patch (apt wrote it; no base FS carries it), so that one row IS
    // the file, and reading it beats trusting a list the client could have posted. The
    // one WRITE is the trace it leaves on whichever box was reached, under the key that
    // owns THAT machine's logs, at the server-derived address of the network the caller
    // is STANDING on rather than anything the client claimed.
    const { status, body } = await handleHydraCrack(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches: findPatchesVia({ supabase, label: 'hydra target journal lookup' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'hydra wordlist read' }),
      readAuthLog: listPathPatchesVia({ supabase, label: 'hydra auth-log read' }),
      upsertPatch: upsertPatchVia({ supabase, label: 'hydra auth-log upsert' }),
      findNetworkByPublicIp: derivedNetworkByPublicIp,
      findPublicIpByEssid: derivedPublicIpByEssid,
      listOccupantsByEssid: listOccupantsByEssidVia<NatOccupantRow>({
        supabase,
        label: 'hydra occupant list',
      }),
      listLeasesByEssid: listLeasesByEssidVia({ supabase, label: 'hydra lan-lease list' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({
        supabase,
        occupancyLabel: 'hydra source-ip occupancy',
      }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'hydra active-session lookup' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'hydra vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'hydra vantage' }),
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
      readAuthLog: listPathPatchesVia({ supabase, label: 'su auth-log read' }),
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
