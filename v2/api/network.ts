import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
  type NetworkRegistryRow,
} from '../src/core/network/registerNetwork';
import { handleResolveOccupants, type OccupantListRow } from '../src/core/network/resolveOccupants';
import {
  handleResolveOccupiedEssids,
  type OccupiedEssidRow,
} from '../src/core/network/resolveOccupiedEssids';
import { handleUnregisterOccupant } from '../src/core/network/unregisterOccupant';
import { handleResolvePublicScan, type RegistryLookup } from '../src/core/scan/resolvePublicScan';
import { handleResolveInnerGatewayScan } from '../src/core/scan/resolveInnerGatewayScan';
import type { OwnerPatchRow as MachinePatchRow } from '../src/core/network/materializeMachineFs';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OwnerPatchRow,
  type RegistryMachine,
  type RegistryWorkstation,
} from '../src/core/network/resolveCrossPlayerFs';
import type { UserType } from '../src/core/types';
import type { MachineLogReadQuery } from '../src/core/patches/appendMachineLog';
import type { PatchRow } from '../src/core/patches/upsertPatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';
import { allocatePublicIp } from '../src/core/network/allocatePublicIp';
import { generatePublicIp } from '../src/core/generation/ip';
import { createPrng } from '../src/core/generation/prng';
import { randomUUID } from 'node:crypto';

// Vercel adapter for POST /api/network — the cross-player public-IP registry.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action`; each handler re-verifies the envelope itself, so routing on the raw
// action is safe:
//   - registerNetwork: upsert the caller's network on join (owner_key + public_ip
//     server-stamped; one row per public IP)
//   - resolvePublicScan: resolve a DIFFERENT identity's nmap of a public IP to the
//     owner's ROUTER (a distinct machine bearing the public IP) — host up/down +
//     the router's open ports (its seeded sshd:22, read off the materialized tree)
//
// Logic lives in core/ handlers (unit + mutation tested); this file stays a thin
// Supabase adapter. It's typechecked via tsconfig.node.json (`npm run typecheck`),
// but its runtime correctness (column names, constraints) is only proven by the
// wire-check scripts against a live endpoint.
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands with
// cross-player writes, Story 3). Same posture as /api/patches and /api/sessions.
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

  if (actionOf(req.body) === 'resolvePublicScan') {
    // Resolve the TARGET public IP (another identity's network) — no caller
    // scoping: any authenticated player may scan any public IP, like the internet.
    // Story 5.1.1b: a public IP maps to the owner's ROUTER (a distinct machine) —
    // its machine id (journal scope) + owner_key seed the router base for the
    // boot-state check + its own sshd:22 port. Story 5.1.3b: the workstation fields
    // (machine id, essid, identity) let the handler liveness-gate a NAT forward to
    // the one workstation behind NAT.
    const findRegistryByPublicIp = async (publicIp: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select(
          'router_machine_id, owner_key, workstation_machine_id, essid, workstation_username, workstation_root_hash',
        )
        .eq('public_ip', publicIp)
        .maybeSingle();
      if (error) console.error('[network] registry lookup error:', error);
      return { data: data as RegistryLookup | null, error };
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
      if (error) console.error('[network] scanner source-ip lookup error:', error);
      return { data: data as { public_ip: string } | null, error };
    };
    const { status, body } = await handleResolvePublicScan(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByPublicIp,
      findPatches,
      now: () => Date.now(),
      readLog,
      upsertPatch,
      findRegistryByOwnerKey,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveInnerGatewayScan') {
    // The player's OWN-LAN nmap of an inner gateway, resolved at the external vantage
    // so a NAT forward to the deep layer is visible. The forward lives on the gateway's
    // server-side journal, so read its patch rows (scoped to machine_id, server order)
    // to replay over the seeded gateway base — for `canBoot` + the live `rules.v4`. No
    // registry lookup: the gateway is the caller's own box, regenerated from their key.
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
    // (A's) machine and fetches A's filtered FS. The held `machine_id` may be A's
    // workstation (Story 2) OR A's router (Story 5.2 — B `ssh root`'d into it), so
    // reverse-look-up BOTH columns and DISCRIMINATE. Two parameterized `.eq` lookups
    // (workstation first, the common case) keep the attacker-controlled machine_id
    // out of a string-interpolated `.or` filter; the registry PK is public_ip, so each
    // rides the respective machine_id index.
    const findRegistryByMachineId = async (machineId: string) => {
      const byWorkstation = await supabase
        .from('network_registry')
        .select('owner_key, workstation_username, workstation_root_hash')
        .eq('workstation_machine_id', machineId)
        .maybeSingle();
      if (byWorkstation.error) {
        console.error('[network] registry ws reverse-lookup error:', byWorkstation.error);
        return { data: null, error: byWorkstation.error };
      }
      if (byWorkstation.data !== null) {
        const ws = byWorkstation.data as {
          owner_key: string;
          workstation_username: string;
          workstation_root_hash: string;
        };
        return { data: { kind: 'workstation', ...ws } as RegistryMachine, error: null };
      }
      const byRouter = await supabase
        .from('network_registry')
        .select('owner_key')
        .eq('router_machine_id', machineId)
        .maybeSingle();
      if (byRouter.error) {
        console.error('[network] registry router reverse-lookup error:', byRouter.error);
        return { data: null, error: byRouter.error };
      }
      const router = byRouter.data as { owner_key: string } | null;
      return {
        data:
          router === null
            ? null
            : ({ kind: 'router', owner_key: router.owner_key } as RegistryMachine),
        error: null,
      };
    };
    // Same-LAN fallback: the WAN registry's PK is the ESSID-shared public_ip
    // (last-writer-wins), so a fellow occupant who joined a shared AP before a later
    // joiner is no longer in `network_registry` — but is still in `home_network_occupants`
    // (PK (essid, owner_key), every occupant coexists). One player on N APs has N rows
    // with the SAME workstation_machine_id (identity-derived) + identical identity fields,
    // so `.limit(1)` picks any. The selected columns are exactly RegistryWorkstation.
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
          occupant === null ? null : ({ kind: 'workstation', ...occupant } as RegistryWorkstation),
        error,
      };
    };
    // The caller's active (un-ended) session on the target — the SERVER source of the
    // read tier, scoped to the verified player_key the handler supplies.
    const findActiveSession = async ({
      player_key,
      machine_id,
    }: {
      player_key: string;
      machine_id: string;
    }) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('credentials')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
        .is('ended_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.error('[network] session lookup error:', error);
      const session = data as { credentials: { userType: UserType } } | null;
      return {
        data:
          session === null ? null : ({ userType: session.credentials.userType } as ActiveSession),
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
      findRegistryByMachineId,
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
    const { status, body } = await handleResolveOccupants(req.body, {
      nonceStore: noopNonceStore,
      listOccupantsByEssid,
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

  // .upsert resolves the public_ip PK conflict as an update — re-joining the same
  // AP refreshes the owner/workstation rather than erroring.
  const upsertRegistry = async (row: NetworkRegistryRow) => {
    const { error } = await supabase.from('network_registry').upsert(row);
    if (error) console.error('[network] registry upsert error:', error);
    return { error };
  };
  // The same join also records the player as a live occupant of the ESSID's LAN. The
  // (essid, owner_key) PK conflict resolves as an update — re-joining refreshes the row
  // rather than erroring (every occupant coexists, unlike the per-public-IP registry).
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
    upsertRegistry,
    upsertOccupant,
  });
  res.status(status).json(body);
}
