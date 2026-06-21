/**
 * handleAuthCreateSessionSameLan — the server-side gate for a SAME-WiFi LAN ssh login.
 * A fellow occupant B's `ssh [-p port] <user>@<A's LAN IP>` reaches A's workstation
 * DIRECTLY over the shared LAN — no router, no NAT, no forward (the contrast with
 * `authCreateSessionPublic`, which routes a public IP through A's router).
 *
 * Reachability is the OCCUPANCY table, not the WAN registry: the server reads who is
 * live on the ESSID, requires the caller to be one of them (the LAN boundary — you
 * must be on the LAN to reach a box on it), then matches the target LAN IP to a FELLOW
 * occupant's row (self excluded — your own box is the own-LAN path). A's LAN IP is the
 * pure `assignHomeNetwork(owner_key, essid)` derivation, re-run here so a client can
 * neither claim an address nor frame another occupant.
 *
 * Auth mirrors every cross-player path: materialize A's REAL workstation (the shared
 * generator's base + A's persisted journal), refuse a bricked box (`canBoot`) or one
 * not serving sshd on the asked port, then validate `md5(password)` against A's own
 * `/etc/passwd`. Unknown user and wrong password collapse to one 401. On success the
 * session lands on A's workstation id — the key every reused downstream path
 * (read filter, write L1/L2, su) already speaks.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { assignHomeNetwork } from '../network/homeNetwork';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import { md5 } from '../generation/md5';
import { accountIn } from './passwdAccount';
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The occupancy fields a same-LAN connect needs: whose row it is (the LAN-boundary
 *  gate + self-exclusion + LAN-IP match), the workstation the session lands on, and the
 *  identity fields that rebuild A's tree to validate the password against. A structural
 *  superset of `RegistryWorkstation`, so it feeds `materializeWorkstationFs` directly. */
export type OccupantConnectRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type AuthCreateSessionSameLanDeps = {
  readonly nonceStore: NonceStore;
  /** Every occupant of the ESSID (auth fields included — server-internal, never
   *  projected to a client): the gate reads it for the caller, the match for the
   *  target. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly OccupantConnectRow[] | null; readonly error: unknown }>;
  /** A's workstation FULL journal (scoped to machine_id, server order) replayed over
   *  the seeded base — drives the boot gate, the running-service check, and the passwd. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
};

// The destination ssh port when the client sends none — a bare `ssh user@host` is :22.
const DEFAULT_SSH_PORT = 22;

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity — the caller IS the verified pubkey, so an
// owner_key/player_key in the payload is a forgery attempt.
const authCreateSessionSameLanSchema = z
  .looseObject({
    action: z.literal('authCreateSessionSameLan'),
    session_id: z.string().min(1),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    port: z.number().int().positive().optional(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('owner_key' in payload));

export const handleAuthCreateSessionSameLan = async (
  body: unknown,
  deps: AuthCreateSessionSameLanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionSameLanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const occupants = await deps.listOccupantsByEssid(payload.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const rows = occupants.data ?? [];

  // LAN boundary: only a live occupant may reach a fellow occupant on the LAN.
  if (!rows.some((row) => row.owner_key === publicKey)) {
    return { status: 403, body: { error: 'not_an_occupant' } };
  }

  // Match the target LAN IP to a FELLOW occupant — self excluded: your own LAN IP is
  // the own-LAN path, not the cross-player front door.
  const target = rows.find(
    (row) =>
      row.owner_key !== publicKey &&
      assignHomeNetwork(row.owner_key, payload.essid).localIp === payload.target_ip,
  );
  if (target === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const patches = await deps.findPatches({ machine_id: target.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const workstationFs = materializeWorkstationFs(target, patches.data);

  // A bricked workstation (a /boot tombstone) is dark — refuse before any pw check.
  if (!canBoot(workstationFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // The box must actually be serving sshd on the asked port — a ws that never started
  // sshd (empty /var/run) refuses the connection.
  const port = payload.port ?? DEFAULT_SSH_PORT;
  const listening = readOpenPorts(workstationFs).some((open) => open.port === port);
  if (!listening) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate against A's own /etc/passwd. Unknown user and wrong password are one 401 —
  // the response never reveals which accounts exist.
  const account = accountIn(workstationFs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;
  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: target.workstation_machine_id,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'ssh',
    essid: payload.essid,
  });
  if (error) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: target.workstation_machine_id },
  };
};
