import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type NetworkRegistryRow,
} from '../src/core/network/registerNetwork';
import { handleResolvePublicScan, type RegistryLookup } from '../src/core/scan/resolvePublicScan';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OwnerPatchRow,
  type RegistryMachine,
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
    const { status, body } = await handleResolvePublicScan(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByPublicIp,
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
