import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleUpsertPatch, type PatchRow } from '../src/core/patches/upsertPatch';
import { handleListPatches, type ListPatchesQuery } from '../src/core/patches/listPatches';
import { handleRemovePatch, type PatchTreeQuery } from '../src/core/patches/removePatch';
import { handleAppendAuthLog, type AuthLogContentQuery } from '../src/core/patches/appendAuthLog';
import { handleNmapScan, type ScanOccupant } from '../src/core/scan/nmapScan';
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs';
import type { MachineLogReadQuery } from '../src/core/patches/appendMachineLog';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess';
import type {
  ListMachinePatchesResult,
  RegistryMachine,
  RegistryWorkstation,
} from '../src/core/patches/remoteWritePermission';
import type { Patch } from '../src/core/filesystem/applyPatches';
import type { FilePermissions } from '../src/core/filesystem/types';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';
import type { UserType } from '../src/core/types';

// Vercel adapter for POST /api/patches.
//
// Three signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe. All three share the L1 gate (`authorizeMachineAccess` via
// `findActiveSession`): the caller's OWN workstation (suffix match) OR an active
// ssh session on the target machine; else 403 no_session.
//   - upsertPatch: L1-gated write (server-stamped writer_key) + L2 on remote
//     writes (tier-based perms, regenerated host FS via `listMachinePatches`)
//   - listPatches: L1-gated read of the shared journal (reload-durability, and
//     the read-back of a remote ssh write) — machine-scoped, L1-only, no L2
//   - removePatch: L1-gated delete + L2 (unlinking needs write perm) — clears the
//     caller's row + descendants, then tombstones the path (tombstone-always)
//
// The cross-player three-tier READ filter is still a later plan; remote reads
// remain L1-only (any active-session tier may read).
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands when
// cross-player flows need it). Acceptable for local dev — same posture as
// legacy when Upstash env vars are absent.
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

  const upsertPatch = async (row: PatchRow) => {
    // .upsert resolves the (machine_id, path, writer_key) PK conflict as an
    // update — write-overwrites-content for a writer's own row. Columns omitted
    // from the row (e.g. is_new on an overwrite, and ALWAYS updated_at) are NOT in
    // the ON CONFLICT SET, so the stored value is preserved — and the BEFORE
    // UPDATE trigger re-stamps updated_at = now() so the replay order can't be
    // forged by the client.
    const { error } = await supabase
      .from('patches')
      .upsert(row, { onConflict: 'machine_id,path,writer_key' });
    if (error) console.error('[patches] upsert error:', error);
    return { error };
  };

  // L1 lookup shared by upsert/list/remove: the caller's ACTIVE session on the
  // target machine (an ssh hop). The handler only needs its presence today; the
  // projected `userType`/`essid` are what the remote-write L2 pass reads next.
  // `.limit(1)` guards `maybeSingle` against a host the player re-ssh'd into.
  const findActiveSession = async ({
    player_key,
    machine_id,
  }: ActiveSessionQuery): Promise<FindActiveSessionResult> => {
    const { data, error } = await supabase
      .from('sessions')
      .select('credentials, essid')
      .eq('player_key', player_key)
      .eq('machine_id', machine_id)
      .is('ended_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) console.error('[patches] active-session lookup error:', error);
    if (data === null) return { data: null, error };
    const row = data as { credentials: { userType: UserType }; essid: string };
    return { data: { userType: row.credentials.userType, essid: row.essid }, error };
  };

  // L2's regeneration key: a remote machine's patch journal (the shared journal —
  // every writer's rows, keyed by machine_id), mapped to the `Patch` shape so the
  // handler can replay it over the regenerated base FS and walk the resulting
  // perms. Ordered chronologically here so the mapped `Patch[]` (which drops the
  // sort keys) replays last-write-wins. (Only consulted for REMOTE writes.)
  const listMachinePatches = async ({
    machine_id,
  }: {
    readonly machine_id: string;
  }): Promise<ListMachinePatchesResult> => {
    const { data, error } = await supabase
      .from('patches')
      .select('path, content, owner, permissions, node_type')
      .eq('machine_id', machine_id)
      .order('updated_at', { ascending: true })
      .order('writer_key', { ascending: true });
    if (error) console.error('[patches] machine-patches lookup error:', error);
    if (data === null) return { data: null, error };
    const rows = data as readonly {
      path: string;
      content: string | null;
      owner: string;
      permissions: FilePermissions | null;
      node_type: 'file' | 'directory' | null;
    }[];
    const patches: readonly Patch[] = rows.map((row) => ({
      path: row.path,
      content: row.content,
      owner: row.owner,
      ...(row.permissions ? { permissions: row.permissions } : {}),
      ...(row.node_type ? { nodeType: row.node_type } : {}),
    }));
    return { data: patches, error };
  };

  // L2's cross-player branch (D6): reverse-look-up a registered FOREIGN machine by
  // its machine_id so the handler can rebuild the OWNER's tree (the same identity the
  // cross-player READ uses) and walk it at the session tier. The id may be A's
  // workstation (Story 2/3) OR A's ROUTER (Story 5.2 — B `ssh root`'d into it), so
  // look up BOTH columns and DISCRIMINATE. Two parameterized `.eq` lookups
  // (workstation first, the common case) keep the attacker-controlled machine_id out
  // of a string-interpolated `.or` filter. Returns null for an NPC host / unknown id —
  // L2 then resolves via the caller's own LAN/router or fails closed.
  const findRegistryByMachineId = async (machineId: string) => {
    const byWorkstation = await supabase
      .from('network_registry')
      .select('owner_key, workstation_username, workstation_root_hash')
      .eq('workstation_machine_id', machineId)
      .maybeSingle();
    if (byWorkstation.error) {
      console.error('[patches] registry ws reverse-lookup error:', byWorkstation.error);
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
      console.error('[patches] registry router reverse-lookup error:', byRouter.error);
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
  // Same-LAN fallback for L2 when the registry misses: a shared-AP occupant evicted from
  // network_registry (PK = the ESSID-shared public_ip, last-writer-wins) is still in
  // home_network_occupants (PK (essid, owner_key)). One player on N APs has N rows with
  // the SAME workstation_machine_id, so `.limit(1)`. Only ever resolves a workstation.
  const findOccupantWorkstationByMachineId = async (machineId: string) => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .select('owner_key, workstation_username, workstation_root_hash')
      .eq('workstation_machine_id', machineId)
      .limit(1)
      .maybeSingle();
    if (error) console.error('[patches] occupant reverse-lookup error:', error);
    return { data: data as RegistryWorkstation | null, error };
  };

  if (actionOf(req.body) === 'listPatches') {
    const listPatches = async ({ machine_id }: ListPatchesQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('*')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[patches] list error:', error);
      return { data, error };
    };
    const { status, body } = await handleListPatches(req.body, {
      nonceStore: noopNonceStore,
      findActiveSession,
      listPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'removePatch') {
    // Two scoped deletes (the row, then its descendants) rather than a single
    // `.or(...)` — a PostgREST `.or` filter would mis-parse a path containing a
    // comma, and the LIKE wildcard differs between the two filter dialects. Keyed
    // to the caller's own writer_key row; the handler then upserts a content:null
    // tombstone at the path (tombstone-always on the shared journal).
    const deletePatchTree = async ({ writer_key, machine_id, path }: PatchTreeQuery) => {
      const base = () =>
        supabase.from('patches').delete().eq('writer_key', writer_key).eq('machine_id', machine_id);
      const exact = await base().eq('path', path);
      if (exact.error) {
        console.error('[patches] delete error:', exact.error);
        return { error: exact.error };
      }
      const descendants = await base().like('path', `${path}/%`);
      if (descendants.error)
        console.error('[patches] delete (descendants) error:', descendants.error);
      return { error: descendants.error };
    };
    const { status, body } = await handleRemovePatch(req.body, {
      nonceStore: noopNonceStore,
      findActiveSession,
      listMachinePatches,
      findRegistryByMachineId,
      findOccupantWorkstationByMachineId,
      deletePatchTree,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'appendAuthLog') {
    // The server reads the current auth.log content (own-workstation, the owner's
    // own writer_key row) so the append is a read-modify-write the SERVER performs
    // — the client never supplies content or time.
    const readAuthLog = async ({ writer_key, machine_id, path }: AuthLogContentQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[patches] auth-log read error:', error);
      return { data, error };
    };
    const { status, body } = await handleAppendAuthLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'nmapScan') {
    // A scan records ONE iptables kern.log line per scanned host, server-internal
    // (the handler resolves the hosts + stamps time/ports; the client never names
    // a path or content). Same read-modify-write `patches`-table shapes as the su
    // and ssh auth.log appenders above.
    const readLog = async ({ writer_key, machine_id, path }: MachineLogReadQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('writer_key', writer_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[patches] kern-log read error:', error);
      return { data, error };
    };
    // Story 7: a same-LAN scan also traces REAL fellow occupants. The occupancy read
    // (auth fields included — server-internal) is the LAN-boundary gate + the per-occupant
    // trace target; the journal read (full OwnerPatchRow shape, server order) materializes
    // each occupant's box to gate `canBoot` and read its real open ports.
    const listOccupantsByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, workstation_machine_name, workstation_username, workstation_root_hash',
        )
        .eq('essid', essid);
      if (error) console.error('[patches] scan occupant list error:', error);
      return { data: data as readonly ScanOccupant[] | null, error };
    };
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[patches] scan occupant journal lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleNmapScan(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readLog,
      upsertPatch,
      listOccupantsByEssid,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    findActiveSession,
    listMachinePatches,
    findRegistryByMachineId,
    findOccupantWorkstationByMachineId,
    upsertPatch,
  });
  res.status(status).json(body);
}
