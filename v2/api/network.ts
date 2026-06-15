import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type NetworkRegistryRow,
} from '../src/core/network/registerNetwork';
import {
  handleResolvePublicScan,
  type RegistryLookup,
  type RunFileRow,
} from '../src/core/scan/resolvePublicScan';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OwnerPatchRow,
  type RegistryWorkstation,
} from '../src/core/network/resolveCrossPlayerFs';
import type { UserType } from '../src/core/types';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/network — the cross-player public-IP registry.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action`; each handler re-verifies the envelope itself, so routing on the raw
// action is safe:
//   - registerNetwork: upsert the caller's network on join (owner_key + public_ip
//     server-stamped; one row per public IP)
//   - resolvePublicScan: resolve a DIFFERENT identity's nmap of a public IP to the
//     registered machine — host up/down + the owner's real open ports (read from
//     the owner's /var/run/*.pid patch rows)
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
    // The owner identity fields rebuild the box's base FS for the boot-state check
    // (a bricked box goes dark), the same way the cross-player read materializes it.
    const findRegistryByPublicIp = async (publicIp: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select('workstation_machine_id, owner_key, workstation_username, workstation_root_hash')
        .eq('public_ip', publicIp)
        .maybeSingle();
      if (error) console.error('[network] registry lookup error:', error);
      return { data: data as RegistryLookup | null, error };
    };
    // The resolved machine's open ports come from its `/var/run/*.pid` patch rows
    // on the shared journal — scoped to machine_id (owner-unique by construction),
    // so a cross-player scan reads the owner's real services, never the caller's
    // own per-viewer rows.
    const findRunFiles = async ({ machine_id }: { machine_id: string }) => {
      const { data, error } = await supabase
        .from('patches')
        .select('path, content')
        .eq('machine_id', machine_id)
        .like('path', '/var/run/%');
      if (error) console.error('[network] run-files lookup error:', error);
      return { data: data as readonly RunFileRow[] | null, error };
    };
    // The resolved machine's FULL journal (scoped to machine_id, server order) so
    // the handler can replay it over the regenerated base and ask `canBoot` — a
    // `/boot` tombstone makes the box dark to scanners.
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
    const { status, body } = await handleResolvePublicScan(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByPublicIp,
      findRunFiles,
      findPatches,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'resolveCrossPlayerFs') {
    // Cross-player READ (slice 2c): the caller (B) holds an active session on
    // ANOTHER identity's (A's) workstation and fetches A's filtered FS. Reverse-
    // look-up the registry by the workstation's machine id (B holds it from the 2b
    // login; the registry PK is public_ip, so this rides the machine_id index).
    const findRegistryByMachineId = async (machineId: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select('owner_key, workstation_username, workstation_root_hash')
        .eq('workstation_machine_id', machineId)
        .maybeSingle();
      if (error) console.error('[network] registry reverse-lookup error:', error);
      return { data: data as RegistryWorkstation | null, error };
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
      return { data: session === null ? null : ({ userType: session.credentials.userType } as ActiveSession), error };
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
      findActiveSession,
      findPatches,
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
  const { status, body } = await handleRegisterNetwork(req.body, {
    nonceStore: noopNonceStore,
    upsertRegistry,
  });
  res.status(status).json(body);
}
