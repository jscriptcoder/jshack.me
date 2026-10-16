import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
} from '../src/core/network/registerNetwork.js';
import { handleResolveOccupants, type OccupantListRow } from '../src/core/network/resolveOccupants.js';
import type { LanLeaseRow } from '../src/core/network/lanAddress.js';
import {
  handleResolveOccupiedEssids,
  type OccupiedEssidRow,
} from '../src/core/network/resolveOccupiedEssids.js';
import {
  handleUnregisterOccupant,
  type LeavingBoxParams,
} from '../src/core/network/unregisterOccupant.js';
import type { EndedSession, EndSessionsAboveParams } from '../src/core/sessions/upstreamLost.js';
import {
  handleResolvePublicScan,
  type NatOccupantRow,
} from '../src/core/scan/resolvePublicScan.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';
import {
  handleResolveHttpFetch,
  type HttpFetchOccupant,
  type WebTargetDeps,
} from '../src/core/network/resolveHttpFetch.js';
import { handleResolveHttpSweep } from '../src/core/network/resolveHttpSweep.js';
import { handleResolveMail } from '../src/core/emailit/handleResolveMail.js';
import type { SpoolAccount } from '../src/core/emailit/spool.js';
import { handleResolveOccupantFetch } from '../src/core/network/resolveOccupantFetch.js';
import { handleResolveOccupantSweep } from '../src/core/network/resolveOccupantSweep.js';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess.js';
import { handleResolveInnerGatewayScan } from '../src/core/scan/resolveInnerGatewayScan.js';
import { handleResolveOccupantScan } from '../src/core/scan/resolveOccupantScan.js';
import { handleResolveSameLanScan } from '../src/core/scan/resolveSameLanScan.js';
import type { OwnerPatchRow as MachinePatchRow } from '../src/core/network/materializeMachineFs.js';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OwnerPatchRow,
  type OccupantWorkstation,
} from '../src/core/network/resolveCrossPlayerFs.js';
import type { UserType } from '../src/core/types.js';
import type {
  ListPathPatchesResult,
  PatchRow,
  PathPatchRow,
} from '../src/core/patches/upsertPatch.js';
import type { NonceStore } from '../src/core/signedRequest/nonceStore.js';
import { allocateLanLease, drawLanOctet } from '../src/core/network/allocateLanLease.js';
import { assignHomeNetwork } from '../src/core/network/homeNetwork.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { createPrng } from '../src/core/generation/prng.js';
import { derivedPublicIpByEssid } from '../src/core/logging/crossPlayerSourceIp.js';
import type { MachinePatchRow as WebIndexPatchRow } from '../src/core/findit/webIndex.js';
import { derivedNetworkByPublicIp } from '../src/core/network/resolvePublicTarget.js';
import { randomUUID } from 'node:crypto';

// Vercel adapter for POST /api/network — joining an AP, and reaching what is on it.
//
// Every signed action shares this endpoint, routed on the (unverified) payload
// `action`; each handler re-verifies the envelope itself, so routing on the raw
// action is safe. `registerNetwork` is the fallthrough. The two that define the
// shape of the rest:
//   - registerNetwork: lease the caller an address on the ESSID's LAN, then record
//     the caller as an occupant (owner_key server-stamped)
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
  findNetworkByPublicIp: derivedNetworkByPublicIp,
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

/** The target's own access log: read as a reader sees it (every writer's row at the
 *  path), written under the TARGET OWNER's key — the same key every visitor's line lands
 *  under, or the read-modify-write would fork the file per visitor. */
const accessLogWriterVia = ({ supabase, label }: QuerySpec) => ({
  readLog: listPathPatchesVia({ supabase, label: `${label} access-log` }),
  upsertPatch: async (row: PatchRow) => {
    const { error } = await supabase
      .from('patches')
      .upsert(row, { onConflict: 'machine_id,path,writer_key' });
    logFailure(`${label} access-log upsert`, error);
    return { error };
  },
});

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
    return derivedPublicIpByEssid(essid);
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
    const row = data as { credentials: { username: string; userType: UserType }; essid: string };
    return {
      data: { username: row.credentials.username, userType: row.credentials.userType, essid: row.essid },
      error,
    };
  };

