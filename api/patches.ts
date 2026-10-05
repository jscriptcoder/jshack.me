import { derivedPublicIpByEssid } from '../src/core/logging/crossPlayerSourceIp.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleUpsertPatch,
  type ListPathPatchesResult,
  type PatchRow,
  type PathPatchRow,
} from '../src/core/patches/upsertPatch.js';
import { handleListPatches, type ListPatchesQuery } from '../src/core/patches/listPatches.js';
import { handleRemovePatch, type PatchTreeQuery } from '../src/core/patches/removePatch.js';
import { handleAppendAuthLog } from '../src/core/patches/appendAuthLog.js';
import { handleAppendKernLog } from '../src/core/patches/appendKernLog.js';
import { handleRecordFtpTransfer } from '../src/core/patches/recordFtpTransfer.js';
import { handleRecordPackageDowngrade } from '../src/core/patches/recordPackageDowngrade.js';
import { handleRecordZoneTransfer } from '../src/core/patches/recordZoneTransfer.js';
import { handleNmapScan, type ScanOccupant } from '../src/core/scan/nmapScan.js';
import {
  handleRecordLanFetch,
  type FetchOccupant,
} from '../src/core/network/recordLanFetch.js';
import type { LanLeaseRow } from '../src/core/network/lanAddress.js';
import { handleNmapScanDeep } from '../src/core/scan/nmapScanDeep.js';
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs.js';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess.js';
import type {
  ListMachinePatchesResult,
  OccupantWorkstation,
} from '../src/core/patches/remoteWritePermission.js';
import type { Patch } from '../src/core/filesystem/applyPatches.js';
import type { FilePermissions } from '../src/core/filesystem/types.js';
import type { NonceStore } from '../src/core/signedRequest/nonceStore.js';
import type { UserType } from '../src/core/types.js';

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

  // Every writer's rows at one path on one machine. A save that names the content it
  // was written against is checked against what the machine now holds, and every log
  // appender builds on it, so the append is a read-modify-write the SERVER performs
  // on the log a reader sees. Path-scoped: the machine-wide L2 read below is skipped
  // entirely for an own-workstation write. The sort keys come back with the rows —
  // the handler picks the row a reader materializes.
  const listPathPatches = async ({
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
    if (error) console.error('[patches] path-rows lookup error:', error);
    return { data: data as readonly PathPatchRow[] | null, error };
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
    const row = data as { credentials: { username: string; userType: UserType }; essid: string };
    return {
      data: { username: row.credentials.username, userType: row.credentials.userType, essid: row.essid },
      error,
    };
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

  // L2's cross-player branch (D6): reverse-look-up a FOREIGN machine by its machine_id
  // so the handler can rebuild the OWNER's tree (the same identity the cross-player READ
  // uses) and walk it at the session tier. Occupancy answers both questions at once —
  // whose box it is, and whether it is still on a WiFi at all, since a player who ran
  // `nmcli disconnect` has no row and their machine is nobody's to write to. Returns
  // null for an NPC host / unknown id, and every gateway on the session's own network is
  // already resolved from the ESSID before this is reached. One player on N APs has N
  // rows with the SAME workstation_machine_id, so `.limit(1)` picks any.
  const findOccupantWorkstationByMachineId = async (machineId: string) => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .select('owner_key, workstation_username, workstation_root_hash')
      .eq('workstation_machine_id', machineId)
      .limit(1)
      .maybeSingle();
    if (error) console.error('[patches] occupant reverse-lookup error:', error);
    return { data: data as OccupantWorkstation | null, error };
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
      findOccupantWorkstationByMachineId,
      deletePatchTree,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'appendAuthLog') {
    // The server reads the current auth.log as a reader sees it (every writer's row,
    // so an intruder's root wipe stays wiped) and appends: a read-modify-write the
    // SERVER performs — the client never supplies content or time.
    const { status, body } = await handleAppendAuthLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readAuthLog: listPathPatches,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'appendKernLog') {
    // The server reads the current kern.log as a reader sees it (every writer's row)
    // and appends: a read-modify-write the SERVER performs — the client never supplies
    // content or time. Same shape as the auth.log appender above, pointed at the box's
    // `/var/log/kern.log` for a `--local` miss crash.
    const { status, body } = await handleAppendKernLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readKernLog: listPathPatches,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordFtpTransfer') {
    // A file crossing a box in either direction is itemised in THAT box's vsftpd.log,
    // the same read-modify-write appendAuthLog performs, pointed at someone else's
    // machine and gated on the session that got the player in there.
    // Whose box it is decides both the row the line lands in and the address it names:
    // a generated host keeps the caller's own row and the address they reported, while
    // another player's box owns its log and is told where the visitor really came from.
    const findPublicIpByEssid = derivedPublicIpByEssid;
    const findHomeNetworkByOwnerKey = async (ownerKey: string) => {
      const occupancy = await supabase
        .from('home_network_occupants')
        .select('essid')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (occupancy.error) {
        console.error('[patches] ftp source-ip occupancy error:', occupancy.error);
        return { data: null, error: occupancy.error };
      }
      const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
      if (essid === null) return { data: null, error: null };
      return findPublicIpByEssid(essid);
    };
    const { status, body } = await handleRecordFtpTransfer(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession,
      readLog: listPathPatches,
      upsertPatch,
      findOccupantWorkstationByMachineId,
      findHomeNetworkByOwnerKey,
      findPublicIpByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordPackageDowngrade') {
    // A package rolled BACKWARDS is recorded in THAT box's dpkg.log. Pinning is the one
    // apt verb that leaves a machine more exposed than it found it, and after an ssh hop
    // it is run by somebody who does not own the box — so its owner's only way to learn
    // it happened is this line. Same read-modify-write as the transfer above, and the
    // same provenance rule: a generated host keeps the caller's own row and the address
    // they reported, while a box somebody owns owns its log too, and is told where the
    // visitor really came from.
    // The two lookups are re-declared rather than shared with the branch above: each
    // branch owns its closures, as `recordZoneTransfer` below does, so retuning one
    // cannot silently retune another.
    const findPublicIpByEssid = derivedPublicIpByEssid;
    const findHomeNetworkByOwnerKey = async (ownerKey: string) => {
      const occupancy = await supabase
        .from('home_network_occupants')
        .select('essid')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (occupancy.error) {
        console.error('[patches] downgrade source-ip occupancy error:', occupancy.error);
        return { data: null, error: occupancy.error };
      }
      const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
      if (essid === null) return { data: null, error: null };
      return findPublicIpByEssid(essid);
    };
    const { status, body } = await handleRecordPackageDowngrade(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession,
      readLog: listPathPatches,
      upsertPatch,
      findOccupantWorkstationByMachineId,
      findHomeNetworkByOwnerKey,
      findPublicIpByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordLanFetch') {
    // An own-LAN `curl` records one access.log line on the box that answered it, and a
    // path sweep records a line per probe as a single append. Both are server-internal:
    // the handler resolves WHICH box that is (the caller's own workstation when they
    // fetched their own leased address, else a generated sibling), reads the pages
    // itself, and stamps time/status/size. The client names only what it asked for.
    // The caller's own occupancy row rebuilds their box; their lease says which
    // address is theirs, so a self-fetch is recognised from the target alone.
    const listOccupantsByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, workstation_username, workstation_root_hash',
        )
        .eq('essid', essid);
      if (error) console.error('[patches] fetch-log occupant list error:', error);
      return { data: data as readonly FetchOccupant[] | null, error };
    };
    const listLeasesByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('network_lan_leases')
        .select('owner_key, octet')
        .eq('essid', essid);
      if (error) console.error('[patches] fetch-log lan-lease list error:', error);
      return { data: data as readonly LanLeaseRow[] | null, error };
    };
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[patches] fetch-log own journal lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleRecordLanFetch(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readLog: listPathPatches,
      upsertPatch,
      listOccupantsByEssid,
      listLeasesByEssid,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'nmapScan') {
    // A scan records ONE iptables kern.log line per scanned host, server-internal
    // (the handler resolves the hosts + stamps time/ports; the client never names
    // a path or content). Same read-modify-write `patches`-table shapes as the su
    // and ssh auth.log appenders above.
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
    // Every lease on the ESSID in ONE read: which occupants the scanned range covers,
    // and the source address the traces carry.
    const listLeasesByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('network_lan_leases')
        .select('owner_key, octet')
        .eq('essid', essid);
      if (error) console.error('[patches] scan lan-lease list error:', error);
      return { data: data as readonly LanLeaseRow[] | null, error };
    };
    // Where the scanner stands at home: the network their workstation occupies (the most
    // recently updated row — one network at a time) and the lease octet held there.
    const findHomeVantage = async (ownerKey: string) => {
      const occupancy = await supabase
        .from('home_network_occupants')
        .select('essid')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (occupancy.error) {
        console.error('[patches] scan vantage occupancy error:', occupancy.error);
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
        console.error('[patches] scan vantage lease error:', lease.error);
        return { data: null, error: lease.error };
      }
      const octet = (lease.data as { octet: number } | null)?.octet ?? null;
      return { data: { essid, octet }, error: null };
    };
    // The lease held on `essid` by whoever's workstation `machineId` is — where a scanner
    // in a shell on that player's box stands.
    const findWorkstationLease = async (essid: string, machineId: string) => {
      const occupant = await supabase
        .from('home_network_occupants')
        .select('owner_key')
        .eq('essid', essid)
        .eq('workstation_machine_id', machineId)
        .maybeSingle();
      if (occupant.error) {
        console.error('[patches] scan vantage workstation error:', occupant.error);
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
        console.error('[patches] scan vantage workstation lease error:', lease.error);
        return { data: null, error: lease.error };
      }
      return { data: (lease.data as { octet: number } | null)?.octet ?? null, error: null };
    };
    const { status, body } = await handleNmapScan(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readLog: listPathPatches,
      upsertPatch,
      listOccupantsByEssid,
      listLeasesByEssid,
      findPatches,
      findActiveSession,
      findHomeVantage,
      findWorkstationLease,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'nmapScanDeep') {
    // A deep PIVOT scan records ONE kern.log line per touched deep host, server-
    // internal (the handler re-derives the vantage + regenerates its deep layer; the
    // client never names a path or content). Same `patches`-table read-modify-write as
    // `nmapScan` above; the journal read replays the vantage gateway so a switch's live
    // `acl.conf` filters the trace.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[patches] deep-scan vantage journal lookup error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleNmapScanDeep(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readLog: listPathPatches,
      upsertPatch,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordZoneTransfer') {
    // A zone transfer runs client-side, so the name server is told about it here: the
    // server recomputes the verdict from generation and writes the box's named.log
    // itself, under the caller's key, via the same machine-log read-modify-write. The
    // source IP is the actor's HOME public IP, resolved from their verified key —
    // never a client claim.
    const findPublicIpByEssid = derivedPublicIpByEssid;
    const findHomeNetworkByOwnerKey = async (ownerKey: string) => {
      const occupancy = await supabase
        .from('home_network_occupants')
        .select('essid')
        .eq('owner_key', ownerKey)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (occupancy.error) {
        console.error('[patches] axfr source-ip occupancy error:', occupancy.error);
        return { data: null, error: occupancy.error };
      }
      const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
      if (essid === null) return { data: null, error: null };
      return findPublicIpByEssid(essid);
    };
    const { status, body } = await handleRecordZoneTransfer(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readLog: listPathPatches,
      upsertPatch,
      findHomeNetworkByOwnerKey,
    });
    res.status(status).json(body);
    return;
  }

  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    findActiveSession,
    listMachinePatches,
    listPathPatches,
    findOccupantWorkstationByMachineId,
    upsertPatch,
  });
  res.status(status).json(body);
}
