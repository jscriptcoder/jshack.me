import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
} from '../src/core/network/registerNetwork';
import { handleResolveOccupants, type OccupantListRow } from '../src/core/network/resolveOccupants';
import type { LanLeaseRow } from '../src/core/network/lanAddress';
import {
  handleResolveOccupiedEssids,
  type OccupiedEssidRow,
} from '../src/core/network/resolveOccupiedEssids';
import { handleUnregisterOccupant } from '../src/core/network/unregisterOccupant';
import {
  handleResolvePublicScan,
  type NatOccupantRow,
  type ApNetworkLookup,
} from '../src/core/scan/resolvePublicScan';
import {
  handleResolveHttpFetch,
  type ApNetworkLookup as HttpApNetworkLookup,
  type HttpFetchOccupant,
  type WebTargetDeps,
} from '../src/core/network/resolveHttpFetch';
import { handleResolveHttpSweep } from '../src/core/network/resolveHttpSweep';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess';
import { computeApGatewayId } from '../src/core/identity/router';
import { handleResolveInnerGatewayScan } from '../src/core/scan/resolveInnerGatewayScan';
import type { OwnerPatchRow as MachinePatchRow } from '../src/core/network/materializeMachineFs';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OwnerPatchRow,
  type OccupantWorkstation,
} from '../src/core/network/resolveCrossPlayerFs';
import type { UserType } from '../src/core/types';
import type { MachineLogReadQuery } from '../src/core/patches/appendMachineLog';
import type {
  ListPathPatchesResult,
  PatchRow,
  PathPatchRow,
} from '../src/core/patches/upsertPatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';
import { allocatePublicIp } from '../src/core/network/allocatePublicIp';
import { allocateLanLease, drawLanOctet } from '../src/core/network/allocateLanLease';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generatePublicIp } from '../src/core/generation/ip';
import { createPrng } from '../src/core/generation/prng';
import { randomUUID } from 'node:crypto';

// Vercel adapter for POST /api/network — joining an AP, and reaching what is on it.
//
// Every signed action shares this endpoint, routed on the (unverified) payload
// `action`; each handler re-verifies the envelope itself, so routing on the raw
// action is safe. `registerNetwork` is the fallthrough. The two that define the
// shape of the rest:
//   - registerNetwork: allocate the ESSID's public IP and the caller's LAN lease,
//     then record the caller as an occupant (owner_key server-stamped)
//   - resolvePublicScan: resolve a DIFFERENT identity's nmap of a public IP to the
//     AP's GATEWAY (a distinct ESSID-seeded machine bearing that IP) — host up/down
//     + its open ports (its seeded sshd:22, read off the materialized tree)
//
// Logic lives in core/ handlers (unit + mutation tested); this file stays a thin
// Supabase adapter. It's typechecked via tsconfig.node.json (`npm run typecheck`),
// but its runtime correctness (column names, constraints) is only proven by the
// wire-check scripts against a live endpoint.
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands with
// cross-player writes, Story 3). Same posture as /api/patches and /api/sessions.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

type QuerySpec = {
  readonly supabase: SupabaseClient;
  readonly label: string;
};

const logFailure = (label: string, error: unknown) => {
  if (error) console.error(`[network] ${label} error:`, error);
};

/**
 * Finding the box behind a public address and a port — the reads shared by every web
 * tool that reaches across networks. One definition at the adapter as well as in core:
 * a fetch and a path sweep must resolve the same box from the same journal in the same
 * order, or the two would disagree about what is even there.
 */