/** Where the caller's OWN workstation stands: the network it currently occupies (the
 *  most recently updated row — one network at a time) and the lease octet it holds
 *  there. Null when it occupies no network; a null octet when it holds no lease. */
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

/** The lease held on `essid` by whoever's workstation `machineId` is — where a caller
 *  in a shell on that player's box stands. Null when no occupant of `essid` owns it. */
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
    const findNetworkByPublicIp = derivedNetworkByPublicIp;
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
    // the OWNER's writer_key so multi-scanner rows don't collide.
    const readLog = listPathPatchesVia({ supabase, label: 'scan kern-log' });
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
      return derivedPublicIpByEssid(essid);
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
      gameDay: gameDayAt(asEpochMs(Date.now())),
      findNetworkByPublicIp,
      findPatches,
      listOccupantsByEssid,
      listLeasesByEssid,
      now: () => Date.now(),
      readLog,
      upsertPatch,
      findHomeNetworkByOwnerKey,
      findPublicIpByEssid: derivedPublicIpByEssid,
      findActiveSession: findActiveSessionVia({ supabase, label: 'public scan' }),
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
      // A fetch launched from a box the caller only holds a session on is traced to THAT
      // network — the hop that was actually used, not the attacker's home.
      findPublicIpByEssid: derivedPublicIpByEssid,
      findActiveSession: findActiveSessionVia({ supabase, label: 'http-fetch' }),
      // Only findit's search reaches this: a batch of publishers' gateways and web servers
      // in one read, so building a live index costs a few round trips rather than one per
      // site. Ordered exactly as the per-machine read orders a journal, because the two
      // replay the same rows and must replay them the same way.
      findPatchesForMachines: async (machineIds: readonly string[]) => {
        const { data, error } = await supabase
          .from('patches')
          .select('machine_id, path, content, owner, permissions, node_type, updated_at, writer_key')
          .in('machine_id', machineIds)
          .order('updated_at', { ascending: true })
          .order('writer_key', { ascending: true });
        logFailure('http-fetch web index lookup', error);
        return { data: data as readonly WebIndexPatchRow[] | null, error };
      },
      // Only a form POSTed to emailit.io's /signup reaches this. The cap, the handle and
      // the welcome are one transaction inside the function, and its answer is a word,
      // handed over as it came off the wire for the handler to read.
      signUp: async ({ handle, passwordMd5, playerKey, welcome }) => {
        const { data, error } = await supabase.rpc('email_signup', {
          signup_handle: handle,
          signup_password_md5: passwordMd5,
          signup_player_key: playerKey,
          welcome_sender: welcome.sender,
          welcome_subject: welcome.subject,
          welcome_body: welcome.body,
        });
        logFailure('http-fetch email sign-up', error);
        return { data: data as unknown, error };
      },
      // Only a lookup at chainit.io's /address reaches these two: the public ledger, read
      // exactly as api/wallet.ts reads it for `wallet balance` and `wallet history` (an
      // api/ file is an endpoint of its own, so the reads are written here again). The
      // handler parses the rows itself, so they are handed over as they came off the wire.
      findBalance: async (address: string) => {
        const { data, error } = await supabase
          .from('wallet_balances')
          .select('balance, next_sequence')
          .eq('address', address)
          .maybeSingle();
        logFailure('http-fetch ledger balance lookup', error);
        return { data: data as unknown, error };
      },
      // The address has already been checked for its shape, so it carries nothing the
      // filter could misread. `id` orders the transfers, as two can share an instant.
      findTransfers: async (address: string, limit: number) => {
        const { data, error } = await supabase
          .from('wallet_transfers')
          .select('from_address, to_address, amount, created_at')
          .or(`from_address.eq.${address},to_address.eq.${address}`)
          .order('id', { ascending: false })
          .limit(limit);
        logFailure('http-fetch ledger history lookup', error);
        return { data: data as unknown, error };
      },
      // The primary key orders the whole chain, so the latest transfers are a walk down it.
      findLatestTransfers: async (limit: number) => {
        const { data, error } = await supabase
          .from('wallet_transfers')
          .select('from_address, to_address, amount, created_at')
          .order('id', { ascending: false })
          .limit(limit);
        logFailure('http-fetch ledger latest transfers', error);
        return { data: data as unknown, error };
      },
      // An emptied address keeps its row at zero, and holds nothing worth ranking. Equal
      // balances are ordered by address, so the list reads the same on every visit.
      findLargestBalances: async (limit: number) => {
        const { data, error } = await supabase
          .from('wallet_balances')
          .select('address, balance')
          .gt('balance', 0)
          .order('balance', { ascending: false })
          .order('address', { ascending: true })
          .limit(limit);
        logFailure('http-fetch ledger largest balances', error);
        return { data: data as unknown, error };
      },
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveMail') {
    // `mail`: an inbox, or one message in it, opened to whoever holds its password, a
    // message sent from it, one deleted from it, or its password changed. Reached through emailit.io's web server like a fetch, so a
    // dark emailit.io has no mail; the password check and the work are one call into the
    // function, and its answer is handed over as it came off the wire for the handler to
    // read.
    const { status, body } = await handleResolveMail(req.body, {
      nonceStore: noopNonceStore,
      ...webTargetDepsVia({ supabase, label: 'mail' }),
      // The player's key goes with every password check: wrong passwords are held back
      // per guesser, counted inside the function.
      openInbox: async ({ handle, passwordMd5, playerKey }) => {
        const { data, error } = await supabase.rpc('email_inbox', {
          inbox_handle: handle,
          inbox_password_md5: passwordMd5,
          inbox_player_key: playerKey,
        });
        logFailure('mail inbox', error);
        return { data: data as unknown, error };
      },
      // Opening a message marks it read in the same call, unless a reply is only quoting it.
      openMessage: async ({ handle, passwordMd5, playerKey, number, mark }) => {
        const { data, error } = await supabase.rpc('email_read', {
          read_handle: handle,
          read_password_md5: passwordMd5,
          read_player_key: playerKey,
          read_number: number,
          read_mark: mark,
        });
        logFailure('mail read', error);
        return { data: data as unknown, error };
      },
      // The sender's password is checked in the same call that delivers.
      sendMessage: async ({ handle, passwordMd5, playerKey, to, subject, body }) => {
        const { data, error } = await supabase.rpc('email_send', {
          send_handle: handle,
          send_password_md5: passwordMd5,
          send_player_key: playerKey,
          send_to: to,
          send_subject: subject,
          send_body: body,
        });
        logFailure('mail send', error);
        return { data: data as unknown, error };
      },
      deleteMessage: async ({ handle, passwordMd5, playerKey, number }) => {
        const { data, error } = await supabase.rpc('email_delete', {
          delete_handle: handle,
          delete_password_md5: passwordMd5,
          delete_player_key: playerKey,
          delete_number: number,
        });
        logFailure('mail delete', error);
        return { data: data as unknown, error };
      },
      // The old password is checked in the same call that stores the new one's hash.
      changePassword: async ({ handle, passwordMd5, playerKey, newPasswordMd5 }) => {
        const { data, error } = await supabase.rpc('email_passwd', {
          passwd_handle: handle,
          passwd_password_md5: passwordMd5,
          passwd_player_key: playerKey,
          passwd_new_md5: newPasswordMd5,
        });
        logFailure('mail passwd', error);
        return { data: data as unknown, error };
      },
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
      findPublicIpByEssid: derivedPublicIpByEssid,
      findActiveSession: findActiveSessionVia({ supabase, label: 'http-sweep' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'http-sweep' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupantFetch') {
    // Same-LAN web FETCH of a fellow occupant's box. Every other host on a LAN is the
    // client's to read; a player's box is rebuilt from THEIR identity and THEIR journal,
    // so its pages are served from here, as its ports already are for a scan. No session
    // and no credential, like every web fetch: standing on the network is the gate, and
    // the caller is placed on it by the server. The line lands in the OWNER's access log.
    const { findPatches, listOccupantsByEssid, listLeasesByEssid } = webTargetDepsVia({
      supabase,
      label: 'occupant-fetch',
    });
    const { status, body } = await handleResolveOccupantFetch(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches,
      listOccupantsByEssid,
      listLeasesByEssid,
      ...accessLogWriterVia({ supabase, label: 'occupant-fetch' }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'occupant-fetch active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'occupant-fetch vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'occupant-fetch vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupantSweep') {
    // Same-LAN path SWEEP of a fellow occupant's box: the door the fetch of one enters
    // (so neither reaches a box the other could not), plus what makes it a sweep. The
    // list is read off the box the caller stands on rather than sent, and every path
    // asked about lands in the OWNER's access log as ONE append. Sizes come back, never
    // pages.
    const { findPatches, listOccupantsByEssid, listLeasesByEssid } = webTargetDepsVia({
      supabase,
      label: 'occupant-sweep',
    });
    const { status, body } = await handleResolveOccupantSweep(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      findPatches,
      listOccupantsByEssid,
      listLeasesByEssid,
      ...accessLogWriterVia({ supabase, label: 'occupant-sweep' }),
      findActiveSession: findActiveSessionVia({ supabase, label: 'occupant-sweep active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'occupant-sweep vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'occupant-sweep vantage' }),
      listPathPatches: listPathPatchesVia({ supabase, label: 'occupant-sweep' }),
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
      gameDay: gameDayAt(asEpochMs(Date.now())),
      findPatches,
      findActiveSession: findActiveSessionVia({ supabase, label: 'inner-gw scan active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'inner-gw scan vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'inner-gw scan vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveSameLanScan') {
    // The player's OWN-LAN nmap of an NPC sibling. The seeded tree a client rebuilds for
    // itself is the box the world SHIPPED; the patches, planted doors, stopped daemons
    // and `/boot` tombstones that make it what it now IS are on its journal, so read its
    // patch rows (scoped to machine_id, server order) and replay them over the seeded
    // base. No occupancy lookup: a sibling is seeded from the ESSID, not owned by a
    // player — the same reasoning the inner gateway above it already runs on.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[network] same-lan scan lookup error:', error);
      return { data: data as readonly MachinePatchRow[] | null, error };
    };
    const { status, body } = await handleResolveSameLanScan(req.body, {
      nonceStore: noopNonceStore,
      gameDay: gameDayAt(asEpochMs(Date.now())),
      findPatches,
      findActiveSession: findActiveSessionVia({ supabase, label: 'same-lan scan active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'same-lan scan vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'same-lan scan vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveCrossPlayerFs') {
    // The read of a box the caller cannot rebuild: the server builds it, prunes it to what
    // the caller may read and sends the tree. Whose workstation it is comes from occupancy,
    // which doubles as the reachability test, since a row there means "this machine is
    // on that WiFi". One player on N APs has N rows with the SAME workstation_machine_id
    // (identity-derived) + identical identity fields, so `.limit(1)` picks any. The
    // selected columns are exactly OccupantWorkstation. A box the network makes (its
    // gateway, a machine it generates) has no occupancy row at all, so the handler finds
    // it from the network on the caller's own session row instead.
    const findOccupantWorkstationByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select('owner_key, workstation_username, workstation_root_hash')
        .eq('workstation_machine_id', machineId)
        .limit(1)
        .maybeSingle();
      if (error) console.error('[network] occupant reverse-lookup error:', error);
      return { data: data as OccupantWorkstation | null, error };
    };
    // The caller's active (un-ended) session on the target — the SERVER source of the
    // read tier, scoped to the verified player_key the handler supplies. The row's
    // `essid` comes along because it is what finds a box the network makes: such a box
    // has no occupancy row, and holding a session on one means you got in, so the
    // session records which network it is on. Null on rows predating the column.
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
    // The network on the caller's newest row on the target, open or ended. The handler
    // asks only when no row is open on a box the network makes: a session a reboot closed
    // still says where its box was, which is what lets the shell left behind read the
    // boot marker and learn it was thrown off.
    const findLastSessionEssid = async ({
      player_key,
      machine_id,
    }: {
      player_key: string;
      machine_id: string;
    }) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('essid')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.error('[network] last-session lookup error:', error);
      return { data: (data as { essid: string | null } | null)?.essid ?? null, error };
    };
    // The machine's patch rows on the target (the shared journal — every writer's
    // rows, scoped to machine_id), with the SERVER updated_at + writer_key so the
    // handler replays them chronologically over the regenerated baseline to
    // materialize the real box.
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
    // Every account with its inbox, in one request so the two tables are read as one
    // moment: a message never comes back without its account. The order is the core's.
    const findMailSpool = async () => {
      const { data, error } = await supabase
        .from('email_accounts')
        .select(
          'handle, password_md5, signed_up_at, messages:email_messages(number, sender, subject, body, delivered_at, read)',
        );
      if (error) console.error('[network] mail spool lookup error:', error);
      return { data: data as readonly SpoolAccount[] | null, error };
    };
    const { status, body } = await handleResolveCrossPlayerFs(req.body, {
      nonceStore: noopNonceStore,
      findOccupantWorkstationByMachineId,
      findActiveSession,
      findLastSessionEssid,
      findPatches,
      findMailSpool,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupants') {
    // Same-LAN occupant enumeration (Story 7): a caller standing on the ESSID — at home
    // on it, or in a shell on a box that is — asks who is on its LAN (decision D11 — you
    // must be ON the LAN to enumerate it). The composite PK's
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
      findActiveSession: findActiveSessionVia({ supabase, label: 'occupants active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'occupants vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'occupants vantage' }),
      listOccupantsByEssid,
      listLeasesByEssid,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupantScan') {
    // One fellow occupant's real open ports, for an own-LAN `nmap` of their address.
    // Every other host on that LAN is the client's own arithmetic — a generated
    // sibling's filesystem keys on the host IP — but a player's box is rebuilt from
    // THEIR identity and THEIR journal, so reading the octet locally would report the
    // NPC this viewer's seed rolled there as if it were the neighbour's.
    //
    // The occupancy read carries both the LAN boundary (the caller's own row) and the
    // target's identity fields, so it selects the auth columns the plain occupant LIST
    // deliberately does not — nothing here crosses the wire, it only rebuilds the tree.
    const listOccupantsByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .select(
          'owner_key, workstation_machine_id, workstation_username, workstation_root_hash',
        )
        .eq('essid', essid);
      if (error) console.error('[network] occupant scan list error:', error);
      return { data: data as readonly NatOccupantRow[] | null, error };
    };
    // Every lease on the ESSID in ONE read — the same addresses of record the same-LAN
    // doors resolve through, so a scan and a connection cannot disagree about which box
    // answers where.
    const listLeasesByEssid = async (essid: string) => {
      const { data, error } = await supabase
        .from('network_lan_leases')
        .select('owner_key, octet')
        .eq('essid', essid);
      if (error) console.error('[network] lan-lease list error:', error);
      return { data: data as readonly LanLeaseRow[] | null, error };
    };
    // The target's FULL journal, replayed over their generated base: a daemon they
    // started shows up, one they stopped does not, and a `/boot` tombstone takes the
    // whole box dark rather than leaving a stale pidfile advertising it.
    const findPatches = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content, owner, permissions, node_type, updated_at, writer_key')
        .eq('machine_id', machine_id)
        .order('updated_at', { ascending: true })
        .order('writer_key', { ascending: true });
      if (error) console.error('[network] occupant scan patch error:', error);
      return { data: data as readonly OwnerPatchRow[] | null, error };
    };
    const { status, body } = await handleResolveOccupantScan(req.body, {
      nonceStore: noopNonceStore,
      gameDay: gameDayAt(asEpochMs(Date.now())),
      listOccupantsByEssid,
      listLeasesByEssid,
      findPatches,
      findActiveSession: findActiveSessionVia({ supabase, label: 'occupant scan active-session' }),
      findHomeVantage: findHomeVantageVia({ supabase, label: 'occupant scan vantage' }),
      findWorkstationLease: findWorkstationLeaseVia({ supabase, label: 'occupant scan vantage' }),
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveOccupiedEssids') {
    // Organic-discovery read (Story 7): any verified identity asks which ESSIDs are
    // currently occupied, so airodump-ng can inject them for discovery. UNGATED (you learn
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

  // How a box leaving a network drops every connection through it, shared by the disconnect
  // and by a join that moves the box off the network it was on. Machine-scoped, minus
  // the owner: every other player's open row on the box closes, including ones no
  // screen is showing. The owner's own rows there are their login on their own machine,
  // which leaving a WiFi does not end.
  const endVisitorSessions = async ({
    machine_id,
    owner_key,
    reason,
  }: LeavingBoxParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('machine_id', machine_id)
      .neq('player_key', owner_key)
      .is('ended_at', null)
      .select('session_id, player_key');
    logFailure('disconnect visitor sessions', error);
    return { data: data as readonly EndedSession[] | null, error };
  };
  // The other way through the box: the owner's open rows on every machine but it. Each
  // was opened across the network the box just left, so none has anything under it now.
  const endOwnSessionsAway = async ({ machine_id, owner_key, reason }: LeavingBoxParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('player_key', owner_key)
      .neq('machine_id', machine_id)
      .is('ended_at', null)
      .select('session_id, player_key');
    logFailure('disconnect own sessions', error);
    return { data: data as readonly EndedSession[] | null, error };
  };
  // One rung of a chain standing on a closed row: this player's open rows whose
  // parent is one of `parent_ids`, answering with the ids it closed.
  const endSessionsAbove = async ({ player_key, parent_ids, reason }: EndSessionsAboveParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq('player_key', player_key)
      .in('parent_session_id', [...parent_ids])
      .is('ended_at', null)
      .select('session_id');
    logFailure('disconnect cascade', error);
    const rows = data as readonly { session_id: string }[] | null;
    return { data: rows?.map((row) => row.session_id) ?? null, error };
  };

  if (actionOf(req.body) === 'unregisterOccupant') {
    // Disconnect: remove the caller's occupancy row. Scoped to (essid, owner_key) where
    // owner_key is server-derived from the verified pubkey — a caller can only delete
    // its OWN row, never another occupant's. The removed row comes back because it
    // names the box that just left; a repeat disconnect removes nothing and answers
    // null, which is not an error.
    const deleteOccupant = async ({ essid, owner_key }: { essid: string; owner_key: string }) => {
      const { data, error } = await supabase
        .from('home_network_occupants')
        .delete()
        .eq('essid', essid)
        .eq('owner_key', owner_key)
        .select('workstation_machine_id')
        .maybeSingle();
      logFailure('occupant delete', error);
      return { data: data as { workstation_machine_id: string } | null, error };
    };
    const { status, body } = await handleUnregisterOccupant(req.body, {
      nonceStore: noopNonceStore,
      deleteOccupant,
      endVisitorSessions,
      endOwnSessionsAway,
      endSessionsAbove,
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
  // One network at a time: the join removes the caller's occupancy of every OTHER
  // ESSID, answering with the rows it removed, which name the box that left. Scoped to
  // the server-stamped owner_key, so a caller only ever moves its own box.
  const deleteOtherOccupancies = async ({
    essid,
    owner_key,
  }: {
    essid: string;
    owner_key: string;
  }) => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .delete()
      .eq('owner_key', owner_key)
      .neq('essid', essid)
      .select('workstation_machine_id');
    logFailure('occupant move', error);
    return { data: data as readonly { workstation_machine_id: string }[] | null, error };
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
    deleteOtherOccupancies,
    endVisitorSessions,
    endOwnSessionsAway,
    endSessionsAbove,
    // Set only in a local `.env.development.local`, never on Preview or Production.
    admitsUndeclaredNetworks: process.env.JSHACK_ADMIT_LAB_NETWORKS === '1',
  });
  res.status(status).json(body);
}
