import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleCreateSession, type SessionRow } from '../src/core/sessions/createSession';
import {
  handleAuthCreateSession,
  type AuthSessionRow,
} from '../src/core/sessions/authCreateSession';
import {
  handleAuthCreateSessionPublic,
  type RegistryTarget,
} from '../src/core/sessions/authCreateSessionPublic';
import {
  handleAuthCreateSessionSameLan,
  type OccupantConnectRow,
} from '../src/core/sessions/authCreateSessionSameLan';
import { handleAuthCreateSessionInnerGateway } from '../src/core/sessions/authCreateSessionInnerGateway';
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs';
import {
  handleAuthElevateSession,
  type RegistryWorkstation,
  type SuSessionRow,
} from '../src/core/sessions/authElevateSession';
import {
  handleListSessions,
  type ListSessionsQuery,
  type SessionSummary,
} from '../src/core/sessions/listSessions';
import { handleEndSession, type EndSessionParams } from '../src/core/sessions/endSession';
import type { MachineLogReadQuery } from '../src/core/patches/appendMachineLog';
import type { PatchRow } from '../src/core/patches/upsertPatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/sessions.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe:
//   - createSession: persist a pushed shell session (own-workstation gated)
//   - listSessions:  read the caller's OWN active sessions to rebuild the hop
//     chain on boot
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
      if (error) console.error('[sessions] list error:', error);
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
    const endSession = async ({ session_id, player_key }: EndSessionParams) => {
      const { error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: 'user_exit' })
        .eq('session_id', session_id)
        .eq('player_key', player_key);
      if (error) console.error('[sessions] end error:', error);
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
    // Cross-machine ssh session: the handler regenerates the remote FS and
    // validates the password server-side before this insert ever runs.
    const insertSession = async (row: AuthSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] auth insert error:', error);
      return { error };
    };
    // The system-written sshd auth.log line on the REMOTE host: read the current
    // content + upsert the appended line (read-modify-write, bypassing L1/L2 —
    // the service logs it, not the player). Same `patches`-table shapes as the su
    // appender in /api/patches.
    const readAuthLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[sessions] ssh auth-log read error:', error);
      return { data, error };
    };
    const upsertPatch = async (row: PatchRow) => {
      const { error } = await supabase.from('patches').upsert(row);
      if (error) console.error('[sessions] ssh auth-log upsert error:', error);
      return { error };
    };
    // The target host's shared journal, replayed over its seeded base so the login
    // sees the box's REAL state — a `/boot` tombstone means a bricked host is dark
    // from inside the LAN too, not just from the WAN.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[sessions] own-lan boot-state lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleAuthCreateSession(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      insertSession,
      findPatches,
      readAuthLog,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionPublic') {
    // Cross-PLAYER ssh login (Story 5.1.2): resolve the target PUBLIC IP in the
    // registry, then the handler materializes the owner's ROUTER and routes by
    // destination port — port 22 lands on the router itself (validated against its
    // seeded admin password). Story 6.2: a reachable attempt now leaves an auth.log
    // trace on the owner's shared record (router or workstation behind the NAT),
    // written under the OWNER's writer_key so multi-attacker rows don't collide.
    const findRegistryByPublicIp = async (publicIp: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select(
          'owner_key, router_machine_id, essid, workstation_machine_id, workstation_username, workstation_machine_name, workstation_root_hash',
        )
        .eq('public_ip', publicIp)
        .maybeSingle();
      if (error) console.error('[sessions] registry lookup error:', error);
      return { data: data as RegistryTarget | null, error };
    };
    const insertSessionPublic = async (row: AuthSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] public auth insert error:', error);
      return { error };
    };
    // The target's FULL journal (scoped to machine_id, server order) so the gate can
    // materialize A's box and refuse a login to a bricked (dark) machine before the
    // password is ever checked.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[sessions] public auth boot-state lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    // The system-written sshd auth.log line on the TARGET machine (router or the
    // workstation behind the NAT): read the current content + upsert the appended
    // line (read-modify-write, bypassing L1/L2 — the service logs it, not the
    // player). Same `patches`-table shapes as the own-LAN ssh appender above; the
    // line is written under the OWNER's writer_key (decision 1).
    const readAuthLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[sessions] public auth-log read error:', error);
      return { data, error };
    };
    const upsertPatchPublic = async (row: PatchRow) => {
      const { error } = await supabase
        .from('patches')
        .upsert(row, { onConflict: 'machine_id,path,writer_key' });
      if (error) console.error('[sessions] public auth-log upsert error:', error);
      return { error };
    };
    // The ATTACKER's own home public IP — the truthful source IP, server-derived from
    // their verified owner key (never the client `source_ip`). One player may carry
    // rows for several APs they've joined; the most-recently-updated is their current
    // network ("one network at a time"). owner_key is not the PK, hence the order+limit.
    const findRegistryByOwnerKey = async (ownerKey: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select('public_ip')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.error('[sessions] public auth source-ip lookup error:', error);
      return { data: data as { public_ip: string } | null, error };
    };
    const { status, body } = await handleAuthCreateSessionPublic(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByPublicIp,
      findPatches,
      insertSession: insertSessionPublic,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch: upsertPatchPublic,
      findRegistryByOwnerKey,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionSameLan') {
    // Same-WiFi LAN ssh login: B reaches a fellow occupant A's workstation DIRECTLY
    // over the shared LAN (no router/NAT). The handler reads the ESSID's occupancy
    // (the LAN-boundary gate + LAN-IP match), materializes A's box, and validates the
    // password server-side before this insert runs.
    const listOccupantsByEssid = async (essid: string) => {
      // The auth projection (root hash + username) — server-internal, never sent to a
      // client. Distinct from the lean `resolveOccupants` read, which omits the hash.
      // `workstation_machine_name` is the hostname the auth.log trace line carries.
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, workstation_machine_name, workstation_username, workstation_root_hash',
        )
        .eq('essid', essid);
      if (error) console.error('[sessions] same-lan occupants lookup error:', error);
      return { data: data as readonly OccupantConnectRow[] | null, error };
    };
    // A's workstation FULL journal (scoped to machine_id, server order) so the gate can
    // materialize A's box — refusing a bricked (dark) or non-listening target before the
    // password is ever checked.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[sessions] same-lan boot-state lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const insertSession = async (row: AuthSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] same-lan auth insert error:', error);
      return { error };
    };
    // The login attempt's auth.log trace on A's workstation: read the current content +
    // upsert the appended line (read-modify-write, bypassing L1/L2 — sshd logs it, not
    // the player). Same `patches`-table shapes as the public appender; written under
    // A's owner writer_key (the keystone), source = B's server-derived LAN IP.
    const readAuthLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[sessions] same-lan auth-log read error:', error);
      return { data, error };
    };
    const upsertSameLanAuthLog = async (row: PatchRow) => {
      const { error } = await supabase
        .from('patches')
        .upsert(row, { onConflict: 'machine_id,path,writer_key' });
      if (error) console.error('[sessions] same-lan auth-log upsert error:', error);
      return { error };
    };
    const { status, body } = await handleAuthCreateSessionSameLan(req.body, {
      nonceStore: noopNonceStore,
      listOccupantsByEssid,
      findPatches,
      insertSession,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch: upsertSameLanAuthLog,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSessionInnerGateway') {
    // ssh THROUGH a NAT forward on the player's OWN inner gateway onto a deep Layer-2
    // host. The handler regenerates the gateway from the verified key + essid, replays
    // its journal (to read the forward + boot state), and routes the forwarded port to
    // the deep NPC — validating the password against ITS /etc/passwd before this insert.
    // Own-keyed + private: no registry, no occupancy, no trace.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[sessions] inner-gateway boot-state lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const insertSession = async (row: AuthSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] inner-gateway auth insert error:', error);
      return { error };
    };
    // The system-written sshd auth.log line on the landed DEEP box: read the current
    // content + upsert the appended line (read-modify-write, bypassing L1/L2 — the
    // service logs it, not the player). Written under the CALLER's OWN writer_key —
    // deep boxes are private per-viewer NPCs, so the trace accretes under the player who
    // reads it back. Same `patches`-table shapes as the public/same-lan appenders.
    const readAuthLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[sessions] inner-gateway auth-log read error:', error);
      return { data, error };
    };
    const upsertInnerGatewayAuthLog = async (row: PatchRow) => {
      const { error } = await supabase
        .from('patches')
        .upsert(row, { onConflict: 'machine_id,path,writer_key' });
      if (error) console.error('[sessions] inner-gateway auth-log upsert error:', error);
      return { error };
    };
    const { status, body } = await handleAuthCreateSessionInnerGateway(req.body, {
      nonceStore: noopNonceStore,
      findPatches,
      insertSession,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch: upsertInnerGatewayAuthLog,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'suElevate') {
    // Cross-PLAYER su-to-root: B (already ssh'd into A) escalates. Resolve A's
    // registered workstation by the machine_id B is standing on, then the handler
    // rebuilds A's box from the persisted identity and validates the typed password
    // before this insert runs (a root-tier `kind:'su'` row that makes B's later
    // writes authorize at root). Story 6.3: a resolved attempt now leaves a su
    // auth.log trace on A's shared workstation record, under the OWNER's writer_key.
    const findRegistryByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select(
          'owner_key, workstation_machine_id, essid, workstation_username, workstation_machine_name, workstation_root_hash',
        )
        .eq('workstation_machine_id', machineId)
        .maybeSingle();
      if (error) console.error('[sessions] su-elevate registry lookup error:', error);
      return { data: data as RegistryWorkstation | null, error };
    };
    // Same-LAN fallback: the WAN registry's PK is the ESSID-shared public_ip
    // (last-writer-wins), so a fellow occupant who joined a shared AP before a later
    // joiner is no longer in network_registry — but is still in home_network_occupants
    // (PK (essid, owner_key)), which carries the same identity fields su needs. One
    // player on N APs has N rows with the SAME workstation_machine_id, so `.limit(1)`.
    const findOccupantWorkstationByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, essid, workstation_username, workstation_machine_name, workstation_root_hash',
        )
        .eq('workstation_machine_id', machineId)
        .limit(1)
        .maybeSingle();
      if (error) console.error('[sessions] su-elevate occupant lookup error:', error);
      return { data: data as RegistryWorkstation | null, error };
    };
    const insertSuSession = async (row: SuSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] su-elevate insert error:', error);
      return { error };
    };
    // The system-written su auth.log line on A's WORKSTATION: read the current content
    // + upsert the appended line (read-modify-write, bypassing L1/L2 — su logs it as
    // the system, not the player). Same `patches`-table shapes + owner-keyed writer as
    // the cross-player ssh appender above; the line is written under the OWNER's
    // writer_key (decision 1).
    const readAuthLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[sessions] su auth-log read error:', error);
      return { data, error };
    };
    const upsertSuAuthLog = async (row: PatchRow) => {
      const { error } = await supabase
        .from('patches')
        .upsert(row, { onConflict: 'machine_id,path,writer_key' });
      if (error) console.error('[sessions] su auth-log upsert error:', error);
      return { error };
    };
    const { status, body } = await handleAuthElevateSession(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByMachineId,
      findOccupantWorkstationByMachineId,
      insertSession: insertSuSession,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch: upsertSuAuthLog,
    });
    res.status(status).json(body);
    return;
  }

  const insertSession = async (row: SessionRow) => {
    const { error } = await supabase.from('sessions').insert(row);
    if (error) console.error('[sessions] insert error:', error);
    return { error };
  };
  const { status, body } = await handleCreateSession(req.body, {
    nonceStore: noopNonceStore,
    insertSession,
  });
  res.status(status).json(body);
}