const webTargetDepsVia = ({ supabase, label }: QuerySpec): WebTargetDeps => ({
  findNetworkByPublicIp: async (publicIp: string) => {
    const network = await supabase
      .from('network_public_ips')
      .select('essid')
      .eq('public_ip', publicIp)
      .maybeSingle();
    if (network.error) {
      logFailure(`${label} public-ip lookup`, network.error);
      return { data: null, error: network.error };
    }
    const essid = (network.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };
    const resolved: HttpApNetworkLookup = { router_machine_id: computeApGatewayId(essid), essid };
    return { data: resolved, error: null };
  },
  // Per-machine journal: the gateway's (boot state + the live forward table), then the
  // reached box's (its running services and the pages themselves).
  findPatches: async ({ machine_id }: { machine_id: string }) => {
    const { data, error } = await supabase
      .from('patches')
      .select('path, content, owner, permissions, node_type, updated_at, writer_key')
      .eq('machine_id', machine_id)
      .order('updated_at', { ascending: true })
      .order('writer_key', { ascending: true });
    logFailure(`${label} journal lookup`, error);
    return { data: data as readonly OwnerPatchRow[] | null, error };
  },
  // Who a forward can reach: every occupant currently ON the ESSID, with the identity
  // fields that rebuild each box from its OWNER's identity.
  listOccupantsByEssid: async (essid: string) => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .select('owner_key, workstation_machine_id, workstation_username, workstation_root_hash')
      .eq('essid', essid);
    logFailure(`${label} occupant list`, error);
    return { data: data as readonly HttpFetchOccupant[] | null, error };
  },
  listLeasesByEssid: async (essid: string) => {
    const { data, error } = await supabase
      .from('network_lan_leases')
      .select('owner_key, octet')
      .eq('essid', essid);
    logFailure(`${label} lan-lease list`, error);
    return { data: data as readonly LanLeaseRow[] | null, error };
  },
});

/** The target's own access log, read and written under the TARGET OWNER's key — the
 *  same key both sides use, or the read-modify-write would fork the file per visitor. */
const accessLogWriterVia = ({ supabase, label }: QuerySpec) => ({
  readLog: async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
    const { data, error } = await supabase
      .from('patches')
      .select('content')
      .eq('writer_key', writer_key)
      .eq('machine_id', machine_id)
      .eq('path', path)
      .maybeSingle();
    logFailure(`${label} access-log read`, error);
    return { data: data as { content: string | null } | null, error };
  },
  upsertPatch: async (row: PatchRow) => {
    const { error } = await supabase
      .from('patches')
      .upsert(row, { onConflict: 'machine_id,path,writer_key' });
    logFailure(`${label} access-log upsert`, error);
    return { error };
  },
});

const findPublicIpByEssidVia =
  ({ supabase, label }: QuerySpec) =>
  async (essid: string) => {
    const { data, error } = await supabase
      .from('network_public_ips')
      .select('public_ip')
      .eq('essid', essid)
      .maybeSingle();
    logFailure(`${label} essid public-ip lookup`, error);
    return { data: data as { public_ip: string } | null, error };
  };

/** The REQUESTER's own home public IP — the truthful source IP, server-derived from
 *  their verified key. One player may carry rows for several APs they have joined; the
 *  most-recently-updated is their current network ("one network at a time"), and a
 *  disconnected player's source degrades to `unknown` rather than being taken from the
 *  client. */
const findHomeNetworkByOwnerKeyVia =
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
      logFailure(`${label} source-ip occupancy`, occupancy.error);
      return { data: null, error: occupancy.error };
    }
    const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };
    return findPublicIpByEssidVia({ supabase, label })(essid);
  };

/** Whether the caller is really present on the machine they named — the ssh hop they
 *  are standing on, which is also what says whose network their attack came from. */
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
    logFailure(`${label} active-session lookup`, error);
    if (data === null) return { data: null, error };
    const row = data as { credentials: { userType: UserType }; essid: string };
    return { data: { userType: row.credentials.userType, essid: row.essid }, error };
  };

