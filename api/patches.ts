import { randomUUID } from 'node:crypto';
import { derivedPublicIpByEssid } from '../src/core/logging/crossPlayerSourceIp.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleUpsertPatch,
  type ListPathPatchesResult,
  type PatchRow,
  type PathPatchRow,
} from '../src/core/patches/upsertPatch.js';
import type { AppendLog } from '../src/core/patches/appendMachineLog.js';
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
import type { OwnerPatchRow } from '../src/core/network/materializeWorkstationFs.js';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
  StandingSession,
} from '../src/core/patches/authorizeMachineAccess.js';
import type {
  EndMachineSessionsParams,
  WriteBootIdParams,
} from '../src/core/sessions/rebootSequence.js';
import type { EndedSession, EndSessionsAboveParams } from '../src/core/sessions/upstreamLost.js';
import { BOOT_ID_OWNER, BOOT_ID_PATH, BOOT_ID_PERMISSIONS } from '../src/core/boot/bootId.js';
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
// raw action is safe. The two writes share the L1 gate (`authorizeMachineAccess` via
// `findActiveSession`): the caller's OWN workstation (suffix match) OR an active
// ssh session on the target machine; else 403 no_session.
//   - upsertPatch: L1-gated write (server-stamped writer_key) + L2 on remote
//     writes (tier-based perms, regenerated host FS via `listMachinePatches`)
//   - listPatches: the read of the shared journal (reload-durability), for the
//     owner of a workstation alone. The rows are machine-scoped and raw, so every
//     other box is read through the served tree and a caller asking for its rows
//     gets 403 permission_denied whatever session they hold
//   - removePatch: L1-gated delete + L2 (unlinking needs write perm) — clears the
//     caller's row + descendants, then tombstones the path (tombstone-always)
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
  // was written against is checked against what the machine now holds. Path-scoped: the
  // machine-wide L2 read below is skipped entirely for an own-workstation write. The
  // sort keys come back with the rows — the handler picks the row a reader materializes.
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

  // A line the system writes onto a machine's log. The database appends it in one step,
  // under a lock on that log, so two lines landing at once both survive — a read here
  // followed by a write would let the second overwrite the first.
  const appendLog: AppendLog = async (append) => {
    const { error } = await supabase.rpc('append_machine_log', {
      append_machine_id: append.machine_id,
      append_path: append.path,
      append_writer_key: append.writer_key,
      append_owner: append.owner,
      append_permissions: append.permissions,
      append_text: append.text,
    });
    if (error) console.error('[patches] log append error:', error);
    return { error };
  };

  // L1 lookup shared by every handler here: the caller's ACTIVE session on the target
  // machine (an ssh hop). L2 reads its `userType`/`essid`; a firmware flash names the
  // address its login came from, which the door stamped on the row as `source_ip`.
  // `.limit(1)` guards `maybeSingle` against a host the player re-ssh'd into.
  const findActiveSession = async ({
    player_key,
    machine_id,
  }: ActiveSessionQuery): Promise<FindActiveSessionResult<StandingSession>> => {
    const { data, error } = await supabase
      .from('sessions')
      .select('credentials, essid, source_ip')
      .eq('player_key', player_key)
      .eq('machine_id', machine_id)
      .is('ended_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) console.error('[patches] active-session lookup error:', error);
    if (data === null) return { data: null, error };
    const row = data as {
      credentials: { username: string; userType: UserType };
      essid: string;
      source_ip: string | null;
    };
    return {
      data: {
        username: row.credentials.username,
        userType: row.credentials.userType,
        essid: row.essid,
        sourceIp: row.source_ip,
      },
      error,
    };
  };

  // Where the caller stands at home: the network their workstation occupies (the most
  // recently updated row — one network at a time) and the lease octet held there. Shared
  // by every handler that places a caller from their own occupancy (a scan, a fetch).
  const findHomeVantage = async (ownerKey: string) => {
    const occupancy = await supabase
      .from('home_network_occupants')
      .select('essid')
      .eq('owner_key', ownerKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (occupancy.error) {
      console.error('[patches] vantage occupancy error:', occupancy.error);
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
      console.error('[patches] vantage lease error:', lease.error);
      return { data: null, error: lease.error };
    }
    const octet = (lease.data as { octet: number } | null)?.octet ?? null;
    return { data: { essid, octet }, error: null };
  };

  // The lease held on `essid` by whoever's workstation `machineId` is — where a caller in
  // a shell on that player's box stands.
  const findWorkstationLease = async (essid: string, machineId: string) => {
    const occupant = await supabase
      .from('home_network_occupants')
      .select('owner_key')
      .eq('essid', essid)
      .eq('workstation_machine_id', machineId)
      .maybeSingle();
    if (occupant.error) {
      console.error('[patches] vantage workstation error:', occupant.error);
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
      console.error('[patches] vantage workstation lease error:', lease.error);
      return { data: null, error: lease.error };
    }
    return { data: (lease.data as { octet: number } | null)?.octet ?? null, error: null };
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
    // The server stamps the line and appends it — the client never supplies content or
    // time.
    const { status, body } = await handleAppendAuthLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      appendLog,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'appendKernLog') {
    // The server stamps the line and appends it — the client never supplies content or
    // time. Same shape as the auth.log appender above, pointed at the box's
    // `/var/log/kern.log` for a `--local` miss crash.
    const { status, body } = await handleAppendKernLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      appendLog,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordFtpTransfer') {
    // A file crossing a box in either direction is itemised in THAT box's vsftpd.log,
    // the same append appendAuthLog performs, pointed at someone else's
    // machine and gated on the session that got the player in there.
    // Whose box it is decides which row the line lands in; the address it names is placed
    // from where the caller stands, the same two lookups the own-LAN doors draw on — a
    // generated host keeps the network's row, another player's box owns its log, and
    // either way the line names the address the target actually saw.
    const { status, body } = await handleRecordFtpTransfer(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession,
      appendLog,
      findOccupantWorkstationByMachineId,
      findHomeVantage,
      findWorkstationLease,
      findPublicIpByEssid: derivedPublicIpByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordPackageDowngrade') {
    // A package rolled BACKWARDS is recorded in THAT box's dpkg.log. Pinning is the one
    // apt verb that leaves a machine more exposed than it found it, and after an ssh hop
    // it is run by somebody who does not own the box — so its owner's only way to learn
    // it happened is this line. Same append as the transfer above, and the
    // same provenance rule: a generated host keeps the caller's own row and the address
    // they reported, while a box somebody owns owns its log too, and is told where the
    // visitor really came from.
    // Same append as the transfer above, and the same provenance rule: a
    // generated host keeps the network's row, a box somebody owns owns its log too, and
    // either way the visitor is placed from where they stand rather than what they
    // reported — the LAN lease a neighbour was seen at, the public address a visitor from
    // another network wears.
    const { status, body } = await handleRecordPackageDowngrade(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findActiveSession,
      appendLog,
      findOccupantWorkstationByMachineId,
      findHomeVantage,
      findWorkstationLease,
      findPublicIpByEssid: derivedPublicIpByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'recordLanFetch') {
    // A `curl`/`lynx`/`gobuster` fetch records one access.log line on the box that
    // answered it, and a path sweep records a line per probe as a single append. Both are
    // server-internal: the handler places the caller from where they stand (their own
    // network, or a shell they hold), resolves WHICH box answered (a host on a deep layer
    // they reach, a player's workstation that is theirs or the one their shell stands on,
    // or a generated sibling), reads the pages itself, derives the source address, and
    // stamps time/status/size. The client names only what it asked for and the box it ran
    // from.
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
      appendLog,
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

  if (actionOf(req.body) === 'nmapScan') {
    // A scan records ONE iptables kern.log line per scanned host, server-internal
    // (the handler resolves the hosts + stamps time/ports; the client never names
    // a path or content). Same append as the su and ssh auth.log appenders above.
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
      if (error) console.error('[patches] scan journal lookup error:', error);
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
    const { status, body } = await handleNmapScan(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      appendLog,
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

  if (actionOf(req.body) === 'recordZoneTransfer') {
    // A zone transfer runs client-side, so the name server is told about it here: the
    // server recomputes the verdict from generation and writes the box's named.log
    // itself, under the network's key, via the same machine-log append. The
    // source IP is the address the server places the caller's box at on the name
    // server's own segment — derived from where they stand (their own network, or a
    // shell they hold), never a client claim.
    const { status, body } = await handleRecordZoneTransfer(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      appendLog,
      findActiveSession,
      findHomeVantage,
      findWorkstationLease,
    });
    res.status(status).json(body);
    return;
  }

  // A write that moves a router's firmware reboots the router, so the upsert carries the
  // same session writes `rebootMachine` uses in api/sessions.ts. Machine-scoped and
  // nothing else: every open row on the box ends, every player's. What keeps it from
  // being a weapon is the handler's write gates, which run before this is ever called.
  const endMachineSessions = async ({ machine_id, reason }: EndMachineSessionsParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('machine_id', machine_id)
      .is('ended_at', null)
      .select('session_id, player_key');
    if (error) console.error('[patches] flash reboot error:', error);
    return { data: data as readonly EndedSession[] | null, error };
  };
  // One rung of a broken chain: this player's open rows standing on the ones just closed.
  const endSessionsAbove = async ({ player_key, parent_ids, reason }: EndSessionsAboveParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('player_key', player_key)
      .in('parent_session_id', [...parent_ids])
      .is('ended_at', null)
      .select('session_id');
    if (error) console.error('[patches] flash reboot cascade error:', error);
    const rows = data as readonly { session_id: string }[] | null;
    return { data: rows?.map((row) => row.session_id) ?? null, error };
  };
  // The marker a shell already standing on the box reads. The newest reboot's id is the
  // one the box should show, so it files under whoever flashed it last.
  const writeBootId = ({ machine_id, player_key, boot_id }: WriteBootIdParams) =>
    upsertPatch({
      writer_key: player_key,
      machine_id,
      path: BOOT_ID_PATH,
      content: `${boot_id}\n`,
      owner: BOOT_ID_OWNER,
      permissions: BOOT_ID_PERMISSIONS,
      node_type: 'file',
    });
  // The network an owner flashing their own box stands on. A workstation runs no
  // firmware, so nothing reaches this today, but the reboot asks it and the honest
  // answer is the one read off occupancy.
  const findHomeNetworkByOwnerKey = async (ownerKey: string) => {
    const occupancy = await supabase
      .from('home_network_occupants')
      .select('essid')
      .eq('owner_key', ownerKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (occupancy.error) {
      console.error('[patches] flash trace occupancy error:', occupancy.error);
      return { data: null, error: occupancy.error };
    }
    const essid = (occupancy.data as { essid: string } | null)?.essid ?? null;
    if (essid === null) return { data: null, error: null };
    return derivedPublicIpByEssid(essid);
  };
  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    findActiveSession,
    listMachinePatches,
    listPathPatches,
    findOccupantWorkstationByMachineId,
    upsertPatch,
    endMachineSessions,
    endSessionsAbove,
    writeBootId,
    now: () => Date.now(),
    findHomeNetworkByOwnerKey,
    appendLog,
    // Unguessable on purpose: a caller able to predict the next id could keep a session
    // alive across the reboot meant to end it.
    newBootId: () => randomUUID(),
  });
  res.status(status).json(body);
}