/** Every writer's rows at one path on one machine — a file belongs to the box, not to
 *  whoever wrote it last. */
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
    logFailure(`${label} path read`, error);
    return { data: data as readonly PathPatchRow[] | null, error };
  };

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

  if (actionOf(req.body) === 'resolvePublicScan') {
    // Resolve the TARGET public IP (another identity's network) — no caller
    // scoping: any authenticated player may scan any public IP, like the internet.
    // A public IP belongs to the ESSID's shared GATEWAY, a distinct machine whose id
    // derives from the ESSID: its journal drives the boot-state check, its own sshd:22,
    // and the forward table the handler liveness-gates each occupant's box against.
    const findNetworkByPublicIp = async (publicIp: string) => {
      const network = await supabase
        .from('network_public_ips')
        .select('essid')
        .eq('public_ip', publicIp)
        .maybeSingle();
      if (network.error) {
        console.error('[network] public-ip lookup error:', network.error);
        return { data: null, error: network.error };
      }
      const essid = (network.data as { essid: string } | null)?.essid ?? null;
      if (essid === null) return { data: null, error: null };
      // The AP itself always answers: a gateway is the access point's own infrastructure,
      // not a machine that joins the network, so it exists whether or not anyone is on it.
      const resolved: ApNetworkLookup = {
        router_machine_id: computeApGatewayId(essid),
        essid,
      };
      return { data: resolved, error: null };
    };
    // The resolved ROUTER's FULL journal (scoped to router_machine_id, server order)
    // so the handler can replay it over the seeded router base — to ask `canBoot`
    // (a `/boot` tombstone takes the public IP dark) and to read its open ports off
    // the materialized tree. The router's own sshd:22 lives in its seeded base FS,
    // so a fresh router needs no journal row to advertise a port.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[network] scan boot-state lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    // Story 6.1: a host-up cross-player scan leaves a kern.log trace on the TARGET
    // router's shared record. readLog/upsertPatch are the same read-modify-write
    // `patches` shapes the ssh/su auth.log appenders use; the line is written under
    // the OWNER's writer_key (decision 1) so multi-scanner rows don't collide.
    const readLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[network] scan kern-log read error:', error);
      return { data, error };
    };
    const upsertPatch = async (row: PatchRow) => {
      const { error } = await supabase
        .from('patches')
        .upsert(row, { onConflict: 'machine_id,path,writer_key' });
      if (error) console.error('[network] scan kern-log upsert error:', error);
      return { error };
    };
    // The SCANNER's own home public IP — the truthful source IP, server-derived from
    // their verified owner key (never the client `source_ip`). Read from occupancy, so
    // the address they scan from is a network they are actually ON: a player who has
    // disconnected has no home network and their source degrades to `unknown`. One
    // player may occupy several APs; the most-recently-joined is their current network
    // ("one network at a time"), hence the order+limit.
    const findHomeNetworkByOwnerKey = async (ownerKey: string) => {
      const occupancy = await supabase
        .from('home_network_occupants')
        .select('essid')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (occupancy.error) {
        console.error('[network] scanner source-ip occupancy error:', occupancy.error);
        return { data: null, error: occupancy.error };
      }
      const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
      if (essid === null) return { data: null, error: null };
      const { data, error } = await supabase
        .from('network_public_ips')
        .select('public_ip')
        .eq('essid', essid)
        .maybeSingle();
      if (error) console.error('[network] scanner source-ip lookup error:', error);
      return { data: data as { public_ip: string } | null, error };
    };
    // Who a forward can reach: every occupant currently ON the ESSID, with the identity
    // fields that rebuild each box. Occupancy is also the reachability test — a machine
    // whose owner ran `nmcli disconnect` has no row, so no forward reaches it.
    const listOccupantsByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select('owner_key, workstation_machine_id, workstation_username, workstation_root_hash')
        .eq('essid', essid);
      if (error) console.error('[network] scan occupant list error:', error);
      return { data: data as readonly NatOccupantRow[] | null, error };
    };
    // Every lease on the ESSID in ONE read — where each occupant answers, so a forward
    // is live only when it names the same address the same-LAN path reaches that box at.
    const listLeasesByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('network_lan_leases')
        .select('owner_key, octet')
        .eq('essid', essid);
      if (error) console.error('[network] scan lan-lease list error:', error);
      return { data: data as readonly LanLeaseRow[] | null, error };
    };
    const { status, body } = await handleResolvePublicScan(req.body, {
      nonceStore: noopNonceStore,
      findNetworkByPublicIp,
      findPatches,
      listOccupantsByEssid,
      listLeasesByEssid,
      now: () => Date.now(),
      readLog,
      upsertPatch,
      findHomeNetworkByOwnerKey,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveHttpFetch') {
    // Cross-player web FETCH: the caller holds no session and offers no credential —
    // a web server publishes its document root to anyone who can reach the port, so
    // reachability is the whole gate. Same resolution chain as the public scan/ssh
    // (public IP → ESSID → gateway → forward → the occupant leasing that address), so
    // the three can never disagree about which box answers a port. Only the file's
    // CONTENT crosses back, and which file that is was decided server-side.
    const { status, body } = await handleResolveHttpFetch(req.body, {
      nonceStore: noopNonceStore,
      ...webTargetDepsVia({ supabase, label: 'http-fetch' }),
      now: () => Date.now(),
      ...accessLogWriterVia({ supabase, label: 'http-fetch' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({ supabase, label: 'http-fetch' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveHttpSweep') {
    // Cross-player path SWEEP: the same door a fetch enters (so neither can reach a box
    // the other could not), plus the two things that make it a sweep. The path list is
    // read off the machine the caller is standing on rather than sent, so a request can
    // only ask with words the player really grew; and every path it asked about lands on
    // the target as ONE append, because the wall of 404s under a single stamp is the
    // defender's whole tell. Sizes come back, never pages.
    const { status, body } = await handleResolveHttpSweep(req.body, {
      nonceStore: noopNonceStore,
      ...webTargetDepsVia({ supabase, label: 'http-sweep' }),
      now: () => Date.now(),
      ...accessLogWriterVia({ supabase, label: 'http-sweep' }),
      findHomeNetworkByOwnerKey: findHomeNetworkByOwnerKeyVia({ supabase, label: 'http-sweep' }),
      // A sweep launched from a box the caller only holds a session on is traced to THAT
      // network — the box that was actually used, not the attacker's home.
      findPublicIpByEssid: findPublicIpByEssidVia({ supabase, label: 'http-sweep' }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'http-sweep' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'http-sweep' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveInnerGatewayScan') {
    // The player's OWN-LAN nmap of an inner gateway, resolved at the external vantage
    // so a NAT forward to the deep layer is visible. The forward lives on the gateway's
    // server-side journal, so read its patch rows (scoped to machine_id, server order)
    // to replay over the seeded gateway base — for `canBoot` + the live `rules.v4`. No
    // occupancy lookup: the gateway is seeded from the ESSID, not owned by a player.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[network] inner-gateway scan lookup error:', error);
      return { data: data as readonly MachinePatchRow[] | null, error };
    };
    const { status, body } = await handleResolveInnerGatewayScan(req.body, {
      nonceStore: noopNonceStore,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveCrossPlayerFs') {
    // Cross-player READ: the caller (B) holds an active session on ANOTHER identity's
    // (A's) machine and fetches A's filtered FS. Whose box it is comes from occupancy —
    // which doubles as the reachability test, since a row there means "this machine is
    // on that WiFi". One player on N APs has N rows with the SAME workstation_machine_id
    // (identity-derived) + identical identity fields, so `.limit(1)` picks any. The
    // selected columns are exactly OccupantWorkstation. An AP GATEWAY has no occupancy
    // row at all — it belongs to the access point, not to a player — so the handler
    // identifies it from the caller's own session instead.
    const findOccupantWorkstationByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select('owner_key, workstation_username, workstation_root_hash')
        .eq('workstation_machine_id', machineId)
        .limit(1)
        .maybeSingle();
      if (error) console.error('[network] occupant reverse-lookup error:', error);
      const occupant = data as {
        owner_key: string;
        workstation_username: string;
        workstation_root_hash: string;
      } | null;
      return {
        data:
          occupant === null ? null : ({ kind: 'workstation', ...occupant } as OccupantWorkstation),
        error,
      };
    };
    // The caller's active (un-ended) session on the target — the SERVER source of the
    // read tier, scoped to the verified player_key the handler supplies. The row's
    // `essid` comes along because it is what identifies an AP GATEWAY: a gateway has no
    // occupancy row, and holding a session on one means you logged into it, so the
    // session records which access point it is. Null on rows predating the column.
    const findActiveSession = async ({
      player_key,
      machine_id,
    }: {
      player_key: string;
      machine_id: string;
    }) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('credentials, essid')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
        .is('ended_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.error('[network] session lookup error:', error);
      const session = data as {
        credentials: { userType: UserType };
        essid: string | null;
      } | null;
      return {
        data:
          session === null
            ? null
            : ({ userType: session.credentials.userType, essid: session.essid } as ActiveSession),
        error,
      };
    };
    // The machine's patch rows on the target (the shared journal — every writer's
    // rows, scoped to machine_id), with the SERVER updated_at + writer_key so the
    // handler replays them chronologically over the regenerated baseline to
    // materialize A's real box.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[network] owner patches lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleResolveCrossPlayerFs(req.body, {
      nonceStore: noopNonceStore,
      findOccupantWorkstationByMachineId,
      findActiveSession,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupants') {
    // Same-LAN occupant enumeration (Story 7): a verified occupant of the ESSID asks
    // who else is on its LAN. Gated server-side on the caller's own live occupancy row
    // (decision D11 — you must be ON the LAN to enumerate it). The composite PK's
    // leading `essid` column serves this `... WHERE essid = $1` read.
    const listOccupantsByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select('owner_key, workstation_machine_id, workstation_machine_name')
        .eq('essid', essid);
      if (error) console.error('[network] occupant list error:', error);
      return { data: data as readonly OccupantListRow[] | null, error };
    };
    // Every lease on the ESSID in ONE read — each occupant's address of record.
    const listLeasesByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('network_lan_leases')
        .select('owner_key, octet')
        .eq('essid', essid);
      if (error) console.error('[network] lan-lease list error:', error);
      return { data: data as readonly LanLeaseRow[] | null, error };
    };
    const { status, body } = await handleResolveOccupants(req.body, {
      nonceStore: noopNonceStore,
      listOccupantsByEssid,
      listLeasesByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupiedEssids') {
    // Organic-discovery read (Story 7): any verified identity asks which ESSIDs are
    // currently occupied, so airdump can inject them for discovery. UNGATED (you learn
    // a network exists before joining it) and NAME-ONLY — only the essid column is
    // selected, so no occupant identity crosses the wire. The handler de-duplicates
    // names (several players can occupy one ESSID).
    const listAllOccupiedEssids = async () => {
      const { data, error } = await supabase.from('home_network_occupants').select('essid');
      if (error) console.error('[network] occupied-essid list error:', error);
      return { data: data as readonly OccupiedEssidRow[] | null, error };
    };
    const { status, body } = await handleResolveOccupiedEssids(req.body, {
      nonceStore: noopNonceStore,
      listAllOccupiedEssids,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'unregisterOccupant') {
    // Disconnect cleanup (Story 7): remove the caller's occupancy row. Scoped to
    // (essid, owner_key) where owner_key is server-derived from the verified pubkey
    // — a caller can only delete its OWN row, never another occupant's. Deleting a
    // non-existent row is not an error (idempotent disconnect).
    const deleteOccupant = async ({ essid, owner_key }: { essid: string; owner_key: string }) => {
      const { error } = await supabase
        .from('home_network_occupants')
        .delete()
        .eq('essid', essid)
        .eq('owner_key', owner_key);
      if (error) console.error('[network] occupant delete error:', error);
      return { error };
    };
    const { status, body } = await handleUnregisterOccupant(req.body, {
      nonceStore: noopNonceStore,
      deleteOccupant,
    });
    res.status(status).json(body);
    return;
  }

  // The join records the player as a live occupant of the ESSID's LAN. The
  // (essid, owner_key) PK conflict resolves as an update — re-joining refreshes the row
  // rather than erroring, and every occupant of a shared AP coexists.
  const upsertOccupant = async (row: HomeNetworkOccupantRow) => {
    const { error } = await supabase
      .from('home_network_occupants')
      .upsert(row, { onConflict: 'essid,owner_key' });
    if (error) console.error('[network] occupant upsert error:', error);
    return { error };
  };
  // Allocate the AP's globally-unique public IP for this ESSID (epic item #4). The
  // read is the fast path (a re-join returns the stored address with no draw).
  const readEssidIp = async (essid: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('network_public_ips')
      .select('public_ip')
      .eq('essid', essid)
      .maybeSingle();
    if (error) {
      console.error('[network] public-ip read error:', error);
      throw new Error('public_ip_read_failed');
    }
    return (data as { public_ip: string } | null)?.public_ip ?? null;
  };
  // INSERT … ON CONFLICT (essid) DO NOTHING: a row back ⇒ we claimed the drawn IP;
  // no row ⇒ the ESSID was already allocated (read + adopt it); a 23505 ⇒ the drawn
  // IP belongs to ANOTHER ESSID (the `public_ip` UNIQUE constraint, NOT the
  // ON CONFLICT target), so null signals a redraw.
  const claimEssidIp = async (essid: string, ip: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('network_public_ips')
      .upsert({ essid, public_ip: ip }, { onConflict: 'essid', ignoreDuplicates: true })
      .select('public_ip')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return null;
      console.error('[network] public-ip claim error:', error);
      throw new Error('public_ip_claim_failed');
    }
    if (data !== null) return (data as { public_ip: string }).public_ip;
    return readEssidIp(essid);
  };

  // The occupant's host octet on the ESSID's /24, leased against `UNIQUE (essid,
  // octet)`. Nothing reads these leases yet — every address is still derived — so
  // this establishes the allocation of record ahead of the readers moving onto it.
  const readLanLease = async (essid: string, ownerKey: string): Promise<number | null> => {
    const { data, error } = await supabase
      .from('network_lan_leases')
      .select('octet')
      .eq('essid', essid)
      .eq('owner_key', ownerKey)
      .maybeSingle();
    if (error) {
      console.error('[network] lan-lease read error:', error);
      throw new Error('lan_lease_read_failed');
    }
    return (data as { octet: number } | null)?.octet ?? null;
  };
  // INSERT … ON CONFLICT (essid, owner_key) DO NOTHING: a row back ⇒ we leased the
  // offered octet; no row ⇒ this occupant already had a lease (read + adopt it); a
  // 23505 ⇒ the octet is held by ANOTHER occupant of the ESSID (the `(essid, octet)`
  // UNIQUE constraint, NOT the ON CONFLICT target), so null signals a redraw.
  const claimLanLease = async (
    essid: string,
    ownerKey: string,
    octet: number,
  ): Promise<number | null> => {
    const { data, error } = await supabase
      .from('network_lan_leases')
      .upsert(
        { essid, owner_key: ownerKey, octet },
        { onConflict: 'essid,owner_key', ignoreDuplicates: true },
      )
      .select('octet')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return null;
      console.error('[network] lan-lease claim error:', error);
      throw new Error('lan_lease_claim_failed');
    }
    if (data !== null) return (data as { octet: number }).octet;
    return readLanLease(essid, ownerKey);
  };
  // Transitional: seeds the lease from the address the pure derivation issues, so
  // switching the readers over relocates nobody. Retire this once nothing derives.
  const derivedOctetFor = (ownerKey: string, essid: string): number =>
    Number(assignHomeNetwork(ownerKey, essid).localIp.split('.')[3]);
  // The ESSID's own generated hosts. Their octets are the one set an occupant may never
  // be issued: the population is shared by everybody on the AP, so a lease landing on an
  // NPC would delete that machine from every occupant's view — and orphan whatever has
  // already been written to it — not merely hide it from the joiner.
  const npcOctetsFor = (essid: string): ReadonlySet<number> =>
    new Set(generateHomeLan(essid).hosts.map((host) => Number(host.ip.split('.')[3])));
  const { status, body } = await handleRegisterNetwork(req.body, {
    nonceStore: noopNonceStore,
    // A fresh random seed per draw so a redraw yields a DIFFERENT candidate (an
    // ESSID-seeded draw would loop forever on a collision). The result is stored, so
    // determinism doesn't matter.
    allocatePublicIp: (essid: string) =>
      allocatePublicIp(essid, {
        readByEssid: readEssidIp,
        drawIp: () => generatePublicIp(createPrng(randomUUID())),
        claim: claimEssidIp,
      }),
    // The preferred octet is the address the pure derivation issues today, so an
    // occupant already connected under it leases the address it is ALREADY using and
    // never moves. Only a genuine collision redraws — with a fresh random seed per
    // draw, since a key-seeded redraw would return the same colliding octet forever.
    allocateLanLease: (essid: string, ownerKey: string) =>
      allocateLanLease(
        {
          essid,
          ownerKey,
          preferredOctet: derivedOctetFor(ownerKey, essid),
          excludedOctets: npcOctetsFor(essid),
        },
        {
          readLease: readLanLease,
          redrawOctet: (excluded) => drawLanOctet(createPrng(randomUUID()), excluded),
          claim: claimLanLease,
        },
      ),
    upsertOccupant,
  });
  res.status(status).json(body);
}
